import dotenv from 'dotenv';
import { createApp } from './app';
import { adaptationConfig } from './adaptation/config';
import { log } from './log';
const loaded = dotenv.config({ quiet: true });
const apiKey = loaded.parsed?.BOSON_API_KEY ?? process.env.BOSON_API_KEY;
const adaptation = adaptationConfig(process.env, loaded.parsed);
const app = createApp({ apiKey, adaptation });
app.listen(3000, '127.0.0.1', () => {
  console.log('Parallel Worlds API: http://127.0.0.1:3000');
  if (!apiKey?.trim()) console.log('Add BOSON_API_KEY to .env and restart to enable live sessions.');
  log('appraisal', adaptation.provider === 'mock' ? 'provider=mock (keyword rules, no network). Set APPRAISAL_PROVIDER in .env to use a model.'
    : `provider=${adaptation.provider} model=${adaptation.model} key=configured timeout=${adaptation.timeoutMs} ms. Adaptive sessions (including directed typing) call it.`, [apiKey, adaptation.deepSeekKey, adaptation.openAIKey]);
  const d = adaptation.decision; const t = adaptation.speech;
  log('decision', d?.provider === 'mock' ? 'provider=mock (keyword rules, no network). Set DEEPSEEK_API_KEY to use DeepSeek for the quick check and voice emotions.'
    : `quick check + voice emotions: provider=${d?.provider} model=${d?.model} url=${d?.url} major-shift threshold=${d?.majorThreshold} timeout=${d?.timeoutMs} ms`, [d?.key]);
  log('appraisal', adaptation.appraisalTrigger === 'major_shift' ? 'full appraisal runs only on major shifts flagged by the decision model'
    : 'full appraisal runs on every user line (APPRAISAL_TRIGGER=every_turn)');
  log('tts', `Higgs replies as text; Higgs TTS 3 speaks them: model=${t?.model} voice=${t?.voice}`);
});
