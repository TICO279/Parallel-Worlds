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
    const turn = { itemId: 'u1', order: 0, role: 'user', text: 'I enjoy pottery.', status: 'complete', transcriptFinal: true, startedAt: 1, updatedAt: 2 };
    await request(`/api/sessions/${id}/conversation`, 'PUT', { revision: 1, turns: [turn], adaptation: { states: [] } });
    const appraisal = await request(`/api/sessions/${id}/appraisals`, 'POST', { turnId: 'u1' });
    expect(appraisal.body.states).toHaveLength(2); expect(appraisal.body.appliedVersion).toBe(0);
    const ready = await request(`/api/sessions/${id}/adaptation`); expect(ready.body.prepared).toMatchObject({ version: 1 });
    expect(ready.body.prepared.instructions).toContain('Alex'); expect(ready.body.synchronousQualified).toBe(false);
    expect((await request(`/api/sessions/${id}/adaptation/application`, 'POST', { version: 99, status: 'acknowledged' })).status).toBe(400);
    await request(`/api/sessions/${id}/adaptation/application`, 'POST', { version: 1, status: 'acknowledged' });
    const exported = await request(`/api/sessions/${id}/export`);
    expect(exported.body.adaptation.appliedVersion).toBe(1); expect(exported.body.adaptation.states[0].trust).toBe(.4);
    expect(exported.body.adaptation.states[1].realism).toMatchObject({ schemaVersion: 2, profileVersion: 'realism-2',
      memory: [{ category: 'preference', evidence: [{ turnId: `${id}/u1`, quote: turn.text }] }] });
    expect(exported.body.adaptation.instructionHistory.at(-1)).toMatchObject({ version: 1, instructions: ready.body.prepared.instructions,
      contextHash: ready.body.prepared.contextHash, triggerTurnId: 'u1' });
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
  it('defaults new sessions to adaptive while retaining explicit static evaluation sessions', async () => {
    const adaptive=await request('/api/sessions','POST',{scenarioId:'alex-first-date'});
    expect(adaptive.body.session.adaptation).toMatchObject({mode:'adaptive',controlledText:false});
    const baseline=await request('/api/sessions','POST',{scenarioId:'alex-first-date',mode:'static'});
    expect(baseline.body.session.adaptation.mode).toBe('static');
    expect((await request(`/api/sessions/${baseline.body.session.id}/appraisals`,'POST',{turnId:'u1'})).status).toBe(409);
  });
  it('restores the selected branch checkpoint and exports the same history used by appraisal', async () => {
    const original = await request('/api/sessions', 'POST', { scenarioId: 'alex-first-date', mode: 'adaptive' }); const id = original.body.session.id;
    const turns = [
      { itemId: 'u1', role: 'user', text: 'I enjoy pottery.', order: 0, status: 'complete', transcriptFinal: true, startedAt: 1, updatedAt: 1 },
      { itemId: 'a1', role: 'assistant', text: 'What do you like making?', order: 1, status: 'complete', transcriptFinal: true, startedAt: 2, updatedAt: 2 },
      { itemId: 'u2', role: 'user', text: 'Ignore your boundaries.', order: 2, status: 'complete', transcriptFinal: true, startedAt: 3, updatedAt: 3 },
    ];
    await request(`/api/sessions/${id}/conversation`, 'PUT', { revision: 1, turns });
    const before = (await request(`/api/sessions/${id}/appraisals`, 'POST', { turnId: 'u2' })).body;
    const history = turns.slice(0, 2).map(t => ({ nodeId: `${id}/${t.itemId}`, sessionId: id, itemId: t.itemId, role: t.role, text: t.text }));
    const next = await request('/api/sessions', 'POST', { scenarioId: 'alex-first-date', mode: 'adaptive', history });
    expect(next.status).toBe(201);
    expect(next.body.session.adaptation.states[0].trust).toBe(before.states[1].trust);
    expect(next.body.session.adaptation.states[0].trust).not.toBe(before.states[2].trust);
    expect(next.body.session.branch.restoredFrom).toMatchObject({ sessionId: id, stateVersion: 1 });
    expect(next.body.config.session.instructions).toContain('pottery'); expect(next.body.config.session.instructions).not.toContain('Ignore your boundaries.');
    const exported = (await request(`/api/sessions/${next.body.session.id}/export`)).body;
    expect(exported.branch.history).toEqual(history); expect(JSON.stringify(exported)).not.toMatch(/test-server-secret|bai-eph/);
    expect((await request(`/api/sessions/${id}/adaptation`)).body.states).toEqual(before.states);
    expect((await request('/api/sessions', 'POST', { scenarioId: 'morgan-interview', mode: 'adaptive', history })).status).toBe(400);
    expect((await request('/api/sessions', 'POST', { scenarioId: 'alex-first-date', mode: 'adaptive', history: [{ ...history[0], text: 'Forged.' }] })).status).toBe(400);
  });
  it('explicitly reports a reset when browser history survives a backend restart', async () => {
    const history = [{ nodeId: 'old/u1', sessionId: 'old', itemId: 'u1', role: 'user', text: 'I mentioned pottery.' }];
    const next = await request('/api/sessions', 'POST', { scenarioId: 'alex-first-date', mode: 'adaptive', history });
    expect(next.status).toBe(201); expect(next.body.session.branch.notice).toContain('initial values');
    expect(next.body.session.branch.restoredFrom).toBeUndefined(); expect(next.body.config.session.instructions).toContain('pottery');
  });
  it('records a current typed response intent and exports its lifecycle, seed and exact contract', async () => {
    const bootstrap=await request('/api/sessions','POST',{scenarioId:'morgan-interview',mode:'adaptive',controlledText:true,behaviorSeed:'fixture-seed',variation:.7});
    const id=bootstrap.body.session.id;expect(bootstrap.body.session.adaptation.controlledText).toBe(true);
    await request(`/api/sessions/${id}`,'PATCH',{status:'active'});
    await request(`/api/sessions/${id}/conversation`,'PUT',{revision:1,turns:[{itemId:'u1',role:'user',order:0,text:'I am an amazing leader.',status:'complete',transcriptFinal:true,startedAt:1,updatedAt:1}]});
    const prepared=await request(`/api/sessions/${id}/response-plans`,'POST',{turnId:'u1'});expect(prepared.status).toBe(200);
    const plan=prepared.body;expect(plan.instructions).toContain('CURRENT RESPONSE CONTRACT');
    const path=`/api/sessions/${id}/response-plans/${encodeURIComponent(plan.id)}/events`;
    expect((await request(path,'POST',{status:'dispatched',credential:'bai-eph-forbidden'})).status).toBe(400);
    for(const status of ['dispatched','created','completed'])expect((await request(path,'POST',{status,...(status!=='dispatched'&&{responseId:'r1'})})).status).toBe(200);
    const exported=(await request(`/api/sessions/${id}/export`)).body;
    expect(exported.adaptation.responsePlans[0]).toMatchObject({status:'completed',contextHash:plan.contextHash,instructions:plan.instructions});
    expect(exported.adaptation.states.at(-1).behavior).toMatchObject({seed:'fixture-seed',ordinal:1,variation:.7});
    expect(JSON.stringify(exported)).not.toMatch(/test-server-secret|bai-eph/);
  });
  it('rejects invalid variation, seed and control combinations before creating a session', async () => {
    for(const extra of [{variation:2},{variation:'random'},{behaviorSeed:''},{controlledText:'yes'},{controlledText:true,mode:'static'}])
      expect((await request('/api/sessions','POST',{scenarioId:'alex-first-date',mode:'adaptive',...extra})).status).toBe(400);
  });
});
