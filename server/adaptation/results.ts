import { z } from 'zod';
import { appraisalSchema, realismAppraisalSchema, tokenUsageSchema, type TokenUsage } from '../../shared/characterState';
import { debug, log } from '../log';

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
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new AppraisalProviderError('Appraisal provider returned invalid JSON.', telemetry); }
  const result = (requireRealism ? realismAppraisalSchema : appraisalSchema).safeParse(json);
  if (result.success) return { kind: 'appraisal-result' as const, appraisal: result.data, ...telemetry };
  // Field paths and rule codes only (e.g. "brief.intent too_big"), never values, which could quote the dialogue.
  const fields = [...new Set(result.error.issues.map(i => `${i.path.join('.') || '(root)'} ${i.code}`))].slice(0, 4).join(', ');
  throw new AppraisalProviderError(`Appraisal provider returned invalid structured output (${fields}).`, telemetry);
}
const RETRYABLE: ReadonlySet<number> = new Set([429, 502, 503, 504]);
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms); signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});
/** `retries`: extra attempts after a rate limit (429) or gateway error, waiting Retry-After (capped) or a short backoff. */
export async function requestJson(fetcher: typeof fetch, url: string, key: string, body: unknown, signal: AbortSignal, scope = 'appraisal', retries = 0): Promise<any> {
  const target = new URL(url); const host = target.host + target.pathname; const model = (body as { model?: unknown })?.model; const started = performance.now();
  const elapsed = () => `${Math.round(performance.now() - started)} ms`;
  try {
    signal.throwIfAborted();
    let response: Response;
    for (let attempt = 0; ; attempt++) {
      debug(scope, `→ POST ${host}${typeof model === 'string' ? ` model=${model}` : ''}${attempt ? ` (retry ${attempt})` : ''}`);
      response = await fetcher(url, { method: 'POST', signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!RETRYABLE.has(response.status) || attempt >= retries) break;
      const after = Number(response.headers.get('retry-after'));
      const delay = Math.min(1500, Number.isFinite(after) && after > 0 ? after * 1000 : 300 * 2 ** attempt);
      log(scope, `↻ ${host} HTTP ${response.status} (${response.status === 429 ? 'rate limited' : 'gateway error'}); retrying in ${delay} ms`);
      await response.body?.cancel(); await wait(delay, signal);
    }
    // Failures always show; successes only with LOG_HTTP=1 (the turn story already reports them).
    (response.ok ? debug : log)(scope, `← ${host} HTTP ${response.status} in ${elapsed()}`);
    if (!response.ok) throw new AppraisalProviderError(`Appraisal provider rejected the request (HTTP ${response.status}).`);
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppraisalProviderError('Appraisal provider returned an invalid API response.');
    return data;
  } catch (error) {
    if (signal.aborted) { log(scope, `✗ ${host} timed out or cancelled after ${elapsed()}`); throw new AppraisalProviderError('Appraisal timed out or was cancelled.'); }
    if (error instanceof AppraisalProviderError) throw error;
    // Only the error code (e.g. ENOTFOUND, ECONNREFUSED), never messages that could echo the request.
    const code = (error as { cause?: { code?: unknown } })?.cause?.code;
    log(scope, `✗ ${host} unreachable after ${elapsed()}${typeof code === 'string' ? ` (${code})` : ''}`);
    // Never propagate upstream bodies, fetch errors or JSON parser excerpts.
    throw new AppraisalProviderError('Appraisal provider unavailable or returned an invalid API response.');
  }
}
