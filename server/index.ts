import dotenv from 'dotenv';
import { createApp } from './app';
import { adaptationConfig } from './adaptation/config';
import { log } from './log';
import { LocalDatabase } from './persistence/database';
import { ConversationStore } from './store';
import { unqualifiedRestore,restoreQualificationSchema, type RestoreQualification } from '../shared/phase3';
import { existsSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DeepSeekAnalysis,MockAnalysis } from './analysis';
const loaded = dotenv.config({ quiet: true });
const apiKey = loaded.parsed?.BOSON_API_KEY ?? process.env.BOSON_API_KEY;
const adaptation = adaptationConfig(process.env, loaded.parsed);
const database=new LocalDatabase(resolve(process.env.PARALLEL_WORLDS_DATA_DIR??'data','parallel-worlds.sqlite'));
let qualification:RestoreQualification=unqualifiedRestore;
try{if(existsSync('docs/phase3-restoration-results.json'))qualification=restoreQualificationSchema.parse(JSON.parse(readFileSync('docs/phase3-restoration-results.json','utf8')).qualification);}catch{/* fail closed */}
const analysisProvider=process.env.PHASE3_ANALYSIS_PROVIDER?.trim()||(adaptation.provider==='deepseek'?'deepseek':'mock');
if(!['mock','deepseek'].includes(analysisProvider))throw new Error('PHASE3_ANALYSIS_PROVIDER must be mock or deepseek.');
const analysisKey=loaded.parsed?.DEEPSEEK_API_KEY??adaptation.deepSeekKey;
if(analysisProvider==='deepseek'&&!analysisKey?.trim())throw new Error('DeepSeek analysis requires the project DEEPSEEK_API_KEY.');
const analysisTimeoutMs=Number(process.env.PHASE3_ANALYSIS_TIMEOUT_MS||15000);
if(!Number.isFinite(analysisTimeoutMs)||analysisTimeoutMs<100||analysisTimeoutMs>30000)throw new Error('PHASE3_ANALYSIS_TIMEOUT_MS must be between 100 and 30000.');
const app = createApp({ apiKey, adaptation,store:new ConversationStore(undefined,database),phase3:{db:database,qualification,analysisTimeoutMs,
  analysisProvider:analysisProvider==='deepseek'?new DeepSeekAnalysis(analysisKey!,process.env.PHASE3_ANALYSIS_MODEL||'deepseek-flash'):new MockAnalysis()} });
app.listen(3000, '127.0.0.1', () => {
  console.log('Parallel Worlds API: http://127.0.0.1:3000');
  if (!apiKey?.trim()) console.log('Add BOSON_API_KEY to .env and restart to enable live sessions.');
  log('appraisal', adaptation.provider === 'mock' ? 'provider=mock (keyword rules, no network). Set APPRAISAL_PROVIDER in .env to use a model.'
    : `provider=${adaptation.provider} model=${adaptation.model} key=configured timeout=${adaptation.timeoutMs} ms. Adaptive sessions (including directed typing) call it.`, [apiKey, adaptation.deepSeekKey, adaptation.openAIKey]);
});
