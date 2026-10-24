import { describe, expect, it, vi } from 'vitest';
import { adaptationConfig } from '../server/adaptation/config';
import { createProvider, DeepSeekAppraisalProvider, MockAppraisalProvider, OpenAIAppraisalProvider, type AppraisalInput } from '../server/adaptation/providers';
import { AppraisalProviderError, tokenUsage, unpackAppraisalResult } from '../server/adaptation/results';
import { AdaptationCoordinator } from '../server/adaptation/coordinator';
import { initialState } from '../server/adaptation/engine';
import { scenarios } from '../server/orchestrator';
import { ConversationStore } from '../server/store';
import type { Turn } from '../shared/domain';
import { realismProposal } from './helpers/realism';

const appraisal = { interpretation: 'A personal disclosure.', deltas: { comfort: .04, trust: .05, curiosity: .03, engagement: .04 },
  tone: 'warm', goal: 'Build understanding.', guidance: 'Acknowledge the disclosure gently.' };
const input: AppraisalInput = { character: scenarios[0].character, previous: initialState(scenarios[0].character, 's', 1), utterance: 'I feel nervous.', context: [] };
const usage = { prompt_tokens: 250, completion_tokens: 90, total_tokens: 340, prompt_cache_hit_tokens: 100,
  prompt_cache_miss_tokens: 150, completion_tokens_details: { reasoning_tokens: 0 }, credential: 'must-not-persist' };
const normalizedUsage = { inputTokens: 250, outputTokens: 90, totalTokens: 340, cachedInputTokens: 100, reasoningTokens: 0 };
const completion = (content: unknown = JSON.stringify(appraisal), finish_reason = 'stop') => ({ choices: [{ finish_reason, message: { content } }], usage });
const providerFor = (data: unknown) => new DeepSeekAppraisalProvider('test-secret', 'deepseek-flash', vi.fn(async () => new Response(JSON.stringify(data))));

