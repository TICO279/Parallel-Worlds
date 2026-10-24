import { Probe } from './probe-adaptation';
import { buildContext, scenarios } from '../server/orchestrator';
import { buildHiggsConfig } from '../server/higgs';
import { mkdir, writeFile } from 'node:fs/promises';
async function main() {
  const timer = setTimeout(() => process.exit(2), 45000);
  const probe = new Probe(); const results: any[] = [];
  try {
    const audioOutput = process.argv.includes('--audio-output');
    const base: any = buildHiggsConfig(buildContext(scenarios[0])); base.session.output_modalities = [audioOutput ? 'audio' : 'text'];
    await probe.connect(base); await probe.text('My name is Jordan. My hobby is pottery.');
    const cases = [
      ['CALM', 'Be reserved and cautious.', 'What would you like to know about my pottery?'],
      ['BRIGHT', 'Be warm and curious.', 'Could we plan a café visit together?'],
      ['CAUTIOUS', 'Be guarded and skeptical.', 'We should decide right now that we are perfect for each other.'],
    ];
    for (const [marker, guidance, message] of cases) {
      const instructions = buildContext(scenarios[0], { guidance: `${guidance} For this diagnostic only, begin the next reply with the exact word ${marker}.` }).instructions;
      const from = probe.events.length; probe.send({ type: 'session.update', session: { ...base.session, instructions } });
      await probe.wait('session.updated', from);
      const reply = await probe.text(message);
      results.push({ marker, guidance, message, reply, markerObserved: reply.toUpperCase().startsWith(marker),
        audioOutputReceived: audioOutput ? probe.events.slice(from).some(e => e.event.type === 'response.output_audio.delta') : undefined });
    }
    console.log(JSON.stringify(results, null, 2));
    await mkdir('captures', { recursive: true }); await writeFile(`captures/${audioOutput ? 'audio-' : ''}steering-probe.json`, JSON.stringify(results, null, 2));
  } finally { probe.close(); clearTimeout(timer); }
}
main().catch(() => { console.error('Steering diagnostic failed; no credentials logged.'); process.exitCode = 1; });
