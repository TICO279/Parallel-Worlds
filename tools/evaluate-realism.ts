/** Controlled fictional text trials. Real API calls require --live; no audio or credentials are saved. */
import { mkdir, writeFile } from 'node:fs/promises';
import { Probe } from './probe-adaptation';
import { emptyConversation, orderedTurns, reduceTranscript } from '../shared/transcript';
import sequences from '../test/fixtures/realism-sequences.json';
const base = 'http://127.0.0.1:3000';
const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
async function api(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(base + path, { method, signal: AbortSignal.timeout(35000), headers: { 'Content-Type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  if (!r.ok) throw new Error(`Local evaluation HTTP ${r.status}.`); return r.json();
}
async function main() {
  if (!process.argv.includes('--live')) throw new Error('Pass --live to make billable requests with the configured project provider.');
  const label = arg('--label') ?? 'revised'; if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid report label.');
  const selected = process.argv.includes('--smoke') ? sequences.filter(s => ['alex-boundary', 'alex-humor'].includes(s.id)) : sequences;
  const rows: any[] = []; const failures: any[] = []; const started = Date.now();
  const deadline = setTimeout(() => process.exit(2), process.argv.includes('--smoke') ? 180000 : 900000);
  try {
    for (const example of selected) for (const mode of ['static', 'adaptive'] as const) {
      if (Date.now() - started > (process.argv.includes('--smoke') ? 160000 : 870000)) break;
      const bootstrap = await api('/api/sessions', 'POST', { scenarioId: example.scenarioId, mode });
      const id = bootstrap.session.id; const probe = new Probe(); let state = emptyConversation(); let cursor = 0; let revision = 0;
      try {
        const ack = await probe.connect({ ...bootstrap.config, session: { ...bootstrap.config.session, output_modalities: ['text'] } }, bootstrap.credential);
        await api(`/api/sessions/${id}`, 'PATCH', { status: 'active', bosonSessionId: ack.id });
        for (const utterance of example.turns) {
          const before = await api(`/api/sessions/${id}/adaptation`); const at = performance.now();
          const reply = await probe.text(utterance);
          for (const received of probe.events.slice(cursor)) {
            const e = { ...received.event };
            if (e.type === 'response.output_text.delta') e.type = 'response.output_audio_transcript.delta';
            if (e.type === 'response.output_text.done') { e.type = 'response.output_audio_transcript.done'; e.transcript = e.text; }
            state = reduceTranscript(state, e, Date.now() - performance.now() + received.at);
          }
          cursor = probe.events.length; const turns = orderedTurns(state);
          await api(`/api/sessions/${id}/conversation`, 'PUT', { revision: ++revision, turns });
          if (mode === 'adaptive') {
            await api(`/api/sessions/${id}/appraisals`, 'POST', { turnId: turns.filter(t => t.role === 'user').at(-1)!.itemId });
            const current = await api(`/api/sessions/${id}/adaptation`); const from = probe.events.length;
            await api(`/api/sessions/${id}/adaptation/application`, 'POST', { version: current.prepared.version, status: 'dispatched' });
            probe.send({ type: 'session.update', session: { instructions: current.prepared.instructions } });
            const updated = await probe.wait('session.updated', from);
            if (updated.event.session?.instructions !== current.prepared.instructions) throw new Error('Instruction acknowledgement mismatch.');
            await api(`/api/sessions/${id}/adaptation/application`, 'POST', { version: current.prepared.version, status: 'acknowledged' });
          }
          const after = await api(`/api/sessions/${id}/adaptation`);
          rows.push({ caseId: example.id, scenarioId: example.scenarioId, mode, utterance, reply,
            provider: after.provider, model: after.model, contextBeforeResponse: before.prepared,
            acknowledgedBeforeResponse: before.appliedVersion, stateBefore: before.states.at(-1), stateAfter: after.states.at(-1),
            attempt: after.attempts.at(-1), instructionApplication: after.applications.at(-1),
            instructionCommittedAt: after.instructionHistory?.at(-1)?.at,
            responseAndRecordingMs: Math.round(performance.now() - at) });
          console.log(JSON.stringify({ label, caseId: example.id, mode, committedVersion: after.states.at(-1).version, attempt: after.attempts.at(-1)?.status }));
        }
      } catch { failures.push({ caseId: example.id, mode, error: 'Live trial failed or timed out; no raw provider error retained.' }); }
      finally { probe.close(); await api(`/api/sessions/${id}`, 'PATCH', { status: 'closed' }).catch(() => {}); }
    }
  } finally {
    clearTimeout(deadline); await mkdir('captures', { recursive: true });
    await writeFile(`captures/realism-${label}.json`, JSON.stringify({ label, testedAt: new Date().toISOString(), modality: 'text',
      method: 'Automatic reply uses previously acknowledged guidance; appraisal is committed afterward. Not a same-turn control trial.', rows, failures }, null, 2));
    console.log(JSON.stringify({ report: `captures/realism-${label}.json`, rows: rows.length, failures: failures.length }));
  }
}
void main().catch(() => { console.error('Realism evaluation failed. Check project configuration and use --live.'); process.exitCode = 1; });
