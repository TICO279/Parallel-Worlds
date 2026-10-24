/** Per-turn quick check and voice emotion: DeepSeek (default), TypeSafe Jev, or keyword rules ('mock', no key). */
export interface DecisionConfig { provider: 'deepseek' | 'jev' | 'mock'; url: string; model: string; key?: string; timeoutMs: number; majorThreshold: number; }
/** Higgs TTS 3 speaks the reply; the key is BOSON_API_KEY, passed separately. */
export interface SpeechConfig { model: string; voice: string; timeoutMs: number; }
export interface AdaptationConfig {
  provider: 'mock' | 'openai' | 'deepseek'; model: string; timeoutMs: number; maxDelta: number;
  /** Must be explicitly enabled for this project; never inferred from key presence. */
  openAIKey?: string;
  deepSeekKey?: string;
  memoryCapacity?: number; memoryTextLimit?: number; maxOutputTokens?: number;
  /** Most recent lines of this trajectory (branch replay + live session) sent with each appraisal. */
  contextLines?: number;
  decision?: DecisionConfig;
  speech?: SpeechConfig;
  /** 'major_shift': DeepSeek appraises only lines the decision model flags. 'every_turn': the earlier asynchronous mode. */
  appraisalTrigger?: 'every_turn' | 'major_shift';
}
function numberSetting(raw: string | undefined, fallback: number, low: number, high: number, name: string) {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < low || value > high) throw new Error(`${name} must be between ${low} and ${high}.`);
  return value;
}
function integerSetting(raw: string | undefined, fallback: number, low: number, high: number, name: string) {
  const value = numberSetting(raw, fallback, low, high, name);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
  return value;
}
export function adaptationConfig(inherited: Record<string, string | undefined>, project: Record<string, string | undefined> = {}): AdaptationConfig {
  // A project-local key must win over any unrelated credential inherited by the agent.
  const env = { ...inherited, ...project };
  const provider = env.APPRAISAL_PROVIDER ?? 'mock';
  if (provider !== 'mock' && provider !== 'openai' && provider !== 'deepseek') throw new Error('APPRAISAL_PROVIDER must be mock, deepseek or openai.');
  // Even provider=openai does not implicitly consume an unrelated agent credential.
  if (provider === 'openai' && (env.APPRAISAL_OPENAI_PROJECT_KEY !== 'true' || !env.OPENAI_API_KEY?.trim()))
    throw new Error('OpenAI appraisal requires APPRAISAL_OPENAI_PROJECT_KEY=true and your project OPENAI_API_KEY.');
  if (provider === 'deepseek' && !env.DEEPSEEK_API_KEY?.trim()) throw new Error('DeepSeek appraisal requires your project DEEPSEEK_API_KEY.');
  return { provider, model: env.APPRAISAL_MODEL?.trim() || (provider === 'openai' ? 'gpt-6-luna' : 'deepseek-flash'),
    memoryCapacity: integerSetting(env.CHARACTER_MEMORY_CAPACITY, 8, 1, 32, 'CHARACTER_MEMORY_CAPACITY'),
    memoryTextLimit: integerSetting(env.CHARACTER_MEMORY_TEXT_LIMIT, 160, 40, 160, 'CHARACTER_MEMORY_TEXT_LIMIT'),
    maxOutputTokens: integerSetting(env.APPRAISAL_MAX_OUTPUT_TOKENS, 1600, 600, 4000, 'APPRAISAL_MAX_OUTPUT_TOKENS'),
    contextLines: integerSetting(env.APPRAISAL_CONTEXT_LINES, 60, 2, 400, 'APPRAISAL_CONTEXT_LINES'),
    timeoutMs: numberSetting(env.APPRAISAL_TIMEOUT_MS, 1500, 100, 30000, 'APPRAISAL_TIMEOUT_MS'),
    maxDelta: numberSetting(env.CHARACTER_MAX_STATE_DELTA, 0.10, 0, 1, 'CHARACTER_MAX_STATE_DELTA'),
    ...(provider === 'openai' && { openAIKey: env.OPENAI_API_KEY!.trim() }),
    ...(provider === 'deepseek' && { deepSeekKey: env.DEEPSEEK_API_KEY!.trim() }),
    decision: decisionConfig(env),
    speech: { model: env.TTS_MODEL?.trim() || 'higgs-tts-3', voice: env.TTS_VOICE?.trim() || 'default',
      timeoutMs: integerSetting(env.TTS_TIMEOUT_MS, 15000, 1000, 60000, 'TTS_TIMEOUT_MS') },
    appraisalTrigger: appraisalTrigger(env.APPRAISAL_TRIGGER),
  };
}
function appraisalTrigger(raw?: string): 'every_turn' | 'major_shift' {
  const value = raw?.trim() || 'major_shift';
  if (value !== 'every_turn' && value !== 'major_shift') throw new Error('APPRAISAL_TRIGGER must be major_shift or every_turn.');
  return value;
}
function decisionConfig(env: Record<string, string | undefined>): DecisionConfig {
  const deepSeekKey = env.DEEPSEEK_API_KEY?.trim(); const jevKey = env.JEV_API_KEY?.trim() || env.OPENROUTER_API_KEY?.trim();
  const provider = env.DECISION_PROVIDER?.trim() || (deepSeekKey ? 'deepseek' : jevKey ? 'jev' : 'mock');
  if (provider !== 'deepseek' && provider !== 'jev' && provider !== 'mock') throw new Error('DECISION_PROVIDER must be deepseek, jev or mock.');
  const timeoutMs = integerSetting(env.DECISION_TIMEOUT_MS ?? env.JEV_TIMEOUT_MS, 4000, 200, 30000, 'DECISION_TIMEOUT_MS');
  const majorThreshold = numberSetting(env.MAJOR_SHIFT_THRESHOLD, 0.7, 0, 1, 'MAJOR_SHIFT_THRESHOLD');
  if (provider === 'deepseek') {
    if (!deepSeekKey) throw new Error('DECISION_PROVIDER=deepseek requires DEEPSEEK_API_KEY.');
    return { provider, url: 'https://api.deepseek.com/chat/completions', model: env.DECISION_MODEL?.trim() || 'deepseek-flash', key: deepSeekKey, timeoutMs, majorThreshold };
  }
  if (provider === 'jev' && !jevKey) throw new Error('DECISION_PROVIDER=jev requires JEV_API_KEY (or OPENROUTER_API_KEY).');
  const url = env.JEV_URL?.trim() || 'https://api.tokenrouter.com/api/alpha/decisions';
  if (!url.startsWith('https://')) throw new Error('JEV_URL must be an https URL.');
  return { provider, url, model: env.JEV_MODEL?.trim() || 'typesafe/jev-1.14', ...(provider === 'jev' && { key: jevKey }), timeoutMs, majorThreshold };
}
