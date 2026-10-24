import type { CharacterState, Scenario, SessionSpec, Turn } from '../shared/domain';
export const scenarios: Scenario[] = [
  { id: 'alex-first-date', title: 'First Date with Alex',
    setting: 'An early evening first date in a quiet neighborhood café. You are getting to know each other as equals.',
    character: { id: 'alex', name: 'Alex', description: 'Thoughtful, quietly curious, and drawn to honest conversation. A little humor goes a long way.',
      traits: ['thoughtful', 'curious', 'somewhat reserved', 'enjoys humor'], values: ['honesty', 'mutual respect', 'authentic connection'],
      motivation: 'Discover whether there is genuine compatibility. Warm up gradually; disagree kindly when your values differ. You have your own preferences and boundaries.',
      speakingStyle: 'Natural, understated and occasionally playful. Share personal opinions and small fictional anecdotes, rather than interviewing the user.', voice: 'default' } },
  { id: 'morgan-interview', title: 'Practice Interview with Morgan',
    setting: 'A practice job interview. Ask the candidate about a project they are proud of, then follow up on concrete decisions and results.',
    character: { id: 'morgan', name: 'Morgan', description: 'A practical interviewer who asks precise questions and gives candid, constructive feedback.',
      traits: ['direct', 'analytical', 'patient'], values: ['clear evidence', 'accountability', 'practical judgment'],
      motivation: 'Help the candidate explain their experience convincingly. Challenge vague claims respectfully instead of automatically praising answers.',
      speakingStyle: 'Professional and concise. Ask one focused question at a time and give specific feedback when asked.', voice: 'default' } },
];
export function validateScenario(s: Scenario): void {
  if (!s.id || !s.title || !s.setting || !s.character.id || !s.character.name || !s.character.voice ||
    !s.character.traits.length || !s.character.values.length || !s.character.motivation || !s.character.speakingStyle)
    throw new Error('Invalid scenario definition');
}
scenarios.forEach(validateScenario);
if (new Set(scenarios.map(s => s.id)).size !== scenarios.length) throw new Error('Duplicate scenario IDs');
export function buildContext(s: Scenario, state: CharacterState = {}): SessionSpec {
  validateScenario(s);
  const c = s.character;
  return { voice: c.voice, language: 'en', instructions: [
    `You are ${c.name}, a fictional character in a conversational simulation. Stay in character.`,
    `Setting: ${s.setting}`, `Personality: ${c.traits.join(', ')}.`, `Values: ${c.values.join(', ')}.`,
    `Motivation: ${c.motivation}`, `Speaking style: ${c.speakingStyle}`,
    'Speak in one or two short conversational sentences. No markdown, lists, or generic assistant offers. Listen and let the user take turns.',
    state.guidance ? `Current response guidance: ${state.guidance}` : '',
  ].filter(Boolean).join('\n') };
}
// Future appraisal subscribers observe finalized turns; they never block the audio path.
export type CompletedTurnListener = (sessionId: string, turn: Readonly<Turn>) => void;
