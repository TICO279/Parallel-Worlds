import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { scenarios, buildContext } from './orchestrator';
import { ApiError, buildHiggsConfig, mintCredential } from './higgs';
import { ConversationStore } from './store';
import { AdaptationCoordinator } from './adaptation/coordinator';
import { adaptationConfig, type AdaptationConfig } from './adaptation/config';
import type { AppraisalProvider } from './adaptation/providers';
import type { Decider } from './adaptation/decisions';
import { openSpeech } from './speech';
import { log } from './log';
import { z } from 'zod';
import { prepareBranch } from './branching';
import type { Scenario, StoredSession } from '../shared/domain';
import { EMBER_DATE, isPartnerScenario, scenarioFromPartner } from '../shared/partner';
const metricPayload = z.strictObject({ turnId: z.string().max(200), responseId: z.string().max(200).optional(),
  inputKind: z.enum(['text', 'audio']).optional(),
  guidanceUncertain: z.boolean().optional(),
  speechEndedAt: z.number().finite().optional(), speechStoppedAt: z.number().finite().optional(), transcriptFinalAt: z.number().finite().optional(),
  responseCreatedAt: z.number().finite().optional(), firstAudioAt: z.number().finite().optional(), playbackStartedAt: z.number().finite().optional(),
  appliedStateVersion: z.number().int().nonnegative() });
const judgePayload = z.strictObject({ turnId: z.string().min(1).max(200) });
const speechPayload = z.strictObject({ replyItemId: z.string().min(1).max(200), text: z.string().trim().min(1).max(8000),
  userItemId: z.string().max(200).optional(), discardedDraft: z.string().max(8000).optional() });
// Explicit local frontend origins, including the supported alternate Vite port.
// Do not accept arbitrary loopback ports or hosts that merely start with localhost.
const localOrigins = new Set([3000, 5173, 5174].flatMap(port =>
  [`http://127.0.0.1:${port}`, `http://localhost:${port}`]));
