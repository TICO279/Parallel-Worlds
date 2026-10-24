import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { scenarios, buildContext } from './orchestrator';
import { ApiError, buildHiggsConfig, mintCredential } from './higgs';
import { ConversationStore } from './store';
export function createApp(options: { apiKey?: string; fetcher?: typeof fetch; store?: ConversationStore; dist?: string } = {}) {
  const app = express(); const store = options.store ?? new ConversationStore();
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Local app: reject cross-origin writes; do not provide a public token minting service.
  app.use('/api', (req, _res, next) => {
    const origin = req.get('origin');
    if (origin && !['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://localhost:3000'].includes(origin))
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
    const credential = await mintCredential(options.apiKey, options.fetcher);
    res.status(201).json({ session: store.create(scenario), config: buildHiggsConfig(buildContext(scenario)), credential });
  });
  app.patch('/api/sessions/:id', (req, res) => res.json(store.lifecycle(req.params.id, req.body)));
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
