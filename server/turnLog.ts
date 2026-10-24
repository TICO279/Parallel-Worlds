import { relationshipNames, type Relationship, type RelationshipName } from '../shared/characterState';
import { block } from './log';

/** Everything that happened in one user turn, printed as one block once the reply is spoken (or abandoned). */
export interface TurnStory {
  session: string; turn: number; character: string; userItemId: string; userText: string;
  judge?: { provider: string; model?: string; majorShift: number; threshold: number; major: boolean; event: string; behavior: number;
    nudges: Record<RelationshipName, number>; ms: number; inputTokens?: number; cost?: number; error?: string };
  appraisal?: { provider: string; model?: string; ms: number; status: string; tokens?: number; tone?: string; interpretation?: string;
    guidance?: string; move?: string; memory?: string[]; error?: string };
  state?: { from: number; to: number; before: Relationship; after: Relationship };
  /** Higgs's first draft, deleted unheard after a major shift. */
  discardedDraft?: string;
  voice?: { provider: string; ms: number; sentences: { text: string; emotion: string; probability: number; jevChoice?: string; jevProbability?: number }[];
    cost?: number; error?: string };
  tts?: { model: string; voice: string; input: string; firstAudioMs?: number; seconds: number; ms: number; stopped?: boolean; error?: string };
  reply?: string;
}

const quote = (s: string, max = 400) => `"${s.length > max ? `${s.slice(0, max)}…` : s}"`;
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;
const change = (a: number, b: number) => a.toFixed(2) === b.toFixed(2) ? b.toFixed(2) : `${a.toFixed(2)}→${b.toFixed(2)}`;

export function printTurn(story: TurnStory) {
  const pad = (label: string) => `  ${label.padEnd(9)}`;
  const cont = ' '.repeat(11);
  const lines = [`┌─ Turn ${story.turn} · session ${story.session.slice(0, 8)} ${'─'.repeat(52)}`];
  lines.push(`${pad('YOU')}${quote(story.userText)}`);
  const j = story.judge;
  if (j) {
    if (j.error) lines.push(`${pad('CHECK')}✗ judgment failed (${j.error}) after ${j.ms} ms → keyword fallback below`);
    lines.push(`${pad(j.error ? 'FALLBACK' : 'CHECK')}major shift? P=${j.majorShift.toFixed(2)} ${j.major ? '≥' : '<'} ${j.threshold} → ${j.major ? 'YES' : 'no'} · event ${j.event.replace(/_/g, ' ')} · ${j.ms} ms` +
        `${j.inputTokens ? ` · ${j.inputTokens} tokens` : ''}${j.cost !== undefined ? ` · $${j.cost.toFixed(6)}` : ''} · ${j.error ? 'keyword rules' : `${j.provider}${j.model ? ` ${j.model}` : ''}`}`);
    lines.push(`${cont}nudges ${relationshipNames.map(n => `${n} ${signed(j.nudges[n])}`).join(' · ')} · trustworthy behaviour P=${j.behavior.toFixed(2)}`);
  } else lines.push(`${pad('CHECK')}not judged (no usable transcript) → ordinary line`);
  if (story.discardedDraft !== undefined) lines.push(`${pad('DRAFT')}discarded unheard: ${quote(story.discardedDraft)}`);
  const a = story.appraisal;
  if (a) {
    lines.push(a.status === 'committed'
      ? `${pad('DEEPSEEK')}full appraisal · ${a.ms} ms${a.tokens ? ` · ${a.tokens} tokens` : ''} · ${a.provider}${a.model ? ` ${a.model}` : ''}`
      : `${pad('DEEPSEEK')}✗ appraisal ${a.status}${a.error ? ` (${a.error})` : ''} after ${a.ms} ms → kept the previous guidance`);
    if (a.interpretation) lines.push(`${cont}reads it as: ${quote(a.interpretation, 300)}`);
    if (a.tone || a.move) lines.push(`${cont}tone ${a.tone ?? '—'}${a.move ? ` · next move ${a.move.replace(/_/g, ' ')}` : ''}`);
    if (a.guidance) lines.push(`${cont}guidance: ${quote(a.guidance, 300)}`);
    for (const note of a.memory ?? []) lines.push(`${cont}memory: ${quote(note, 200)}`);
  }
  const s = story.state;
  if (s) lines.push(`${pad('STATE')}v${s.from}→v${s.to} · ${relationshipNames.map(n => `${n} ${change(s.before[n], s.after[n])}`).join(' · ')}`,
    `${cont}tension ${change(s.before.tension, s.after.tension)} · warmth ${change(s.before.warmth, s.after.warmth)}`);
  const v = story.voice;
  if (v) {
    lines.push(v.error ? `${pad('VOICE')}✗ emotion choice failed (${v.error}) → chosen from her current mood instead` : `${pad('VOICE')}${v.provider} emotion per sentence · ${v.ms} ms${v.cost !== undefined ? ` · $${v.cost.toFixed(6)}` : ''}`);
    for (const sentence of v.sentences) lines.push(`${cont}${sentence.emotion.padEnd(13)} ${sentence.probability.toFixed(2)}` +
      `${sentence.jevChoice && sentence.jevChoice !== sentence.emotion ? ` (${v.provider}'s top: ${sentence.jevChoice} ${sentence.jevProbability?.toFixed(2)}; mood favoured ${sentence.emotion})` : ''}  ${quote(sentence.text, 120)}`);
  }
  const t = story.tts;
  if (t) {
    lines.push(`${pad('TTS3')}${t.model} · voice ${t.voice} · input ${quote(t.input, 500)}`);
    lines.push(t.error ? `${cont}✗ ${t.error}` : `${cont}first audio ${t.firstAudioMs ?? '—'} ms · ${t.seconds.toFixed(1)} s of audio in ${t.ms} ms${t.stopped ? ' · STOPPED: you interrupted' : ''}`);
  }
  lines.push(story.reply !== undefined ? `${pad(story.character.toUpperCase())}${quote(story.reply)}` : `${pad(story.character.toUpperCase())}(no reply spoken: the turn was interrupted or abandoned)`);
  lines.push(`└${'─'.repeat(78)}`);
  block(lines);
}
