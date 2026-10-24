import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdaptivePanel } from '../src/AdaptivePanel';
import { pollAdaptation, type AdaptationView } from '../src/adaptationPolling';
import { initialState } from '../server/adaptation/engine';
import { scenarios } from '../server/orchestrator';
import { loadTrees, saveTrees } from '../src/treeStorage';

const initial = initialState(scenarios[0].character, 's', 1);
const state = { ...initial, id: 's:main:1', version: 1, trust: .44, lastProcessedTurnId: 'u1' };
const data = (): AdaptationView => ({ mode: 'adaptive', timingMode: 'asynchronous', provider: 'mock', appraisalTimeoutMs: 1500,
  maxStateDelta: .1, states: [initial, state], attempts: [], applications: [], latencies: [], appliedVersion: 0, pending: false,
  prepared: { version: 1, instructions: 'Current guidance' } });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('score display', () => {
  it('explains static mode and does not present initial numbers as live scores', () => {
    const html = renderToStaticMarkup(<AdaptivePanel character="Alex" data={{ ...data(), mode: 'static' }} latency={null} notice={null}/>);
    expect(html).toContain('Static · scores paused'); expect(html).toContain('Select Adaptive'); expect(html).not.toContain('<meter');
  });
  it('shows normalized scores, changes and separately acknowledged scores', () => {
    const html = renderToStaticMarkup(<AdaptivePanel character="Alex" data={data()} latency={null} notice={null} connected/>);
    expect(html).toContain('44 / 100'); expect(html).toContain('+4 points'); expect(html).toContain('Boson acknowledged: 40'); expect(html).toContain('u1');
  });
  it('makes failed and pending appraisal visible without inventing new values', () => {
    const snapshot = data(); snapshot.pending = true;
    snapshot.attempts = [{ turnId: 'u2', baseVersion: 1, status: 'failed', provider: 'deepseek', latencyMs: 1500, at: 1, error: 'Appraisal timed out or was cancelled.' }];
    const html = renderToStaticMarkup(<AdaptivePanel character="Alex" data={snapshot} latency={null} notice={null}/>);
    expect(html).toContain('Appraisal failed:'); expect(html).toContain('APPRAISAL_TIMEOUT_MS'); expect(html).toContain('Appraisal in progress'); expect(html).toContain('44 / 100');
  });
  it('shows a saved checkpoint without claiming it was acknowledged in a new live session', () => {
    const html = renderToStaticMarkup(<AdaptivePanel character="Alex" data={null} latency={null} notice={null} preview={state}/>);
    expect(html).toContain('Saved branch checkpoint'); expect(html).toContain('44 / 100'); expect(html).not.toContain('Boson acknowledged');
    expect(html).not.toContain('timeout');
  });
  it('labels restored starting values as branch scores rather than initial values', () => {
    const html = renderToStaticMarkup(<AdaptivePanel character="Alex" data={{ ...data(), states: [{ ...state, version: 0 }] }} latency={null} notice={null} restored/>);
    expect(html).toContain('Restored branch scores'); expect(html).not.toContain('Initial scores;');
  });
  it('labels typed timing correctly and shows the guidance version present before response creation', () => {
    const html = renderToStaticMarkup(<AdaptivePanel character="Alex" data={data()} latency={{ turnId: 'u1', inputKind: 'text', speechStoppedAt: 100, firstAudioAt: 400, responseCreatedAt: 200, appliedStateVersion: 0 }} notice={null}/>);
    expect(html).toContain('Message sent'); expect(html).toContain('300 ms');
    expect(html).toContain('Guidance acknowledged before the latest reply:'); expect(html).toContain('v0. Later updates');
  });
  it('labels an instruction update overlapping a new turn as uncertain', () => {
    const html = renderToStaticMarkup(<AdaptivePanel character="Alex" data={data()} latency={{ turnId: 'u1', responseCreatedAt: 200, appliedStateVersion: 0, guidanceUncertain: true }} notice={null}/>);
    expect(html).toContain('Which guidance affected this reply is uncertain.');
  });
});
describe('score synchronization', () => {
  it('keeps loading until the final pending appraisal is committed after disconnect', async () => {
    vi.useFakeTimers(); const snapshots = [{ ...data(), pending: true }, data()];
    const onData = vi.fn(); const load = vi.fn(async () => snapshots.shift()!);
    const stop = pollAdaptation({ load, onData, onError: vi.fn(), keepPolling: d => Boolean(d?.pending), intervalMs: 10 });
    await vi.advanceTimersByTimeAsync(50);
    expect(load).toHaveBeenCalledTimes(2); expect(onData).toHaveBeenLastCalledWith(expect.objectContaining({ pending: false })); stop();
  });
  it('ignores an old session result after its poller is cancelled', async () => {
    let resolve!: (d: AdaptationView) => void; const onData = vi.fn();
    const stop = pollAdaptation({ load: () => new Promise(r => { resolve = r; }), onData, onError: vi.fn(), keepPolling: () => true });
    await Promise.resolve(); stop(); resolve(data()); await Promise.resolve(); await Promise.resolve();
    expect(onData).not.toHaveBeenCalled();
  });
  it('serializes requests and clears a temporary refresh failure on recovery', async () => {
    vi.useFakeTimers(); const onError = vi.fn(); const onData = vi.fn(); let reject!: () => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise((_r, fail) => { reject = () => fail(new Error('offline')); })).mockResolvedValue(data());
    const stop = pollAdaptation({ load, onData, onError, keepPolling: d => !d, intervalMs: 10 });
    await vi.advanceTimersByTimeAsync(50); expect(load).toHaveBeenCalledTimes(1);
    reject(); await vi.advanceTimersByTimeAsync(20); expect(onError).toHaveBeenCalledTimes(1); expect(onData).toHaveBeenCalledTimes(1); stop();
  });
});
describe('tree persistence', () => {
  it('reports unavailable storage and ignores malformed persisted data', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{"alex-first-date":{"nodes":{"bad":{}},"headId":null}}', setItem: () => { throw new Error('quota'); } });
    expect(loadTrees()).toEqual({}); expect(saveTrees({})).toBe(false);
  });
});
