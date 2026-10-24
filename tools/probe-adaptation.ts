/** Isolated, bounded protocol diagnostics. Never changes a running browser session. */
import dotenv from 'dotenv';
import WebSocket from 'ws';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildHiggsConfig, mintCredential } from '../server/higgs';
import { buildContext, scenarios } from '../server/orchestrator';
import type { ProtocolEvent } from '../shared/domain';

dotenv.config({ quiet: true });
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
export class Probe {
  events: { event: any; at: number }[] = [];
  private socket!: WebSocket;
  async connect(config: ProtocolEvent, suppliedCredential?: { value: string }) {
    const credential = suppliedCredential ?? await mintCredential(process.env.BOSON_API_KEY);
    this.socket = new WebSocket('wss://api.boson.ai/v1/realtime?model=higgs-realtime', ['realtime', `bai-client-secret.${credential.value}`]);
    this.socket.on('message', raw => { try { this.events.push({ event: JSON.parse(String(raw)), at: performance.now() }); } catch {} });
    this.socket.on('error', () => {});
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket connection timeout')), 10000);
      this.socket.once('open', () => { clearTimeout(timer); resolve(); });
      this.socket.once('error', () => { clearTimeout(timer); reject(new Error('Socket connection failed')); });
    });
    this.send(config);
    return (await this.wait('session.created')).event.session;
  }
  send(e: ProtocolEvent) { this.socket.send(JSON.stringify(e)); }
  async wait(type: string, from = 0, timeout = 10000) {
    const until = performance.now() + timeout;
    while (performance.now() < until) {
      const events = this.events.slice(from);
      if (events.some(e => e.event.type === 'error')) throw new Error('Boson rejected protocol operation');
      const event = events.find(e => e.event.type === type);
      if (event) return event;
      if (this.socket.readyState > 1) throw new Error('Boson closed the diagnostic session');
      await pause(20);
    }
    throw new Error(`Timed out waiting for ${type}`);
  }
  async text(text: string) {
    const from = this.events.length;
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    this.send({ type: 'response.create' });
    await this.wait('response.done', from);
    const completed = this.events.slice(from).find(e => ['response.output_text.done', 'response.output_audio_transcript.done'].includes(e.event.type));
    return completed?.event.text ?? completed?.event.transcript ?? '';
  }
  close() { if (this.socket?.readyState === 1) this.socket.close(); else this.socket?.terminate(); }
}
function pcmFromWav(buffer: Buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error('TTS did not return WAV');
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const name = buffer.toString('ascii', offset, offset + 4); const size = buffer.readUInt32LE(offset + 4);
    if (name === 'fmt ' && (buffer.readUInt32LE(offset + 12) !== 24000 || buffer.readUInt16LE(offset + 10) !== 1 || buffer.readUInt16LE(offset + 22) !== 16)) throw new Error('Expected 24 kHz mono PCM16');
    if (name === 'data') return buffer.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + size % 2;
  }
  throw new Error('WAV has no audio data');
}
async function audioFixture() {
  const response = await fetch('https://api.boson.ai/v1/audio/speech', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${process.env.BOSON_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'higgs-tts-3', input: 'I like quiet cafés and pottery. What about you?', voice: 'default', response_format: 'wav' }),
  });
  if (!response.ok) throw new Error(`Synthetic speech unavailable (HTTP ${response.status})`);
  return pcmFromWav(Buffer.from(await response.arrayBuffer()));
}
async function main() {
  const deadline = setTimeout(() => { console.error('Protocol experiment time box exhausted. Keep asynchronous fallback.'); process.exit(2); }, 180000);
  const results: Record<string, any> = { testedAt: new Date().toISOString(), timeBoxSeconds: 180, instructionUpdates: [], responseTiming: [], synchronousQualified: false };
  const scenario = scenarios[0]; const base = buildHiggsConfig(buildContext(scenario));
  const textConfig = { ...base, session: { ...(base.session as object), output_modalities: ['text'] } };
  const guidance = ['Be reserved and cautious; ask one gentle question.', 'Be warm and curious; express a little enthusiasm.', 'Be guarded and skeptical; politely question assumptions.'];
  for (let repetition = 0; repetition < 3; repetition++) {
    const probe = new Probe();
    try {
      const initial = await probe.connect(textConfig);
      await probe.text('My name is Jordan. I enjoy pottery. Please remember that.');
      for (let i = 0; i < guidance.length; i++) {
        const instructions = buildContext(scenario, { guidance: guidance[i] }).instructions;
        const from = probe.events.length;
        // Compare partial updates with complete updates without assuming merge semantics.
        probe.send({ type: 'session.update', session: i === 0 ? { instructions } : { ...(textConfig.session as object), instructions } });
        const ack = (await probe.wait('session.updated', from)).event.session;
        const reply = await probe.text('What is my name and hobby, and what would you suggest we talk about next?');
        const result = { repetition, guidance: guidance[i], updateKind: i === 0 ? 'instructions-only' : 'complete',
          sessionRetained: initial.id === ack.id, configurationRetained: JSON.stringify(initial.audio) === JSON.stringify(ack.audio) && JSON.stringify(initial.output_modalities) === JSON.stringify(ack.output_modalities),
          instructionAcknowledged: ack.instructions === instructions, contextMentioned: /Jordan/i.test(reply) && /pottery/i.test(reply), reply };
        results.instructionUpdates.push(result); console.log(JSON.stringify(result));
      }
    } catch (error) { results.instructionUpdates.push({ repetition, error: error instanceof Error ? error.message : 'Experiment failed' }); }
    finally { probe.close(); }
  }
  try {
    const audio = await audioFixture();
    for (const delayMs of [250, 1000, 2000]) {
      const probe = new Probe();
      try {
        const session: any = structuredClone(base.session);
        session.audio.input.turn_detection.create_response = false;
        const ack = await probe.connect({ type: 'session.update', session });
        const from = probe.events.length;
        for (let i = 0; i < audio.length; i += 4800) { probe.send({ type: 'input_audio_buffer.append', audio: audio.subarray(i, i + 4800).toString('base64') }); await pause(100); }
        for (let i = 0; i < 10; i++) { probe.send({ type: 'input_audio_buffer.append', audio: Buffer.alloc(4800).toString('base64') }); await pause(100); }
        const stopped = await probe.wait('input_audio_buffer.speech_stopped', from);
        const transcript = await probe.wait('conversation.item.input_audio_transcription.completed', from);
        await pause(delayMs);
        const premature = probe.events.slice(from).some(e => e.event.type === 'response.created');
        const updateStart = probe.events.length;
        probe.send({ type: 'session.update', session: { ...session, instructions: buildContext(scenario, { guidance: guidance[1] }).instructions } });
        const updated = await probe.wait('session.updated', updateStart);
        const requestedAt = performance.now(); probe.send({ type: 'response.create' });
        const firstAudio = await probe.wait('response.output_audio.delta', from);
        await probe.wait('response.done', from);
        const result = { delayMs, resolvedCreateResponse: ack.audio?.input?.turn_detection?.create_response,
          prematureResponse: premature, responseCount: probe.events.slice(from).filter(e => e.event.type === 'response.created').length,
          transcriptAfterStopMs: Math.round(transcript.at - stopped.at), updateAckAfterTranscriptMs: Math.round(updated.at - transcript.at),
          firstAudioAfterStopMs: Math.round(firstAudio.at - stopped.at), firstAudioAfterRequestMs: Math.round(firstAudio.at - requestedAt) };
        results.responseTiming.push(result); console.log(JSON.stringify(result));
      } catch (error) { results.responseTiming.push({ delayMs, error: error instanceof Error ? error.message : 'Experiment failed' }); }
      finally { probe.close(); }
    }
  } catch (error) { results.responseTiming.push({ error: error instanceof Error ? error.message : 'Audio experiment failed' }); }
  // This short probe alone does not qualify synchronous interruption/cancellation recovery.
  results.synchronousQualified = false;
  await mkdir('captures', { recursive: true });
  await writeFile('captures/adaptation-probe.json', JSON.stringify(results, null, 2));
  console.log('Sanitized results: captures/adaptation-probe.json. Synchronous production mode remains disabled pending complete recovery trials.');
  clearTimeout(deadline);
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url))
  main().catch(() => { console.error('Protocol probe failed; no credentials were logged.'); process.exitCode = 1; });
