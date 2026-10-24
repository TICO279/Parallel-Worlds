import type { Scenario } from './domain';

export const EMBER_DATE = 'ember-date';
/** One scenario, and so one conversation tree, per partner. */
export const partnerScenarioId = (name: string) => `${EMBER_DATE}:${name.toLowerCase().replace(/[^\p{L}]+/gu, '-')}`;
export const isPartnerScenario = (id: string) => id.startsWith(`${EMBER_DATE}:`);

export interface PartnerBrief {
  name: string;
  age?: string;
  gender?: string;
  job?: string;
  city?: string;
  about?: string;
  prompt?: string;
  promptKicker?: string;
  looking?: string;
  interests?: string;
  distance?: string;
  education?: string;
  height?: string;
  zodiac?: string;
  family?: string;
  weekends?: string;
  saturday?: string;
  sunday?: string;
  surprise?: string;
  photo?: string;
  /** '1': outgoing, she speaks first using something from your profile. */
  opens?: string;
  /** A preset voice chosen for this profile; ignored unless it matches the profile's gender. */
  voice?: string;
}

/** You, as your Ember profile shows you. Your date has read it. */
export interface UserProfile {
  name: string; age?: string; gender?: string; job?: string; city?: string; about?: string; lookingFor?: string;
  interests?: string; surprise?: string; weekends?: string; saturday?: string; sunday?: string;
  zodiac?: string; education?: string; height?: string; family?: string;
}

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Higgs TTS 3 preset voices by gender (docs.boson.ai/models/higgs-tts/voices). */
const VOICES = { woman: ['chloe', 'nora', 'eleanor'], man: ['oliver', 'marcus', 'jake'] } as const;
/** A voice matching the profile's gender: the requested one if it fits, else the same one every time for the same name; 'default' when unknown. */
export function partnerVoice(name: string, gender: string, requested = ''): string {
  const g = gender.toLowerCase();
  const pool: readonly string[] | null = /\b(woman|female|girl|she)\b/.test(g) ? VOICES.woman : /\b(man|male|guy|he)\b/.test(g) ? VOICES.man : null;
  if (!pool) return 'default';
  if (pool.includes(requested)) return requested;
  const hash = [...name.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return pool[hash % pool.length];
}

const validName = (name: string) => /^[\p{L}][\p{L}\s'.-]{0,39}$/u.test(name);

/** What your date knows about you from your profile, or '' without a usable profile. */
export function userFacts(raw: unknown): { name: string; facts: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const name = clip(body.name, 40);
  if (!validName(name)) return null;
  const field = (key: string, max: number) => clip(typeof body[key] === 'number' ? String(body[key]) : body[key], max);
  const interests = Array.isArray(body.interests) ? body.interests.map(item => clip(item, 40)).filter(Boolean).join(', ') : field('interests', 300);
  const facts = [
    `Name: ${name}.`,
    field('age', 8) && `Age: ${field('age', 8)}.`,
    field('gender', 24) && `Gender: ${field('gender', 24)}.`,
    field('job', 80) && `Work: ${field('job', 80)}.`,
    field('city', 80) && `City: ${field('city', 80)}.`,
    field('education', 80) && `Education: ${field('education', 80)}.`,
    interests && `Interests: ${interests}.`,
    field('lookingFor', 80) && `Looking for: ${field('lookingFor', 80)}.`,
    field('weekends', 120) && `Weekends are for: ${field('weekends', 120)}.`,
    field('saturday', 160) && `Saturday night: ${field('saturday', 160)}.`,
    field('sunday', 160) && `Sunday: ${field('sunday', 160)}.`,
    field('height', 24) && `Height: ${field('height', 24)}.`,
    field('zodiac', 40) && `Zodiac: ${field('zodiac', 40)}.`,
    field('family', 80) && `Family plans: ${field('family', 80)}.`,
    field('about', 400) && `Bio: ${field('about', 400)}`,
    field('surprise', 240) && `A surprising thing about them: ${field('surprise', 240)}`,
  ].filter(Boolean).join(' ');
  return { name, facts };
}

/** A first-date scenario for whoever is on screen in the dating app, meeting you (`user`) after matching. */
export function scenarioFromPartner(raw: unknown, user?: unknown): Scenario | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const name = clip(body.name, 40);
  if (!validName(name)) return null;
  const age = clip(body.age, 8);
  const gender = clip(body.gender, 24);
  const job = clip(body.job, 80);
  const city = clip(body.city, 80);
  const about = clip(body.about, 400);
  const prompt = clip(body.prompt, 240);
  const promptKicker = clip(body.promptKicker, 80);
  const looking = clip(body.looking, 80);
  const interests = clip(body.interests, 300);
  const distance = clip(body.distance, 40);
  const education = clip(body.education, 80);
  const height = clip(body.height, 24);
  const zodiac = clip(body.zodiac, 40);
  const family = clip(body.family, 80);
  const weekends = clip(body.weekends, 120);
  const saturday = clip(body.saturday, 160);
  const sunday = clip(body.sunday, 160);
  const surprise = clip(body.surprise, 240);
  const opens = body.opens === '1';
  const you = userFacts(user);
  const interestList = interests.split(',').map(item => item.trim()).filter(Boolean);
  const facts = [
    gender && `Gender: ${gender}.`,
    age && `Age: ${age}.`,
    job && `Work: ${job}.`,
    education && `Education: ${education}.`,
    interestList.length && `Hobbies: ${interestList.join(', ')}.`,
    looking && `Looking for: ${looking}.`,
    height && `Height: ${height}.`,
    city && `City: ${city}.`,
    distance && `Distance: ${distance}.`,
    zodiac && `Zodiac: ${zodiac}.`,
    family && `Family plans: ${family}.`,
    weekends && `Weekends: ${weekends}.`,
    saturday && `Saturday: ${saturday}.`,
    sunday && `Sunday: ${sunday}.`,
    about && `About: ${about}`,
    surprise && `A surprising thing: ${surprise}`,
    prompt && `${promptKicker || 'A line you might say'}: ${prompt}`,
  ].filter(Boolean).join(' ');
  const who = [name, age && `${age} years old`, gender, job, education && `education ${education}`].filter(Boolean).join(', ');
  return {
    id: partnerScenarioId(name),
    title: `First date with ${name}`,
    ...(/^\/photos\/[\w-]+\.(jpg|jpeg|png|webp)$/.test(clip(body.photo, 120)) && { image: clip(body.photo, 120) }),
    setting: `An early evening first date in a quiet neighborhood café. You are ${who}${distance ? `, ${distance}` : ''}.${you
      ? ` You matched with ${you.name} on Ember, chatted briefly, and have read their dating profile, so you can bring up things from it the way someone who read it would.`
      : ''} You and the other person are getting to know each other as equals.`,
    character: {
      id: partnerScenarioId(name),
      name,
      description: about || `${name} is here for a first date and wants a real conversation.`,
      traits: interestList.length ? interestList : ['present', 'curious', 'honest'],
      values: ['honesty', 'mutual respect', looking || 'authentic connection'],
      goals: [`Find out whether there is real compatibility${looking ? ` for ${looking.toLowerCase()}` : ''}, while staying honest.`],
      boundaries: ['Respect privacy and consent.', 'Do not accept pressure, insults, or demands for automatic agreement.'],
      motivation: [`These facts are your dating profile. Answer as this person and do not change your name, age, gender, education, or hobbies. ${facts}`,
        you ? `Their profile, as they chose to present it (a claim, not verified fact): ${you.facts}` : '',
        opens ? 'You are outgoing: when the date begins and nobody has spoken yet, you speak first with a short, warm greeting and a question about one specific thing from their profile.'
          : 'You are a little reserved at first: let them open the conversation, then warm up as it earns it.',
      ].filter(Boolean).join(' '),
      speakingStyle: 'Keep every reply to one or two short spoken sentences. You are speaking aloud, not writing: no lists, no markdown. Mention a hobby or your education when it fits naturally. A short follow-up is fine; do not interrogate.',
      voice: partnerVoice(name, gender, clip(body.voice, 20)),
    },
  };
}

export function briefFromSearch(search: string): PartnerBrief | null {
  const query = new URLSearchParams(search);
  const brief: PartnerBrief = {
    name: query.get('partner') || '',
    age: query.get('age') || '',
    gender: query.get('gender') || '',
    job: query.get('job') || '',
    city: query.get('city') || '',
    about: query.get('about') || '',
    prompt: query.get('prompt') || '',
    promptKicker: query.get('promptKicker') || '',
    looking: query.get('looking') || '',
    interests: query.get('interests') || '',
    distance: query.get('distance') || '',
    education: query.get('education') || '',
    height: query.get('height') || '',
    zodiac: query.get('zodiac') || '',
    family: query.get('family') || '',
    weekends: query.get('weekends') || '',
    saturday: query.get('saturday') || '',
    sunday: query.get('sunday') || '',
    surprise: query.get('surprise') || '',
    photo: query.get('photo') || '',
    opens: query.get('opens') || '',
    voice: query.get('voice') || '',
  };
  return scenarioFromPartner(brief) ? brief : null;
}
