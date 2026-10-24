/** Opt-in live text evaluation of the local app + mock state engine + real Higgs. */
import { mkdir, writeFile } from 'node:fs/promises';
import { Probe } from './probe-adaptation';
import { emptyConversation, orderedTurns, reduceTranscript } from '../shared/transcript';
import evaluation from '../test/fixtures/adaptation-evaluation.json';
const base = 'http://127.0.0.1:3000';
async function api(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(base + path, { method, signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  if (!res.ok) throw new Error(`Local evaluation request failed (HTTP ${res.status}).`);
  return res.json();
}
async function main() {
  if (!process.argv.includes('--live')) throw new Error('Run with --live to opt into real Boson requests. No OpenAI requests are made.');
  const deadline = setTimeout(() => process.exit(2), 120000); const report: any[] = [];
  try {
    for (const mode of ['static', 'adaptive'] as const) {
      const bootstrap = await api('/api/sessions', 'POST', { scenarioId: 'alex-first-date', mode });
      if (bootstrap.session.adaptation.provider !== 'mock') throw new Error('Evaluation requires the mock provider; it will not use an external appraisal key.');
      const id = bootstrap.session.id; const probe = new Probe(); let state = emptyConversation(); let cursor = 0; let revision = 0;
      try {
        const config = { ...bootstrap.config, session: { ...bootstrap.config.session, output_modalities: ['text'] } };
        const ack = await probe.connect(config, bootstrap.credential);
        await api(`/api/sessions/${id}`, 'PATCH', { status: 'active', bosonSessionId: ack.id });
        const cases = [...evaluation, { category: 'Repair following violated boundary', utterance: 'I apologize. What would help us reset this conversation?' }];
        for (const example of cases) {
          const before = await api(`/api/sessions/${id}/adaptation`);
          const started = performance.now(); const reply = await probe.text(example.utterance);
          for (const received of probe.events.slice(cursor)) {
            const e = { ...received.event };
            if (e.type === 'response.output_text.delta') e.type = 'response.output_audio_transcript.delta';
            if (e.type === 'response.output_text.done') { e.type = 'response.output_audio_transcript.done'; e.transcript = e.text; }
            state = reduceTranscript(state, e, Date.now() - performance.now() + received.at);
          }
          cursor = probe.events.length;
          const turns = orderedTurns(state); await api(`/api/sessions/${id}/conversation`, 'PUT', { revision: ++revision, turns });
          const latestUser = turns.filter(t => t.role === 'user').at(-1)!;
          if (mode === 'adaptive') {
            await api(`/api/sessions/${id}/appraisals`, 'POST', { turnId: latestUser.itemId });
            const data = await api(`/api/sessions/${id}/adaptation`); const from = probe.events.length;
            probe.send({ type: 'session.update', session: { instructions: data.prepared.instructions } });
            await probe.wait('session.updated', from);
            await api(`/api/sessions/${id}/adaptation/application`, 'POST', { version: data.prepared.version, status: 'acknowledged' });
          }
          const data = await api(`/api/sessions/${id}/adaptation`);
          const row = { mode, category: example.category, utterance: example.utterance, reply, responseGuidanceVersion: before.appliedVersion,
            committedVersion: data.states.at(-1).version, acknowledgedVersion: data.appliedVersion,
            tone: data.states.at(-1).tone, responseAndRecordingMs: Math.round(performance.now() - started) };
          report.push(row); console.log(JSON.stringify(row));
        }
      } finally { probe.close(); await api(`/api/sessions/${id}`, 'PATCH', { status: 'closed' }); }
    }
    await mkdir('captures', { recursive: true }); await writeFile('captures/adaptation-evaluation.json', JSON.stringify({ testedAt: new Date().toISOString(), provider: 'mock', modality: 'text', rows: report }, null, 2));
  } finally { clearTimeout(deadline); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Live evaluation failed.'); process.exitCode = 1; });
