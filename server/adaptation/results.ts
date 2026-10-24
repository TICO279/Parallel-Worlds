import { z } from 'zod';
import { appraisalSchema, realismAppraisalSchema, tokenUsageSchema, type TokenUsage } from '../../shared/characterState';
import { log } from '../log';

// Request-local metadata keeps the provider interface unchanged and avoids shared
// "last usage" state when different sessions appraise concurrently.
export interface AppraisalTelemetry { model?: string; usage?: TokenUsage; }
const resultSchema = z.strictObject({ kind: z.literal('appraisal-result'), appraisal: appraisalSchema,
  model: z.string().min(1).max(200).optional(), usage: tokenUsageSchema.optional() });
export class AppraisalProviderError extends Error {
  constructor(message: string, readonly telemetry: AppraisalTelemetry = {}) { super(message); }
}
export function unpackAppraisalResult(output: unknown) {
  if (typeof output === 'object' && output !== null && 'kind' in output && output.kind === 'appraisal-result') {
    const { appraisal, model, usage } = resultSchema.parse(output);
    return { appraisal, telemetry: { model, usage } };
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
export function parseAppraisal(text: unknown, telemetry: AppraisalTelemetry, requireRealism = false) {
  if (typeof text !== 'string' || !text.trim()) throw new AppraisalProviderError('Appraisal provider returned empty output.', telemetry);
  try { return { kind: 'appraisal-result' as const, appraisal: (requireRealism ? realismAppraisalSchema : appraisalSchema).parse(JSON.parse(text)), ...telemetry }; }
  catch { throw new AppraisalProviderError('Appraisal provider returned invalid structured output.', telemetry); }
}
export async function requestJson(fetcher: typeof fetch, url: string, key: string, body: unknown, signal: AbortSignal): Promise<any> {
  const host = new URL(url).host; const model = (body as { model?: unknown })?.model; const started = performance.now();
  const elapsed = () => `${Math.round(performance.now() - started)} ms`;
  try {
    signal.throwIfAborted();
    log('appraisal', `→ POST ${host}${typeof model === 'string' ? ` model=${model}` : ''}`);
    const response = await fetcher(url, { method: 'POST', signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    log('appraisal', `← ${host} HTTP ${response.status} in ${elapsed()}`);
    if (!response.ok) throw new AppraisalProviderError(`Appraisal provider rejected the request (HTTP ${response.status}).`);
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppraisalProviderError('Appraisal provider returned an invalid API response.');
    return data;
  } catch (error) {
    if (signal.aborted) { log('appraisal', `✗ ${host} timed out or cancelled after ${elapsed()}`); throw new AppraisalProviderError('Appraisal timed out or was cancelled.'); }
    if (error instanceof AppraisalProviderError) throw error;
    // Only the error code (e.g. ENOTFOUND, ECONNREFUSED), never messages that could echo the request.
    const code = (error as { cause?: { code?: unknown } })?.cause?.code;
    log('appraisal', `✗ ${host} unreachable after ${elapsed()}${typeof code === 'string' ? ` (${code})` : ''}`);
    // Never propagate upstream bodies, fetch errors or JSON parser excerpts.
    throw new AppraisalProviderError('Appraisal provider unavailable or returned an invalid API response.');
  }
}
