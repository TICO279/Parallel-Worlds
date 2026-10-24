/** Bounded fictional actor trials. Does not appraise, change browser sessions or record audio. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Probe } from './probe-adaptation';
import { buildContext, scenarios } from '../server/orchestrator';
import { buildHiggsConfig } from '../server/higgs';
import { compileActingContract } from '../server/acting';
import cases from '../test/fixtures/acting-cases.json';
const baselinePath = 'test/fixtures/acting-baseline.json';
async function main() {
  if (process.argv.includes('--freeze-baseline')) {
    await writeFile(baselinePath, JSON.stringify(Object.fromEntries(scenarios.map(s => [s.id, buildContext(s).instructions])), null, 2), { flag: 'wx' });
    console.log('Frozen current actor prompts; no API requests made.'); return;
  }
  if (!process.argv.includes('--live')) throw new Error('Pass --live to opt into billable Boson text trials.');
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  const rows: any[] = []; const started = Date.now(); const deadline = 240000;
  await mkdir('captures', { recursive: true });
  const label = process.argv.includes('--audio-output') ? 'audio' : 'text';
  const responseOverride = process.argv.includes('--response-override');
  const path = `captures/acting-${label}-${Date.now()}.json`;
  const checkpoint = () => writeFile(path, JSON.stringify({ testedAt: new Date().toISOString(), baseline: '283d73b',
    modality: label, contractTransport: responseOverride ? 'response.instructions' : 'session.instructions',
    method: 'Frozen actor versus explicit current-turn acting contract; no live appraisal. Human action/naturalness ratings pending.', rows }, null, 2));
  const selected = process.argv.includes('--smoke') ? cases.filter(c => ['alex-preference', 'morgan-claim'].includes(c.id)) : cases;
  for (const example of selected) for (const condition of ['baseline', 'contract']) for (let repeat = 0; repeat < (process.argv.includes('--audio-output') ? 1 : 2); repeat++) {
    if (Date.now() - started > deadline - 20000) { console.log('Time box reached; partial report retained.'); await checkpoint(); return; }
    const s = scenarios.find(s => s.id === example.scenarioId)!; const probe = new Probe(); const at = performance.now();
    const instructions = condition === 'baseline' ? baseline[s.id] : compileActingContract(buildContext(s).instructions, example.contract);
    const hash = createHash('sha256').update(instructions).digest('hex'); const metadata = { trial: `${example.id}-${condition}-${repeat}`, contextHash: hash };
    try {
      const config = buildHiggsConfig({ ...buildContext(s), instructions });
      const session = await probe.connect({ ...config, session: { ...(config.session as object), output_modalities: [label === 'audio' ? 'audio' : 'text'], temperature: .3 } });
      for (const h of example.history) probe.send({ type: 'conversation.item.create', item: { type: 'message', role: h.role,
        content: [{ type: h.role === 'user' ? 'input_text' : 'text', text: h.text }] } });
      const from = probe.events.length;
      probe.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: example.utterance }] } });
      probe.send({ type: 'response.create', response: { metadata, ...(condition === 'contract' && responseOverride && { instructions }) } });
      const created = await probe.wait('response.created', from); const done = await probe.wait('response.done', from);
      const events = probe.events.slice(from); const final = events.find(e => ['response.output_text.done', 'response.output_audio_transcript.done'].includes(e.event.type));
      const reply = final?.event.text ?? final?.event.transcript ?? '';
      rows.push({ caseId: example.id, scenarioId: s.id, condition, repeat, utterance: example.utterance, history: example.history,
        contract: condition === 'contract' ? example.contract : undefined, instructions, contextHash: hash,
        instructionAcknowledged: session.instructions === instructions, metadataMatched: created.event.response?.metadata?.contextHash === hash && created.event.response?.metadata?.trial === metadata.trial,
        responseId: created.event.response?.id, responseStatus: done.event.response?.status,
        responseCount: events.filter(e => e.event.type === 'response.created').length, reply,
        firstAudioMs: events.find(e => e.event.type === 'response.output_audio.delta')?.at !== undefined ? Math.round(events.find(e => e.event.type === 'response.output_audio.delta')!.at - at) : undefined,
        audioReceived: events.some(e => e.event.type === 'response.output_audio.delta'), latencyMs: Math.round(performance.now() - at),
        triage: { questionCount: (reply.match(/\?/g) ?? []).length, greetingOnly: /^(hi|hello)[.! ]/i.test(reply),
          praisePhrase: /great|strong start|amazing|impressive|wonderful|fantastic/i.test(reply) },
        humanReview: { intendedAction: null, unsupportedEndorsement: null, gratuitousHostility: null, naturalness: null } });
      console.log(JSON.stringify({ caseId: example.id, condition, repeat, metadataMatched: rows.at(-1).metadataMatched }));
    } catch { rows.push({ caseId: example.id, condition, repeat, failed: true, error: 'Trial failed or timed out; no raw provider error retained.' }); }
    finally { probe.close(); await checkpoint(); }
  }
  console.log(JSON.stringify({ report: path, rows: rows.length, failures: rows.filter(r => r.failed).length }));
}
void main().catch(() => { console.error('Acting trial unavailable. Check project configuration, baseline file and --live.'); process.exitCode = 1; });
