import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { scenarios, buildContext } from './orchestrator';
import { ApiError, buildHiggsConfig, mintCredential } from './higgs';
import { ConversationStore } from './store';
import { AdaptationCoordinator } from './adaptation/coordinator';
import { adaptationConfig, type AdaptationConfig } from './adaptation/config';
import type { AppraisalProvider } from './adaptation/providers';
import { z } from 'zod';
import { prepareBranch } from './branching';
const metricPayload = z.strictObject({ turnId: z.string().max(200), responseId: z.string().max(200).optional(),
  inputKind: z.enum(['text', 'audio']).optional(),
  guidanceUncertain: z.boolean().optional(),
  speechEndedAt: z.number().finite().optional(), speechStoppedAt: z.number().finite().optional(), transcriptFinalAt: z.number().finite().optional(),
  responseCreatedAt: z.number().finite().optional(), firstAudioAt: z.number().finite().optional(), playbackStartedAt: z.number().finite().optional(),
  appliedStateVersion: z.number().int().nonnegative() });
// Explicit local frontend origins, including the supported alternate Vite port.
// Do not accept arbitrary loopback ports or hosts that merely start with localhost.
const localOrigins = new Set([3000, 5173, 5174].flatMap(port =>
  [`http://127.0.0.1:${port}`, `http://localhost:${port}`]));
export function createApp(options: { apiKey?: string; fetcher?: typeof fetch; store?: ConversationStore; dist?: string; adaptation?: AdaptationConfig; provider?: AppraisalProvider } = {}) {
  const app = express(); const store = options.store ?? new ConversationStore();
  const coordinator = new AdaptationCoordinator(store, scenarios, options.adaptation ?? adaptationConfig({}), options.provider);
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Local app: reject cross-origin writes; do not provide a public token minting service.
  app.use('/api', (req, _res, next) => {
    const origin = req.get('origin');
    if (origin && !localOrigins.has(origin))
      return next(new ApiError(403, 'Only the local application can use this API.'));
    if (req.get('sec-fetch-site') === 'cross-site') return next(new ApiError(403, 'Cross-site requests are not allowed.'));
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, credentialsConfigured: Boolean(options.apiKey?.trim()) }));
  app.get('/api/scenarios', (_req, res) => res.json(scenarios));
  app.post('/api/sessions', async (req, res) => {
    const scenario = scenarios.find(s => s.id === req.body?.scenarioId);
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
    res.status(201).json({ session, config: buildHiggsConfig(config), credential });
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
  if (existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = err instanceof ApiError ? err.status : err?.type === 'entity.too.large' ? 413 : err instanceof SyntaxError ? 400 : 500;
    res.status(status).json({ error: err instanceof ApiError ? err.message : status === 400 ? 'Invalid JSON request.' : status === 413 ? 'Request is too large.' : 'The local server could not complete this request.' });
  };
  app.use(errors); return app;
}
