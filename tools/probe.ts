import dotenv from 'dotenv';
import WebSocket from 'ws';
import { mintCredential, buildHiggsConfig } from '../server/higgs';
import { buildContext, scenarios } from '../server/orchestrator';
dotenv.config({ quiet: true });
const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
async function main() {
  const scenarioId = arg('--scenario') ?? 'alex-first-date'; const scenario = scenarios.find(s => s.id === scenarioId);
  if (!scenario) throw new Error('Unknown scenario. Use alex-first-date.');
  const credential = await mintCredential(process.env.BOSON_API_KEY);
  const spec = buildHiggsConfig(buildContext(scenario));
  const config = { ...spec, session: { ...(spec.session as object), output_modalities: ['text'] } };
  await new Promise<void>((resolve, reject) => {
    const start = Date.now(); const socket = new WebSocket('wss://api.boson.ai/v1/realtime?model=higgs-realtime', ['realtime', `bai-client-secret.${credential.value}`]);
    let acknowledged = false; let finished = false;
    const finish = (error?: Error) => { if (finished) return; finished = true; clearTimeout(timer); socket.close(); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => finish(new Error('Probe timed out after 30 seconds.')), 30000);
    socket.on('open', () => socket.send(JSON.stringify(config)));
    socket.on('message', data => {
      let e: Record<string, any>; try { e = JSON.parse(data.toString()); } catch { return; }
      // Only event names and whitelisted diagnostics; no raw protocol logging.
      console.log(`${Date.now() - start}ms ${e.type}`);
      if (e.type === 'session.created' && !acknowledged) {
        acknowledged = true;
        console.log('Acknowledged model:', e.session?.model ?? '(not provided)');
        console.log('Acknowledged VAD:', JSON.stringify(e.session?.audio?.input?.turn_detection ?? null));
        socket.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: arg('--message') ?? 'Hello. Tell me a little about yourself.' }] } }));
        socket.send(JSON.stringify({ type: 'response.create' }));
      }
      if (e.type === 'response.output_text.done' && typeof e.text === 'string') console.log('Character:', e.text);
      if (e.type === 'error') finish(new Error('Boson rejected the session or response. Check model, credentials and account credit.'));
      if (e.type === 'response.done') finish(e.response?.status === 'completed' ? undefined : new Error('Boson did not complete the response.'));
    });
    socket.on('error', () => finish(new Error('Boson WebSocket connection failed.')));
    socket.on('close', code => { if (!finished) finish(new Error(`Boson closed the probe (${code}).`)); });
  });
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Probe failed.'); process.exitCode = 1; });
