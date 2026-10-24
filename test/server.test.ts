import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { mintCredential } from '../server/higgs';
import { ConversationStore } from '../server/store';
import { scenarios } from '../server/orchestrator';
const token = 'bai-eph-test-credential'; const permanent = 'test-permanent-secret';
const fetcher = vi.fn(async () => new Response(JSON.stringify({ value: token, expires_at: 9999999999, session: { id: 'not-the-socket-session' } }))) as unknown as typeof fetch;
const turn = { itemId: 'a1', role: 'assistant', text: 'Hello', status: 'complete', transcriptFinal: true, order: 0, startedAt: 1, updatedAt: 2 };
describe('memory store', () => {
  it('accepts higher revisions and ignores stale or retried snapshots', () => {
    const store = new ConversationStore(); const s = store.create(scenarios[0]);
    store.snapshot(s.id, 2, [turn]); store.snapshot(s.id, 1, [{ ...turn, text: 'stale' }]);
    expect(store.snapshot(s.id, 2, [turn]).turns[0].text).toBe('Hello');
    expect(() => store.snapshot(s.id, 3, [turn, turn])).toThrow('Invalid');
    expect(() => store.snapshot(s.id, 0, [turn])).toThrow('revision');
  });
  it('allowlists exported fields and notifies finalized turns once', () => {
    const onCompleted = vi.fn(); const store = new ConversationStore(onCompleted); const s = store.create(scenarios[0]);
    store.snapshot(s.id, 1, [{ ...turn, credential: token, BOSON_API_KEY: permanent }]);
    store.snapshot(s.id, 2, [{ ...turn, status: 'interrupted', playedMs: 300 }]);
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(store.get(s.id))).not.toContain(token);
    expect(JSON.stringify(store.get(s.id))).not.toContain(permanent);
    expect(store.get(s.id).turns[0].status).toBe('interrupted');
  });
  it('does not resurrect closed sessions through late lifecycle events', () => {
    const store = new ConversationStore(); const s = store.create(scenarios[0]);
    store.lifecycle(s.id, { status: 'closed' }); store.lifecycle(s.id, { status: 'active', bosonSessionId: 'actual' });
    expect(store.get(s.id)).toMatchObject({ status: 'closed', bosonSessionId: 'actual' });
  });
});
describe('credential adapter', () => {
  it('reports missing keys without calling Boson', async () => { await expect(mintCredential('')).rejects.toThrow('BOSON_API_KEY'); });
  it('does not leak upstream credential errors or network exception messages', async () => {
    await expect(mintCredential(permanent, vi.fn(async () => new Response(permanent + token, { status: 401 })))).rejects.toThrow('rejected');
    await expect(mintCredential(permanent, vi.fn(async () => { throw new Error(permanent); }))).rejects.toThrow('Could not reach Boson');
  });
  it('rejects malformed upstream credential responses', async () => {
    await expect(mintCredential(permanent, vi.fn(async () => new Response('{}')))).rejects.toThrow('invalid client');
  });
});
describe('HTTP application', () => {
  let server: Server; let base: string;
  beforeAll(async () => {
    server = await new Promise<Server>(resolve => { const s = createApp({ apiKey: permanent, fetcher, dist: '__missing_dist__' }).listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
  it('creates a session, records turns and exports without credentials', async () => {
    const response = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenarioId: scenarios[0].id }) });
    expect(response.status).toBe(201); expect(response.headers.get('cache-control')).toBe('no-store');
    const bootstrap = await response.json(); expect(bootstrap.credential.value).toBe(token);
    expect(JSON.stringify(bootstrap)).not.toContain(permanent);
    const id = bootstrap.session.id;
    expect((await fetch(`${base}/api/sessions/${id}/conversation`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 1, turns: [turn] }) })).status).toBe(200);
    const exported = await fetch(`${base}/api/sessions/${id}/export`); const text = await exported.text();
    expect(text).toContain('Hello'); expect(text).not.toContain(token); expect(text).not.toContain(permanent);
    expect(exported.headers.get('content-disposition')).toContain('attachment');
  });
  it('rejects invalid scenarios, cross-site requests and malformed JSON', async () => {
    expect((await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(400);
    expect((await fetch(`${base}/api/scenarios`, { headers: { Origin: 'https://external.example' } })).status).toBe(403);
    expect((await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400);
  });
  for (const port of [3000, 5173, 5174]) for (const host of ['127.0.0.1', 'localhost']) {
    it(`accepts local frontend requests from ${host}:${port}`, async () => {
      const origin = `http://${host}:${port}`;
      const health = await fetch(`${base}/api/health`, { headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin' } });
      expect(health.status).toBe(200);
      const response = await fetch(`${base}/api/sessions`, { method: 'POST',
        headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: scenarios[0].id }) });
      expect(response.status).toBe(201);
    });
  }
  it('still rejects unapproved local ports, deceptive hosts and cross-site browser requests', async () => {
    for (const origin of ['http://localhost:5175', 'http://127.0.0.1:9999', 'http://localhost.attacker.example:5174', 'http://127.0.0.1.attacker.example:5174', 'http://localhost:5174@attacker.example', 'null']) {
      expect((await fetch(`${base}/api/health`, { headers: { Origin: origin } })).status).toBe(403);
    }
    expect((await fetch(`${base}/api/health`, { headers: { Origin: 'http://localhost:5174', 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
  });
  it('accepts the iPhone tunnel only for same-origin HTTPS trycloudflare requests', async () => {
    const tunnel = 'https://quiet-fox.trycloudflare.com';
    expect((await fetch(`${base}/api/health`, { headers: { Origin: tunnel, 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200);
    for (const [origin, site] of [[tunnel, 'cross-site'], [tunnel, 'same-site'], ['http://quiet-fox.trycloudflare.com', 'same-origin'],
      ['https://trycloudflare.com.attacker.example', 'same-origin'], ['https://quiet-fox.trycloudflare.com:8443', 'same-origin']])
      expect((await fetch(`${base}/api/health`, { headers: { Origin: origin, 'Sec-Fetch-Site': site } })).status).toBe(403);
    expect((await fetch(`${base}/api/health`, { headers: { Origin: tunnel } })).status).toBe(403);
  });
  it('starts an adaptive Ember date as the profile on screen, meeting you as your profile shows you', async () => {
    const partner = { name: 'Amara', age: '29', job: 'Architect', interests: 'climbing, jazz', looking: 'Long-term partner', opens: '1' };
    const user = { name: 'Alex', age: 26, gender: 'man', job: 'Grad student', interests: ['Cooking', 'Records'], about: 'I host dinners.' };
    const post = (body: unknown) => fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const response = await post({ scenarioId: 'ember-date', partner, user });
    expect(response.status).toBe(201);
    const bootstrap = await response.json(); const instructions: string = bootstrap.config.session.instructions;
    expect(bootstrap.session).toMatchObject({ scenarioId: 'ember-date:amara', adaptation: { mode: 'adaptive' } });
    for (const text of ['You are Amara', 'Architect', 'matched with Alex', 'Grad student', 'Cooking, Records', 'I host dinners.', 'you speak first'])
      expect(instructions).toContain(text);
    const adaptation = await (await fetch(`${base}/api/sessions/${bootstrap.session.id}/adaptation`)).json();
    expect(adaptation.prepared.instructions).toContain('You are Amara');
    // The lab sees the date and can continue it by id, as the same partner.
    const dates = await (await fetch(`${base}/api/ember/dates`)).json();
    expect(dates.map((d: { scenario: { id: string } }) => d.scenario.id)).toContain('ember-date:amara');
    expect(dates.find((d: { scenario: { id: string } }) => d.scenario.id === 'ember-date:amara').sessions[0].id).toBe(bootstrap.session.id);
    const resumed = await post({ scenarioId: 'ember-date:amara' });
    expect(resumed.status).toBe(201); expect((await resumed.json()).config.session.instructions).toContain('matched with Alex');
    expect((await post({ scenarioId: 'ember-date:nobody' })).status).toBe(400);
    expect((await post({ scenarioId: 'ember-date', partner: { name: '<script>' } })).status).toBe(400);
    const reserved = await (await post({ scenarioId: 'ember-date', partner: { name: 'Leo' } })).json();
    expect(reserved.config.session.instructions).toContain('let them open the conversation');
    expect(reserved.config.session.instructions).not.toContain('matched with');
  });
});
