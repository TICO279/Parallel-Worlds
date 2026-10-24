export interface AdaptationConfig {
  provider: 'mock' | 'openai' | 'deepseek'; model: string; timeoutMs: number; maxDelta: number;
  /** Must be explicitly enabled for this project; never inferred from key presence. */
  openAIKey?: string;
  deepSeekKey?: string;
}
function numberSetting(raw: string | undefined, fallback: number, low: number, high: number, name: string) {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < low || value > high) throw new Error(`${name} must be between ${low} and ${high}.`);
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
    timeoutMs: numberSetting(env.APPRAISAL_TIMEOUT_MS, 1500, 100, 30000, 'APPRAISAL_TIMEOUT_MS'),
    maxDelta: numberSetting(env.CHARACTER_MAX_STATE_DELTA, 0.10, 0, 1, 'CHARACTER_MAX_STATE_DELTA'),
    ...(provider === 'openai' && { openAIKey: env.OPENAI_API_KEY!.trim() }),
    ...(provider === 'deepseek' && { deepSeekKey: env.DEEPSEEK_API_KEY!.trim() }),
  };
}
