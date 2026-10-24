import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ApiError } from './higgs';
import { realismAppraisalSchema } from '../shared/characterState';
import { compileSpeechStyle, type SpeechSnapshot } from '../shared/tts';
import type { ConversationStore } from './store';

// Historical fictional test conversations. Never interpreted as current-user appraisal.
function savedAppraisals(scenarioId: string) {
  try {
    const data = JSON.parse(readFileSync(new URL('../docs/realism-confirmation-results.json', import.meta.url), 'utf8'));
    return (data.rows as any[]).filter(r => r.scenarioId === scenarioId && r.attempt?.provider === 'deepseek' && r.attempt?.status === 'committed')
      .flatMap(r => { const p = realismAppraisalSchema.safeParse(r.attempt.appraisal); return p.success ? [{ appraisal: p.data, utterance: String(r.utterance) }] : []; });
  } catch { return []; }
}
const prepareSchema = z.strictObject({ turnNumber: z.number().int().min(1).max(2000), source: z.enum(['saved', 'neutral', 'live']),
  maxStateVersion: z.number().int().nonnegative().optional() });
const speechSchema = z.strictObject({ snapshotId: z.string().uuid(), itemId: z.string().min(1).max(200),
  text: z.string().min(1).max(5000), voice: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) });
export function registerTts(app: Express, store: ConversationStore, key?: string, fetcher: typeof fetch = fetch) {
  const snapshots = new Map<string, { sessionId: string; snapshot: SpeechSnapshot }>();
  app.post('/api/sessions/:id/tts/prepare', (req, res) => {
    const session = store.get(String(req.params.id));
    if (session.speechMode !== 'tts' || session.status === 'closed') throw new ApiError(409, 'Start a TTS conversation first.');
    const p = prepareSchema.safeParse(req.body); if (!p.success) throw new ApiError(400, 'Invalid voice preparation.');
    if (p.data.source !== (session.speechStyleSource ?? 'saved')) throw new ApiError(409, 'Delivery source must match the current session.');
    if (p.data.source === 'live' && p.data.maxStateVersion === undefined) throw new ApiError(400, 'Live delivery needs the previously observed state version.');
    // Freeze at the START of user turn N. Turn 1 is neutral; N uses saved appraisal N-1.
    const examples = p.data.source === 'saved' ? savedAppraisals(session.scenarioId) : [];
    const example = p.data.turnNumber > 1 ? examples[Math.min(p.data.turnNumber - 2, examples.length - 1)] : undefined;
    const state = p.data.source === 'live' ? session.adaptation?.states.filter(s => s.version <= p.data.maxStateVersion!).at(-1) : undefined;
    const a = p.data.source === 'live' ? state?.realism?.assessment : example?.appraisal;
    // Turn-specific moves expire. Only a persistent boundary move carries forward.
    const input = a && { tone: a.tone, expression: a.brief.expression,
      move: a.brief.scope === 'persistent' ? a.brief.move : 'acknowledge' as const, uncertainty: a.uncertainty.level };
    const style = compileSpeechStyle(input);
    const snapshot: SpeechSnapshot = { id: randomUUID(), style, turnNumber: p.data.turnNumber,
      source: a && p.data.source === 'live' ? `Live ${session.adaptation?.provider} appraisal` : example ? 'Saved DeepSeek example (not a live evaluation)' : 'Neutral fallback',
      ...(input && { input }), ...(example && { fixtureTurn: example.utterance }),
      ...(state && { stateVersion: state.version, appraisalTurnId: state.lastProcessedTurnId ?? undefined }),
      ...(!a && { fallbackReason: p.data.source === 'live' ? 'No completed appraisal observed before this user turn. Keeping neutral delivery.' : 'No saved appraisal selected.' }) };
    if (snapshots.size >= 2000) snapshots.delete(snapshots.keys().next().value!);
    snapshots.set(snapshot.id, { sessionId: session.id, snapshot }); res.json(snapshot);
  });
  app.post('/api/sessions/:id/tts', async (req, res) => {
    const session = store.get(String(req.params.id));
    if (session.speechMode !== 'tts' || session.status === 'closed') throw new ApiError(409, 'Start a TTS conversation first.');
    const p = speechSchema.safeParse(req.body); if (!p.success) throw new ApiError(400, 'Invalid speech request (maximum 5,000 characters).');
    const frozen = snapshots.get(p.data.snapshotId);
    if (!frozen || frozen.sessionId !== session.id) throw new ApiError(409, 'Voice snapshot expired. Start a new turn.');
    if (!key?.trim()) throw new ApiError(503, 'Set BOSON_API_KEY to enable speech.');
    // Prevent reply text from injecting its own delivery tags. Visible words stay intact.
    if (/<\|[\s\S]*?\|>/.test(p.data.text)) throw new ApiError(400, 'Speech text contains unsupported control tags.');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45000);
    const cancel = () => { if (!res.writableEnded) controller.abort(); }; res.on('close', cancel);
    const started = Date.now();
    try {
      const upstream = await fetcher('https://api.boson.ai/v1/audio/speech', { method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'higgs-tts-3', input: frozen.snapshot.style.prefix + p.data.text,
          voice: p.data.voice, response_format: 'wav', stream: false, normalize: false }) });
      if (!upstream.ok) throw new ApiError(502, `Boson speech request failed (HTTP ${upstream.status}). Check voice, account access and credit.`);
      const length = Number(upstream.headers.get('content-length'));
      if (length > 20_000_000) throw new ApiError(502, 'Speech response exceeded the audio limit.');
      const reader = upstream.body?.getReader(); if (!reader) throw new ApiError(502, 'Boson returned no audio.');
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) { const r = await reader.read(); if (r.done) break; size += r.value.length;
        if (size > 20_000_000) { controller.abort(); throw new ApiError(502, 'Speech response exceeded the audio limit.'); } chunks.push(r.value); }
      const bytes = Buffer.concat(chunks);
      if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new ApiError(502, 'Boson returned an invalid WAV response.');
      const record = { ...frozen.snapshot, itemId: p.data.itemId, text: p.data.text, voice: p.data.voice,
        model: 'higgs-tts-3', synthesisMs: Date.now() - started, bytes: size };
      store.recordSpeech(session.id, record);
      res.type('audio/wav').send(bytes);
    } catch (e) {
      if (res.destroyed) return;
      throw e instanceof ApiError ? e : new ApiError(502, 'Speech unavailable or timed out. The text reply is still available.');
    } finally { clearTimeout(timer); res.off('close', cancel); }
  });
}
