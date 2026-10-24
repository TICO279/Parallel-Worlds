export interface AdaptationConfig {
  provider: 'mock' | 'openai' | 'deepseek'; model: string; timeoutMs: number; maxDelta: number;
  /** Must be explicitly enabled for this project; never inferred from key presence. */
  openAIKey?: string;
  deepSeekKey?: string;
  memoryCapacity?: number; memoryTextLimit?: number; maxOutputTokens?: number;
  behaviorVariation?: number; behaviorSeed?: string;
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
  if (env.CHARACTER_BEHAVIOR_SEED && env.CHARACTER_BEHAVIOR_SEED.length > 128) throw new Error('CHARACTER_BEHAVIOR_SEED must be at most 128 characters.');
  return { provider, model: env.APPRAISAL_MODEL?.trim() || (provider === 'openai' ? 'gpt-6-luna' : 'deepseek-flash'),
    behaviorVariation: numberSetting(env.CHARACTER_BEHAVIOR_VARIATION, provider === 'mock' ? 0 : .35, 0, 1, 'CHARACTER_BEHAVIOR_VARIATION'),
    behaviorSeed: env.CHARACTER_BEHAVIOR_SEED?.trim() || undefined,
    memoryCapacity: integerSetting(env.CHARACTER_MEMORY_CAPACITY, 8, 1, 32, 'CHARACTER_MEMORY_CAPACITY'),
    memoryTextLimit: integerSetting(env.CHARACTER_MEMORY_TEXT_LIMIT, 160, 40, 160, 'CHARACTER_MEMORY_TEXT_LIMIT'),
    maxOutputTokens: integerSetting(env.APPRAISAL_MAX_OUTPUT_TOKENS, 1600, 600, 4000, 'APPRAISAL_MAX_OUTPUT_TOKENS'),
    timeoutMs: numberSetting(env.APPRAISAL_TIMEOUT_MS, 1500, 100, 30000, 'APPRAISAL_TIMEOUT_MS'),
    maxDelta: numberSetting(env.CHARACTER_MAX_STATE_DELTA, 0.10, 0, 1, 'CHARACTER_MAX_STATE_DELTA'),
    ...(provider === 'openai' && { openAIKey: env.OPENAI_API_KEY!.trim() }),
    ...(provider === 'deepseek' && { deepSeekKey: env.DEEPSEEK_API_KEY!.trim() }),
  };
}