function tunnelOrigin(origin: string) {
  try { const url = new URL(origin); return url.protocol === 'https:' && url.hostname.endsWith('.trycloudflare.com') && !url.port; } catch { return false; }
}
export function createApp(options: { apiKey?: string; fetcher?: typeof fetch; store?: ConversationStore; dist?: string; dating?: string; adaptation?: AdaptationConfig; provider?: AppraisalProvider; decider?: Decider; speechFetcher?: typeof fetch } = {}) {
  const app = express(); const store = options.store ?? new ConversationStore();
  const config = options.adaptation ?? adaptationConfig({});
  const coordinator = new AdaptationCoordinator(store, scenarios, config, options.provider, options.decider);
  const speech = config.speech ?? { model: 'higgs-tts-3', voice: 'default', timeoutMs: 15000 };
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Local app: reject cross-origin writes; do not provide a public token minting service.
  app.use('/api', (req, _res, next) => {
    const origin = req.get('origin');
    // The iPhone reaches the app through a Cloudflare tunnel; the browser marks those calls same-origin.
    if (origin && !localOrigins.has(origin) && !(tunnelOrigin(origin) && req.get('sec-fetch-site') === 'same-origin'))
      return next(new ApiError(403, 'Only the local application can use this API.'));
    if (req.get('sec-fetch-site') === 'cross-site') return next(new ApiError(403, 'Cross-site requests are not allowed.'));
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, credentialsConfigured: Boolean(options.apiKey?.trim()) }));
  app.get('/api/scenarios', (_req, res) => res.json(scenarios));
  // Dates started from Ember (phone), grouped by partner, so the lab can show their trees and scores.
  app.get('/api/ember/dates', (_req, res) => {
    const dates = new Map<string, { scenario: Scenario; sessions: StoredSession[] }>();
    for (const session of store.list().filter(s => isPartnerScenario(s.scenarioId))) {
      const entry = dates.get(session.scenarioId) ?? { scenario: store.scenario(session.id)!, sessions: [] };
      entry.scenario = store.scenario(session.id) ?? entry.scenario; entry.sessions.push(session); dates.set(session.scenarioId, entry);
    }
    res.json([...dates.values()]);
  });
  app.post('/api/sessions', async (req, res) => {
    const id = req.body?.scenarioId;
    // An Ember date: her profile and yours. The lab continues one by its id once the server has seen it.
    const scenario = id === EMBER_DATE ? scenarioFromPartner(req.body?.partner, req.body?.user)
      : scenarios.find(s => s.id === id) ?? (typeof id === 'string' && isPartnerScenario(id) ? store.latestScenario(id) : undefined);
    if (!scenario) throw new ApiError(400, 'Choose a valid scenario.');
    // The app always uses adaptive; static stays available to scripts and tests.
    const mode = req.body?.mode ?? 'adaptive';
    if (mode !== 'static' && mode !== 'adaptive') throw new ApiError(400, 'Choose static or adaptive mode.');
    const resumed = prepareBranch(req.body?.history, scenario, store, mode === 'adaptive');
    const credential = await mintCredential(options.apiKey, options.fetcher);
    const created = store.create(scenario);
    if (resumed.branch) store.setBranch(created.id, resumed.branch);
    coordinator.initialize(created.id, mode, resumed.restored);
    const prepared = coordinator.instructions(created.id); const session = store.get(created.id);
    const config = { ...buildContext(scenario), instructions: prepared.instructions };
    // Higgs writes replies as text; the speech route voices them with Higgs TTS 3.
    res.status(201).json({ session, config: buildHiggsConfig(config, { text: true }), credential });
  });
  app.patch('/api/sessions/:id', (req, res) => {
    const session = store.lifecycle(req.params.id, req.body);
    if (session.status === 'closed' || session.status === 'error') coordinator.cancel(session.id);
    res.json(session);
  });
  app.get('/api/sessions/:id/adaptation', (req, res) => {
    const prepared = coordinator.instructions(req.params.id);
    res.json({ ...coordinator.get(req.params.id), prepared, steering: 'experimental', synchronousQualified: false });
  });
  // Step 0: judge a recorded user line (decision model; full appraisal on a major shift).
  app.post('/api/sessions/:id/judge', async (req, res) => {
    const body = judgePayload.safeParse(req.body);
    if (!body.success) throw new ApiError(400, 'Invalid judge request.');
    res.json(await coordinator.judgeTurn(req.params.id, body.data.turnId));
  });
  // Step 2: choose an emotion per sentence and stream the reply as PCM16 24 kHz from Higgs TTS 3.
  app.post('/api/sessions/:id/speech', async (req, res) => {
    const body = speechPayload.safeParse(req.body);
    if (!body.success) throw new ApiError(400, 'Invalid speech request.');
    const { replyItemId, text, discardedDraft, userItemId } = body.data; const id = req.params.id; store.get(id);
    const controller = new AbortController();
    // The browser aborts when the user interrupts; stop paying for audio nobody will hear.
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    const { input, record } = await coordinator.voice(id, replyItemId, text, controller.signal);
    // Ember partners speak in a voice that matches their profile; others use TTS_VOICE.
    const own = store.scenario(id)?.character.voice; const voice = own && own !== 'default' ? { ...speech, voice: own } : speech;
    const tag = `session ${id.slice(0, 8)} reply ${replyItemId}`;
    const tts = { model: voice.model, voice: voice.voice, input, seconds: 0, ms: 0 };
    const finish = (extra: Partial<typeof tts> & { firstAudioMs?: number; stopped?: boolean; error?: string }) =>
      coordinator.finishTurn(id, { reply: text, ...(discardedDraft !== undefined && { discardedDraft }), ...(userItemId && { userItemId }), tts: { ...tts, ...extra } });
    let opened;
    try { opened = await openSpeech(options.speechFetcher ?? fetch, options.apiKey, voice, input, controller.signal, tag); }
    catch (error) {
      const message = error instanceof ApiError ? error.message : 'Text-to-speech failed.';
      coordinator.recordVoiceTiming(id, replyItemId, { error: message });
      finish(controller.signal.aborted ? { stopped: true } : { error: message }); throw error;
    }
    res.status(200).set({ 'Content-Type': 'audio/pcm', 'X-Audio-Format': 'pcm16;rate=24000;channels=1',
      'X-Voice-Emotions': record.sentences.map(s => s.emotion).join(',') });
    let bytes = 0; let first: number | undefined; let broken = false;
    try {
      for await (const chunk of opened.body as unknown as AsyncIterable<Uint8Array>) {
        if (first === undefined) first = Math.round(performance.now() - opened.started);
        bytes += chunk.length; if (!res.write(chunk)) await new Promise(r => res.once('drain', r));
        if (controller.signal.aborted) break;
      }
    } catch {
      broken = !controller.signal.aborted;
      if (broken) log('tts', `✗ stream broke for ${tag} after ${(bytes / 48000).toFixed(1)} s of audio`);
    } finally {
      coordinator.recordVoiceTiming(id, replyItemId, { ...(first !== undefined && { ttsFirstAudioMs: first }) });
      finish({ seconds: bytes / 48000, ms: Math.round(performance.now() - opened.started), ...(first !== undefined && { firstAudioMs: first }),
        ...(controller.signal.aborted && { stopped: true }), ...(broken && { error: 'the audio stream broke' }) });
      res.end();
    }
  });
  app.post('/api/sessions/:id/appraisals', async (req, res) => {
    const session = store.get(req.params.id);
    if (session.adaptation?.mode !== 'adaptive') throw new ApiError(409, 'Session uses static mode.');
    const turn = session.turns.find(t => t.itemId === req.body?.turnId && t.role === 'user' && t.transcriptFinal && t.status === 'complete');
    if (!turn) throw new ApiError(409, 'Record the finalized user turn before requesting appraisal.');
    await coordinator.enqueue(session.id);
    res.json(coordinator.get(session.id));
  });
  app.post('/api/sessions/:id/adaptation/application', (req, res) => {
    const data = coordinator.get(req.params.id);
    const { version, status } = req.body ?? {};
    if (!Number.isSafeInteger(version) || !data.states.some(s => s.version === version) || !['acknowledged', 'failed', 'deferred', 'dispatched'].includes(status)) throw new ApiError(400, 'Invalid state application.');
    if (status === 'acknowledged' && version > data.appliedVersion) data.appliedVersion = version;
    if (!data.applications.some(a => a.version === version && a.status === status)) data.applications.push({ version, status, at: Date.now() });
    store.setAdaptation(req.params.id, data); res.json(data);
  });
  app.post('/api/sessions/:id/latencies', (req, res) => {
    const result = metricPayload.safeParse(req.body);
    if (!result.success) throw new ApiError(400, 'Invalid latency measurement.');
    let metric = result.data; const data = coordinator.get(req.params.id);
    if (!data.states.some(s => s.version === metric.appliedStateVersion)) throw new ApiError(400, 'Unknown applied state version.');
    const elapsed = (end?: number, start?: number) => end !== undefined && start !== undefined && end >= start ? Math.round(end - start) : undefined;
    const index = data.latencies.findIndex(l => l.turnId === metric.turnId);
    if (index >= 0) {
      const old = data.latencies[index];
      metric = { ...old, ...metric, appliedStateVersion: metric.responseCreatedAt === undefined && old.responseCreatedAt !== undefined ? old.appliedStateVersion : metric.appliedStateVersion };
    }
    const start = metric.speechEndedAt ?? metric.speechStoppedAt;
    const entry = { ...metric, endToEndMs: elapsed(metric.playbackStartedAt, start),
      firstAudioMs: elapsed(metric.firstAudioAt, start), transcriptDelayMs: elapsed(metric.transcriptFinalAt, start) };
    if (index >= 0) data.latencies[index] = entry; else data.latencies.push(entry);
    store.setAdaptation(req.params.id, data); res.json(entry);
  });
  app.put('/api/sessions/:id/conversation', (req, res) => res.json(store.snapshot(req.params.id, req.body?.revision, req.body?.turns)));
  app.get('/api/sessions/:id/export', (req, res) => {
    const session = store.get(req.params.id);
    res.attachment(`parallel-worlds-${session.id}.json`).json(session);
  });
  app.get('/api/sessions/:id', (req, res) => res.json(store.get(req.params.id)));
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'API route not found.')));
  const dist = options.dist ?? resolve('dist');
  // Built app: the lab and live date under /practice (Vite base), Ember's static pages at /.
  if (existsSync(resolve(dist, 'index.html'))) {
    app.use('/practice', express.static(dist));
    app.get('/practice/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
    app.use(express.static(options.dating ?? resolve('dating'), { dotfiles: 'ignore' }));
  }
  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = err instanceof ApiError ? err.status : err?.type === 'entity.too.large' ? 413 : err instanceof SyntaxError ? 400 : 500;
    res.status(status).json({ error: err instanceof ApiError ? err.message : status === 400 ? 'Invalid JSON request.' : status === 413 ? 'Request is too large.' : 'The local server could not complete this request.' });
  };
  app.use(errors); return app;
}