describe('DeepSeek configuration and JSON adapter', () => {
  it('defaults to deterministic mock regardless of available credentials', () => {
    const config = adaptationConfig({ DEEPSEEK_API_KEY: 'unused', OPENAI_API_KEY: 'unused' });
    expect(config.provider).toBe('mock'); expect(config.deepSeekKey).toBeUndefined(); expect(config.openAIKey).toBeUndefined();
    expect(createProvider(config)).toBeInstanceOf(MockAppraisalProvider);
  });
  it('selects Flash by default only after explicit provider selection and requires its key', () => {
    expect(() => adaptationConfig({ APPRAISAL_PROVIDER: 'deepseek' })).toThrow('DEEPSEEK_API_KEY');
    expect(() => adaptationConfig({ APPRAISAL_PROVIDER: 'unknown' })).toThrow('must be');
    const config = adaptationConfig({ DEEPSEEK_API_KEY: 'inherited' }, { APPRAISAL_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: ' project-secret ' });
    expect(config).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash', deepSeekKey: 'project-secret' });
    expect(createProvider(config)).toBeInstanceOf(DeepSeekAppraisalProvider);
    expect(adaptationConfig({ APPRAISAL_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'key', APPRAISAL_MODEL: ' deepseek-v4-pro ' }).model).toBe('deepseek-v4-pro');
    expect(adaptationConfig({ APPRAISAL_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'key', APPRAISAL_MODEL: ' ' }).model).toBe('deepseek-flash');
  });
  it('preserves explicit OpenAI selection and its provider-specific default', () => {
    const config = adaptationConfig({ APPRAISAL_PROVIDER: 'openai', APPRAISAL_OPENAI_PROJECT_KEY: 'true', OPENAI_API_KEY: 'project-key', APPRAISAL_MODEL: '' });
    expect(config.model).toBe('gpt-6-luna'); expect(createProvider(config)).toBeInstanceOf(OpenAIAppraisalProvider);
  });
  it('uses the compatible endpoint, JSON mode, compact shape, disabled thinking and caller cancellation', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(completion()))) as typeof fetch;
    const signal = new AbortController().signal;
    const result = await new DeepSeekAppraisalProvider('test-secret', 'benchmark-model', fetcher).appraise(input, signal);
    expect(unpackAppraisalResult(result)).toEqual({ appraisal, telemetry: { model: 'benchmark-model', usage: normalizedUsage } });
    const [url, request] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions'); expect(request?.signal).toBe(signal);
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer test-secret' });
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({ model: 'benchmark-model', response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, stream: false, max_tokens: 900 });
    expect(body.messages[0].content).toContain('JSON'); expect(body.messages[0].content).toContain('"deltas"');
    expect(body.messages[0].content).toContain('untrusted quoted data'); expect(JSON.parse(body.messages[1].content)).toEqual(input);
    expect(JSON.stringify(result)).not.toMatch(/test-secret|must-not-persist/);
  });
  for (const [label, content] of [
    ['empty', ''], ['whitespace', '  '], ['null', null], ['missing', undefined], ['wrong type', {}],
    ['malformed JSON', '{"interpretation":'], ['markdown', '```json\n{}\n```'], ['missing fields', '{}'],
    ['unknown fields', JSON.stringify({ ...appraisal, extra: true })], ['invalid tone', JSON.stringify({ ...appraisal, tone: 'happy' })],
    ['invalid number', JSON.stringify({ ...appraisal, deltas: { ...appraisal.deltas, trust: '0.1' } })],
    ['overlong guidance', JSON.stringify({ ...appraisal, guidance: 'a'.repeat(401) })],
  ]) it(`rejects ${label} while preserving returned usage`, async () => {
    const body = completion(content); if (content === undefined) delete body.choices[0].message.content;
    const error = await providerFor(body).appraise(input, new AbortController().signal).catch(e => e);
    expect(error).toBeInstanceOf(AppraisalProviderError); if (!(error instanceof AppraisalProviderError)) throw new Error('Expected sanitized provider error.');
    expect(error.telemetry.usage).toEqual(normalizedUsage);
    expect(error.message).not.toContain('test-secret');
  });
  for (const finish of ['length', 'content_filter', 'tool_calls']) it(`rejects incomplete output (${finish}) even if JSON is valid`, async () => {
    await expect(providerFor(completion(JSON.stringify(appraisal), finish)).appraise(input, new AbortController().signal)).rejects.toThrow('did not complete');
  });
  for (const body of [{}, { choices: [] }, { choices: null }, { choices: [{ finish_reason: 'stop' }] }, null, []]) it(`rejects missing API structure ${JSON.stringify(body)}`, async () => {
    await expect(providerFor(body).appraise(input, new AbortController().signal)).rejects.toBeInstanceOf(AppraisalProviderError);
  });
  for (const status of [401, 429, 500]) it(`sanitizes HTTP ${status} failures`, async () => {
    const provider = new DeepSeekAppraisalProvider('test-secret', 'deepseek-flash', vi.fn(async () => new Response('upstream-test-secret', { status })));
    await expect(provider.appraise(input, new AbortController().signal)).rejects.toThrow(`HTTP ${status}`);
    await expect(provider.appraise(input, new AbortController().signal)).rejects.not.toThrow('test-secret');
  });
  it('sanitizes network errors and malformed HTTP JSON', async () => {
    for (const fetcher of [vi.fn(async () => { throw new Error('url-with-test-secret'); }), vi.fn(async () => new Response('test-secret'))]) {
      await expect(new DeepSeekAppraisalProvider('test-secret', 'deepseek-flash', fetcher).appraise(input, new AbortController().signal)).rejects.toThrow('unavailable or returned an invalid API response');
    }
  });
  it('handles cancellation before setup and while awaiting a request', async () => {
    const cancelled = new AbortController(); cancelled.abort(); const unused = vi.fn();
    await expect(new DeepSeekAppraisalProvider('key', 'model', unused).appraise(input, cancelled.signal)).rejects.toThrow('cancelled'); expect(unused).not.toHaveBeenCalled();
    const controller = new AbortController();
    const fetcher = vi.fn((_url, request) => new Promise<Response>((_resolve, reject) => request?.signal?.addEventListener('abort', () => reject(new Error('sensitive abort')), { once: true }))) as typeof fetch;
    const pending = new DeepSeekAppraisalProvider('key', 'model', fetcher).appraise(input, controller.signal); controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
  });
  it('normalizes usage for both live providers and treats missing/invalid statistics as unknown', () => {
    expect(tokenUsage(usage, 'deepseek')).toEqual(normalizedUsage);
    expect(tokenUsage({ input_tokens: 250, output_tokens: 90, total_tokens: 340, input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 0 } }, 'openai')).toEqual(normalizedUsage);
    for (const bad of [undefined, {}, { ...usage, total_tokens: -1 }, { ...usage, prompt_tokens: '250' }, { ...usage, total_tokens: 1 }, { ...usage, prompt_cache_hit_tokens: 251 }]) expect(tokenUsage(bad, 'deepseek')).toBeUndefined();
  });
  it('validates legacy raw providers and metadata envelopes through the same appraisal schema', () => {
    expect(unpackAppraisalResult(appraisal).appraisal).toEqual(appraisal);
    expect(() => unpackAppraisalResult({ kind: 'appraisal-result', appraisal: {}, usage: normalizedUsage })).toThrow();
  });
  it('keeps concurrent request usage separate and supports responses with missing usage', async () => {
    const fetcher = vi.fn(async (_url, request) => {
      const body = JSON.parse(String(request?.body)); const utterance = JSON.parse(body.messages[1].content).utterance;
      await new Promise(resolve => setTimeout(resolve, utterance === 'first' ? 10 : 0));
      const response = completion();
      return new Response(JSON.stringify({ ...response, usage: utterance === 'first' ? usage : undefined }));
    }) as typeof fetch;
    const provider = new DeepSeekAppraisalProvider('test-secret', 'deepseek-flash', fetcher);
    const [first, second] = await Promise.all(['first', 'second'].map(utterance => provider.appraise({ ...input, utterance }, new AbortController().signal)));
    expect(unpackAppraisalResult(first).telemetry.usage).toEqual(normalizedUsage);
    expect(unpackAppraisalResult(second).telemetry.usage).toBeUndefined();
  });
  it('records OpenAI usage using the same provider-independent telemetry envelope', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: 'completed',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(appraisal) }] }],
      usage: { input_tokens: 250, output_tokens: 90, total_tokens: 340 } })));
    const result = await new OpenAIAppraisalProvider('test-secret', 'configured-model', fetcher).appraise(input, new AbortController().signal);
    expect(unpackAppraisalResult(result).telemetry).toMatchObject({ model: 'configured-model', usage: { inputTokens: 250, outputTokens: 90, totalTokens: 340 } });
  });
  it('requires the evidence-based schema for identified production turns and uses the configured output budget', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(completion(JSON.stringify(realismProposal('s/u1', input.utterance)))))) as typeof fetch;
    const provider = new DeepSeekAppraisalProvider('key', 'deepseek-flash', fetcher, 1800);
    const result = await provider.appraise({ ...input, turnId: 's/u1' }, new AbortController().signal);
    expect(unpackAppraisalResult(result).appraisal).toMatchObject({ schemaVersion: 2, evidence: [{ turnId: 's/u1', quote: input.utterance }] });
    const body = JSON.parse(String(vi.mocked(fetcher).mock.calls[0][1]?.body));
    expect(body.max_tokens).toBe(1800); expect(body.messages[0].content).toContain('memoryOperations');
    await expect(providerFor(completion()).appraise({ ...input, turnId: 's/u1' }, new AbortController().signal)).rejects.toThrow('invalid structured output');
  });
});

