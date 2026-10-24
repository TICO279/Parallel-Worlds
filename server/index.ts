import dotenv from 'dotenv';
import { createApp } from './app';
dotenv.config({ quiet: true });
const app = createApp({ apiKey: process.env.BOSON_API_KEY });
app.listen(3000, '127.0.0.1', () => {
  console.log('Parallel Worlds API: http://127.0.0.1:3000');
  if (!process.env.BOSON_API_KEY?.trim()) console.log('Add BOSON_API_KEY to .env and restart to enable live sessions.');
});
