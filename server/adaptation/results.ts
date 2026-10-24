import { z } from 'zod';
import { appraisalSchema, realismAppraisalSchema, tokenUsageSchema, type TokenUsage } from '../../shared/characterState';
import { log } from '../log';
import { expandCompactAppraisal } from './compact';
import type { AppraisalInput } from './providers';

// Request-local metadata keeps the provider interface unchanged and avoids shared
// "last usage" state when different sessions appraise concurrently.
export interface AppraisalTelemetry { model?: string; usage?: TokenUsage; validationIssues?: string[]; schemaProfile?: string; }
const resultSchema = z.strictObject({ kind: z.literal('appraisal-result'), appraisal: appraisalSchema,
  model: z.string().min(1).max(200).optional(), usage: tokenUsageSchema.optional(), schemaProfile: z.string().max(50).optional() });
export class AppraisalProviderError extends Error {
  constructor(message: string, readonly telemetry: AppraisalTelemetry = {}) { super(message); }
}
export function unpackAppraisalResult(output: unknown) {
  if (typeof output === 'object' && output !== null && 'kind' in output && output.kind === 'appraisal-result') {
    const { appraisal, model, usage, schemaProfile } = resultSchema.parse(output);
    return { appraisal, telemetry: { model, usage, schemaProfile } };
  }
  // Existing mock/custom providers can continue to return a plain appraisal.
  return { appraisal: appraisalSchema.parse(output), telemetry: {} as AppraisalTelemetry };
}
export function tokenUsage(raw: any, provider: 'deepseek' | 'openai'): TokenUsage | undefined {
  const value = provider === 'deepseek' ? {
    inputTokens: raw?.prompt_tokens, outputTokens: raw?.completion_tokens, totalTokens: raw?.total_tokens,
    cachedInputTokens: raw?.prompt_cache_hit_tokens ?? raw?.prompt_tokens_details?.cached_tokens,
    reasoningTokens: raw?.completion_tokens_details?.reasoning_tokens,
  } : {
    inputTokens: raw?.input_tokens, outputTokens: raw?.output_tokens, totalTokens: raw?.total_tokens,
    cachedInputTokens: raw?.input_tokens_details?.cached_tokens, reasoningTokens: raw?.output_tokens_details?.reasoning_tokens,
  };
  const parsed = tokenUsageSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
export function parseAppraisal(text: unknown, telemetry: AppraisalTelemetry, requireRealism = false, input?: AppraisalInput) {
  if (typeof text !== 'string' || !text.trim()) throw new AppraisalProviderError('Appraisal provider returned empty output.', telemetry);
  try {
    const raw = JSON.parse(text);
    const compact = input?.outputSchema === 'evidence-v1' && raw?.schemaVersion !== 2;
    const appraisal = compact ? expandCompactAppraisal(raw, input!) : (requireRealism ? realismAppraisalSchema : appraisalSchema).parse(raw);
    return { kind: 'appraisal-result' as const, appraisal, ...telemetry,
      ...(input?.outputSchema && { schemaProfile: compact ? 'evidence-v1' : 'realism-v2-compatible' }) };
  }
  catch (error) {
    const fields = new Set([...Object.keys(realismAppraisalSchema.shape), 'memoryText','turnId','quote','action','category','text','targetId','level','reason','positive','negative','unresolved','prior','update','alternative','approach','protect','intent','stance','concern','expression','move','scope','avoid','comfort','trust','curiosity','engagement']);
    const validationIssues = error instanceof z.ZodError ? error.issues.slice(0,6).map(i => `${i.code}:${i.path.map(p => typeof p === 'number' ? 'item' : fields.has(String(p)) ? p : 'field').join('.')}`) : ['invalid_json'];
    throw new AppraisalProviderError('Appraisal provider returned invalid structured output.', { ...telemetry, validationIssues });
  }
}
export async function requestJson(fetcher: typeof fetch, url: string, key: string, body: unknown, signal: AbortSignal): Promise<any> {
  const host = new URL(url).host; const model = (body as { model?: unknown })?.model; const started = performance.now();
  const elapsed = () => `${Math.round(performance.now() - started)} ms`;
  try {
    signal.throwIfAborted();
    log('appraisal', `→ POST ${host}${typeof model === 'string' ? ` model=${model}` : ''}`, [key]);
    const response = await fetcher(url, { method: 'POST', signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    log('appraisal', `← ${host} HTTP ${response.status} in ${elapsed()}`, [key]);
    if (!response.ok) throw new AppraisalProviderError(`Appraisal provider rejected the request (HTTP ${response.status}).`);
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppraisalProviderError('Appraisal provider returned an invalid API response.');
    return data;
  } catch (error) {
    if (signal.aborted) { log('appraisal', `✗ ${host} timed out or cancelled after ${elapsed()}`, [key]); throw new AppraisalProviderError('Appraisal timed out or was cancelled.'); }
    if (error instanceof AppraisalProviderError) throw error;
    // Only the error code (e.g. ENOTFOUND, ECONNREFUSED), never messages that could echo the request.
    const code = (error as { cause?: { code?: unknown } })?.cause?.code;
    const knownCodes = new Set(['ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET']);
    log('appraisal', `✗ ${host} unreachable after ${elapsed()}${typeof code === 'string' && knownCodes.has(code) ? ` (${code})` : ''}`, [key]);
    // Never propagate upstream bodies, fetch errors or JSON parser excerpts.
    throw new AppraisalProviderError('Appraisal provider unavailable or returned an invalid API response.');
  }
}