describe('DeepSeek coordination and recording', () => {
  const turn: Turn = { itemId: 'u1', role: 'user', order: 0, text: input.utterance, transcriptFinal: true, status: 'complete', startedAt: 1, updatedAt: 2 };
  async function run(provider: DeepSeekAppraisalProvider, timeoutMs = 1500) {
    const store = new ConversationStore();
    const coordinator = new AdaptationCoordinator(store, scenarios, { provider: 'deepseek', model: 'deepseek-flash', timeoutMs, maxDelta: .1 }, provider);
    const session = store.create(scenarios[0]); coordinator.initialize(session.id, 'adaptive');
    store.snapshot(session.id, 1, [turn]); await coordinator.enqueue(session.id);
    return store.get(session.id).adaptation!;
  }
  it('exports request-specific model, latency and usage and retains asynchronous operation', async () => {
    const provider = new DeepSeekAppraisalProvider('test-secret', 'deepseek-flash', vi.fn(async (_url, request) => {
      const input = JSON.parse(JSON.parse(String(request?.body)).messages[1].content);
      return new Response(JSON.stringify(completion(JSON.stringify(realismProposal(input.turnId, input.utterance)))));
    }) as typeof fetch);
    const data = await run(provider);
    expect(data).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash', timingMode: 'asynchronous', appliedVersion: 0 });
    expect(data.states).toHaveLength(2); expect(data.attempts[0]).toMatchObject({ status: 'committed', model: 'deepseek-flash', usage: normalizedUsage });
    expect(data.attempts[0].latencyMs).toBeGreaterThanOrEqual(0); expect(JSON.stringify(data)).not.toMatch(/test-secret|must-not-persist/);
  });
  it('records usage for invalid output while retaining the previous state', async () => {
    const data = await run(providerFor(completion('not json')));
    expect(data.states).toHaveLength(1); expect(data.attempts[0]).toMatchObject({ status: 'failed', usage: normalizedUsage });
  });
  it('enforces the configured deadline, aborts the HTTP request and records unknown usage', async () => {
    let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn((_url, request) => { signal = request?.signal; return new Promise<Response>(() => {}); }) as typeof fetch;
    const data = await run(new DeepSeekAppraisalProvider('test-secret', 'deepseek-flash', fetcher), 15);
    expect(signal?.aborted).toBe(true); expect(data.states).toHaveLength(1);
    expect(data.attempts[0]).toMatchObject({ status: 'failed', model: 'deepseek-flash' });
    expect(data.attempts[0].usage).toBeUndefined(); expect(data.attempts[0].latencyMs).toBeGreaterThanOrEqual(10);
  });
});
