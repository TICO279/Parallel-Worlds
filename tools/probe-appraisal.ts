import dotenv from 'dotenv';
import { adaptationConfig } from '../server/adaptation/config';
import { createProvider } from '../server/adaptation/providers';
import { unpackAppraisalResult } from '../server/adaptation/results';
import { initialState } from '../server/adaptation/engine';
import { scenarios } from '../server/orchestrator';

async function main() {
  if (!process.argv.includes('--live')) throw new Error('Pass --live to make a billable appraisal request using the explicitly configured project provider.');
  const loaded = dotenv.config({ quiet: true }); const config = adaptationConfig(process.env, loaded.parsed);
  const provider = createProvider(config);
  for (const timeoutMs of [...new Set([config.timeoutMs, 10000])]) {
    const started = performance.now();
    try {
      const raw = await provider.appraise({ character: scenarios[0].character,
        previous: initialState(scenarios[0].character, 'diagnostic', Date.now()),
        turnId: 'diagnostic/turn1', utterance: 'I enjoy pottery and quiet coffee shops.', context: [] }, AbortSignal.timeout(timeoutMs));
      const result = unpackAppraisalResult(raw);
      console.log(JSON.stringify({ provider: provider.name, model: config.model, timeoutMs,
        latencyMs: Math.round(performance.now() - started), status: 'validated', usage: result.telemetry.usage, deltas: result.appraisal.deltas }));
      return;
    } catch { console.log(JSON.stringify({ provider: provider.name, timeoutMs,
      latencyMs: Math.round(performance.now() - started), status: 'failed or timed out' })); }
  }
  process.exitCode = 1;
}
void main().catch(() => { console.error('Appraisal probe failed. Use --live and check the project provider configuration. No credentials were logged.'); process.exitCode = 1; });
