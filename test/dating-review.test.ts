import { describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { validateDatingReview } from '../shared/datingReview';
import { emptyTree, revertTo, pathTo, seedEvents } from '../shared/tree';
const turns = [{ nodeId: 's/u1', role: 'user' as const, text: 'Do you like books?' }, { nodeId: 's/a1', role: 'assistant' as const, text: 'I enjoy mysteries.' }];
const review = { strength: null, suggestions: [{ nodeId: 's/u1', quote: 'Do you like books?', title: 'Invite a story', explanation: 'An open question gives your date more room to share.', alternative: 'What kind of books stay with you?' }] };
async function harness(run: (base: string, upstream: ReturnType<typeof vi.fn>) => Promise<void>, output: unknown = review, key: string | undefined = 'review-secret') {
  let calls = 0;
  const upstream = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(Array.isArray(output) ? output[Math.min(calls++, output.length - 1)] : output) } }] })));
  const server = await new Promise<Server>(resolve => { const s = createApp({ dist: '__missing__',
    adaptation: { provider: 'mock', model: 'unused', timeoutMs: 1500, maxDelta: .1, deepSeekKey: key }, reviewFetcher: upstream as typeof fetch }).listen(0, '127.0.0.1', () => resolve(s)); });
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`, upstream); }
  finally { await new Promise<void>(r => server.close(() => r())); }
}
const request = (base: string, body: unknown) => fetch(base + '/api/dating-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
describe('dating feedback with exact-turn evidence', () => {
  it('rejects invented targets, assistant targets, fabricated quotes and duplicate IDs', () => {
    expect(validateDatingReview(review, turns)).toEqual(review);
    for (const bad of [{ nodeId: 'missing' }, { nodeId: 's/a1', quote: 'I enjoy' }, { quote: 'not in transcript' }])
      expect(() => validateDatingReview({ ...review, suggestions: [{ ...review.suggestions[0], ...bad }] }, turns)).toThrow();
    expect(() => validateDatingReview(review, [...turns, turns[0]])).toThrow();
  });
  it('returns validated coaching using a separate private DeepSeek request', () => harness(async (base, upstream) => {
    const response = await request(base, { scenarioId: 'alex-first-date', turns });
    expect(response.status).toBe(200); expect(await response.json()).toEqual(review);
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(String(init.body)); expect(body.model).toBe('deepseek-flash');
    expect(body.messages[0].content).toContain('untrusted quoted data');
    expect(JSON.parse(body.messages[1].content).turns).toEqual(turns);
  }));
  it('retries a malformed model review once without weakening evidence checks', () => harness(async (base, upstream) => {
    const r = await request(base, { scenarioId: 'alex-first-date', turns });
    expect(r.status).toBe(200); expect(await r.json()).toEqual(review); expect(upstream).toHaveBeenCalledTimes(2);
  }, [{ strength: null, suggestions: [{ ...review.suggestions[0], nodeId: 'invented' }] }, review]));
  it('rejects invalid paths without spending a model call', () => harness(async (base, upstream) => {
    for (const body of [{ scenarioId: 'morgan-interview', turns }, { scenarioId: 'alex-first-date', turns: [turns[0], turns[0]] }])
      expect((await request(base, body)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  }));
  it('reports an unavailable key without generating dummy feedback', () => harness(async (base, upstream) => {
    expect((await request(base, { scenarioId: 'alex-first-date', turns })).status).toBe(503); expect(upstream).not.toHaveBeenCalled();
  }, review, ''));
  it('does not expose or render an invalid model response', () => harness(async (base) => {
    const r = await request(base, { scenarioId: 'alex-first-date', turns });
    expect(r.status).toBe(502); expect(await r.text()).not.toContain('private-provider-text');
  }, { strength: null, suggestions: [{ ...review.suggestions[0], nodeId: 'private-provider-text' }] }));
  it('practice branches before the selected user line without deleting the original', () => {
    const tree = { ...emptyTree(), headId: 's/a1', nodes: {
      's/u1': { id: 's/u1', itemId: 'u1', sessionId: 's', parentId: null, role: 'user' as const, text: turns[0].text, status: 'complete' as const, createdAt: 1 },
      's/a1': { id: 's/a1', itemId: 'a1', sessionId: 's', parentId: 's/u1', role: 'assistant' as const, text: turns[1].text, status: 'complete' as const, createdAt: 2 },
    } };
    const retry = revertTo(tree, 's/u1');
    expect(retry.headId).toBeNull(); expect(Object.keys(retry.nodes)).toEqual(Object.keys(tree.nodes));
    expect(seedEvents(pathTo(retry, retry.headId))).toEqual([]); expect(tree.headId).toBe('s/a1');
  });
});
