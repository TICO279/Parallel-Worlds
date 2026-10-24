import dotenv from 'dotenv';
import { createApp } from './app';
import { adaptationConfig } from './adaptation/config';
const loaded = dotenv.config({ quiet: true });
const apiKey = loaded.parsed?.BOSON_API_KEY ?? process.env.BOSON_API_KEY;
const app = createApp({ apiKey, adaptation: adaptationConfig(process.env, loaded.parsed) });
app.listen(3000, '127.0.0.1', () => {
  console.log('Parallel Worlds API: http://127.0.0.1:3000');
  if (!apiKey?.trim()) console.log('Add BOSON_API_KEY to .env and restart to enable live sessions.');
});
