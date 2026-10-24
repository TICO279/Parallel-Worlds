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
    : `provider=${adaptation.provider} model=${adaptation.model} key=configured timeout=${adaptation.timeoutMs} ms. Only Adaptive mode sessions call it.`);
});
