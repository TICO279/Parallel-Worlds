import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
describe('adaptive HTTP integration', () => {
  let server: Server; let base: string;
  beforeAll(async () => {
    const app = createApp({ apiKey: 'test-server-secret', dist: '__missing_dist__', fetcher: async () => new Response(JSON.stringify({ value: 'bai-eph-test', expires_at: 9999999999 })) });
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
  async function request(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  it('runs mock appraisal, persists history, distinguishes applied state and exports no credentials', async () => {
    const bootstrap = await request('/api/sessions', 'POST', { scenarioId: 'alex-first-date', mode: 'adaptive' }); const id = bootstrap.body.session.id;
    expect(bootstrap.body.session.adaptation).toMatchObject({ mode: 'adaptive', provider: 'mock', appliedVersion: 0 });
    const turn = { itemId: 'u1', order: 0, role: 'user', text: 'I enjoy hiking.', status: 'complete', transcriptFinal: true, startedAt: 1, updatedAt: 2 };
    await request(`/api/sessions/${id}/conversation`, 'PUT', { revision: 1, turns: [turn], adaptation: { states: [] } });
    const appraisal = await request(`/api/sessions/${id}/appraisals`, 'POST', { turnId: 'u1' });
    expect(appraisal.body.states).toHaveLength(2); expect(appraisal.body.appliedVersion).toBe(0);
    const ready = await request(`/api/sessions/${id}/adaptation`); expect(ready.body.prepared).toMatchObject({ version: 1 });
    expect(ready.body.prepared.instructions).toContain('Alex'); expect(ready.body.synchronousQualified).toBe(false);
    expect((await request(`/api/sessions/${id}/adaptation/application`, 'POST', { version: 99, status: 'acknowledged' })).status).toBe(400);
    await request(`/api/sessions/${id}/adaptation/application`, 'POST', { version: 1, status: 'acknowledged' });
    const exported = await request(`/api/sessions/${id}/export`);
    expect(exported.body.adaptation.appliedVersion).toBe(1); expect(exported.body.adaptation.states[0].trust).toBe(.4);
    expect(JSON.stringify(exported.body)).not.toMatch(/test-server-secret|bai-eph/);
  });
  it('computes end-to-end latency and preserves later milestones when older requests arrive late', async () => {
    const bootstrap = await request('/api/sessions', 'POST', { scenarioId: 'alex-first-date' }); const id = bootstrap.body.session.id;
    const metric = { turnId: 'u1', speechEndedAt: 100, speechStoppedAt: 600, transcriptFinalAt: 800, responseCreatedAt: 650, firstAudioAt: 1100, playbackStartedAt: 1150, appliedStateVersion: 0 };
    const measured = await request(`/api/sessions/${id}/latencies`, 'POST', metric);
    expect(measured.body).toMatchObject({ endToEndMs: 1050, firstAudioMs: 1000, transcriptDelayMs: 700 });
    const stale = await request(`/api/sessions/${id}/latencies`, 'POST', { turnId: 'u1', speechStoppedAt: 600, appliedStateVersion: 0 });
    expect(stale.body.endToEndMs).toBe(1050);
    expect((await request(`/api/sessions/${id}/latencies`, 'POST', { ...metric, credential: 'not-allowed' })).status).toBe(400);
  });
  it('keeps static mode and rejects invalid appraisal/mode requests', async () => {
    expect((await request('/api/sessions', 'POST', { scenarioId: 'alex-first-date', mode: 'synchronous' })).status).toBe(400);
    const bootstrap = await request('/api/sessions', 'POST', { scenarioId: 'alex-first-date' }); const id = bootstrap.body.session.id;
    expect((await request(`/api/sessions/${id}/appraisals`, 'POST', { turnId: 'missing' })).status).toBe(409);
    expect((await request(`/api/sessions/${id}/adaptation`)).body.states).toHaveLength(1);
  });
});
