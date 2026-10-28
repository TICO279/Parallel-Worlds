import { describe, expect, it, vi } from 'vitest';
import { relationshipNames, type Relationship } from '../shared/characterState';
import type { Turn } from '../shared/domain';
import { DeepSeekDecider, JevDecider, MockDecider, splitSentences, type Decider } from '../server/adaptation/decisions';
import { chooseVoiceEmotion, describeRelationship, initialRelationship, RELATIONSHIP_RULES, updateRelationship } from '../server/adaptation/relationship';
import { printTurn } from '../server/turnLog';
import { AdaptationCoordinator } from '../server/adaptation/coordinator';
import type { AppraisalProvider } from '../server/adaptation/providers';
import { MockAppraisalProvider } from '../server/adaptation/providers';
import { ConversationStore } from '../server/store';
import { buildContext, scenarios } from '../server/orchestrator';
import { adaptationConfig, type ConflictTuning } from '../server/adaptation/config';

const alex = scenarios[0].character;
const zero = Object.fromEntries(relationshipNames.map(n => [n, 0])) as Record<typeof relationshipNames[number], number>;
const user = (id: string, order: number, text: string): Turn => ({ itemId: id, order, text, role: 'user', transcriptFinal: true, status: 'complete', startedAt: 1, updatedAt: 2 });
const reply = (id: string, order: number, text: string): Turn => ({ ...user(id, order, text), role: 'assistant' });
const jevConfig = { provider: 'jev' as const, url: 'https://openrouter.ai/api/alpha/decisions', model: 'typesafe/jev-1.14', key: 'or-key', timeoutMs: 4000, majorThreshold: .7 };

describe('relationship indicators', () => {
  const base = initialRelationship(alex);
  it('nudges a little on ordinary lines and a lot on major shifts, weighting losses more', () => {
    const small = updateRelationship(base, { nudges: { ...zero, interest: 2 }, behavior: 0, event: 'interest', major: false, turnId: 'u1' });
    expect(small.interest).toBeCloseTo(base.interest + 2 * RELATIONSHIP_RULES.smallStep * (1 - base.interest), 6);
    const hurt = updateRelationship(base, { nudges: { ...zero, respect: -2 }, behavior: 0, event: 'insult', major: true, turnId: 'u2' });
    expect(base.respect - hurt.respect).toBeCloseTo(Math.min(RELATIONSHIP_RULES.bigCap, 2 * RELATIONSHIP_RULES.bigStep * RELATIONSHIP_RULES.negativity) * base.respect, 6);
    expect(hurt.tension).toBe(.8); expect(hurt.lastShift).toEqual({ event: 'insult', turnId: 'u2', major: true });
  });
  it('raises trust only on trustworthy behaviour and closeness only once comfort and trust are established', () => {
    const words = updateRelationship(base, { nudges: { ...zero, trust: 2, closeness: 2 }, behavior: .2, event: 'compliment', major: false, turnId: 'u1' });
    expect(words.trust).toBe(base.trust); expect(words.closeness).toBe(base.closeness);
    const deeds = updateRelationship({ ...base, comfort: .6, trust: .6 }, { nudges: { ...zero, trust: 2, closeness: 2 }, behavior: .9, event: 'respectful_action', major: false, turnId: 'u1' });
    expect(deeds.trust).toBeGreaterThan(.6); expect(deeds.closeness).toBeGreaterThan(base.closeness);
  });
  it('raises tension for any insult in proportion to how serious it is', () => {
    const minor = updateRelationship(base, { nudges: zero, behavior: 0, event: 'insult', major: false, turnId: 'u', majorShift: .37 });
    expect(minor.tension).toBeCloseTo(.485, 3); expect(minor.lastShift).toEqual({ event: 'insult', turnId: 'u', major: false });
    expect(updateRelationship(base, { nudges: zero, behavior: 0, event: 'humor', major: false, turnId: 'u', majorShift: .37 }).tension).toBe(0);
  });
  it('lets a cool mood favour negative emotions even without tension', () => {
    expect(chooseVoiceEmotion({ neutral: .7, bitterness: .3 }, { ...base, warmth: -.35 }).emotion).toBe('anger');
    expect(chooseVoiceEmotion({ neutral: .7, bitterness: .3 }, { ...base, warmth: -.1 }).emotion).toBe('neutral');
  });
  it('lets tension fade by about half over six ordinary lines with the stronger default anger and stays in bounds', () => {
    let r: Relationship = { ...base, tension: .8 };
    for (let i = 0; i < 6; i++) r = updateRelationship(r, { nudges: zero, behavior: 0, event: 'neutral', major: false, turnId: `u${i}` });
    expect(r.tension).toBeCloseTo(.4, 1);
    const extreme = updateRelationship({ ...base, respect: .01 }, { nudges: { ...zero, respect: -100 }, behavior: 0, event: 'insult', major: true, turnId: 'x' });
    expect(extreme.respect).toBeGreaterThanOrEqual(0);
  });
  it('keeps repeated hurt unresolved after one apology but permits gradual recovery',()=>{
    const insult={nudges:zero,behavior:0,event:'insult',major:true,turnId:'u1'};
    const first=updateRelationship(base,insult),second=updateRelationship(first,{...insult,turnId:'u2'});
    expect(second.tension).toBeGreaterThan(first.tension);
    let repaired=updateRelationship(second,{nudges:zero,behavior:0,event:'apology',major:false,turnId:'u3'});
    expect(repaired.tension).toBeGreaterThan(.5);expect(describeRelationship(repaired)).toContain('visibly irritated');
    for(let i=0;i<30;i++)repaired=updateRelationship(repaired,{nudges:zero,behavior:.9,event:'respectful_action',major:false,turnId:`repair${i}`});
    expect(repaired.tension).toBeLessThan(.1);
    expect(updateRelationship(base,{nudges:zero,behavior:0,event:'disagreement',major:false,turnId:'ordinary'}).tension).toBe(0);
  });
  it('lets anger strength affect plausible voice choices without inventing anger in a calm scene',()=>{
    const options={neutral:.85,anger:.15},mood={...base,tension:.45};
    expect(chooseVoiceEmotion(options,mood,{provocation:.8,anger:0}).emotion).toBe('neutral');
    expect(chooseVoiceEmotion(options,mood,{provocation:.8,anger:.8}).emotion).toBe('anger');
    expect(chooseVoiceEmotion(options,base).emotion).toBe('neutral');
    expect(chooseVoiceEmotion({neutral:1},{...base,tension:.9}).emotion).toBe('neutral');
  });
  it('validates independently configurable provocation and anger',()=>{
    expect(adaptationConfig({}).conflict).toEqual({provocation:.8,anger:.8});
    expect(adaptationConfig({CHARACTER_PROVOCATION:'.4',CHARACTER_ANGER:'.9'}).conflict).toEqual({provocation:.4,anger:.9});
    for(const env of [{CHARACTER_PROVOCATION:'2'},{CHARACTER_ANGER:'-1'},{CHARACTER_ANGER:'angry'}])expect(()=>adaptationConfig(env)).toThrow();
    expect(buildContext(scenarios[0],{},[],{conflict:{provocation:.8,anger:.8}}).instructions).toContain('pointed challenge');
    expect(buildContext(scenarios[0],{},[],{conflict:{provocation:0,anger:0}}).instructions).not.toContain('willing to provoke');
  });
  it('lets a tense mood favour strong negative emotions and a calm mood keep Jev\'s choice', () => {
    const jev = { determination: .71, bitterness: .29 };
    expect(chooseVoiceEmotion(jev, base)).toMatchObject({ emotion: 'determination', expressive: false });
    const hurt = chooseVoiceEmotion(jev, { ...base, tension: .8, warmth: -.3 });
    expect(hurt).toMatchObject({ emotion: 'anger', probability: .29, jevChoice: 'determination', jevProbability: .71, expressive: true });
    // Bitterness and disgust count toward anger once she is clearly tense; anger itself wins outright.
    expect(chooseVoiceEmotion({ neutral: .5, bitterness: .3, disgust: .2 }, { ...base, tension: .8 })).toMatchObject({ emotion: 'anger', probability: .5 });
    expect(chooseVoiceEmotion({ determination: .8, bitterness: .2 }, { ...base, tension: .4 }).emotion).toBe('determination');
    expect(chooseVoiceEmotion({ neutral: .6, amusement: .4 }, { ...base, warmth: .8 }).emotion).toBe('amusement');
  });
  it('describes bands, not numbers, for Higgs', () => {
    const text = describeRelationship({ ...base, tension: .8, lastShift: { event: 'offensive_joke', turnId: 'u', major: true } });
    expect(text).toContain('trust medium'); expect(text).toContain('still affected by the user\'s offensive joke'); expect(text).not.toMatch(/0\.\d/);
    expect(buildContext(scenarios[0], { relationship: base }).instructions).toContain('Relationship so far');
  });
});

describe('Jev decision client', () => {
  const judgeAnswers = { major_shift: { type: 'noul', noul: .93 }, event: { type: 'choice', choice: 'offensive_joke', confidence: .8, probabilities: { offensive_joke: .8 } },
    behavior: { type: 'noul', noul: .05 }, ...Object.fromEntries(relationshipNames.map((n, i) => [n, { type: 'score', score: i === 3 ? .4 : 1.5, confidence: .6 }])) };
  it('sends the documented decisions request and maps typed answers', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ model: 'jev-1.14.0', answers: judgeAnswers, usage: { input_tokens: 812, output_tokens: 40, cost: .00003 } })));
    const decider = new JevDecider(jevConfig, fetcher as typeof fetch);
    const result = await decider.judge({ character: alex, relationship: initialRelationship(alex), conversation: [{ role: 'user', text: 'Hi' }], line: 'You are stupid, just kidding.' }, new AbortController().signal);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions'); expect((init.headers as Record<string, string>).Authorization).toBe('Bearer or-key');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('typesafe/jev-1.14'); expect(body.state.latestUserLine).toBe('You are stupid, just kidding.');
    expect(body.questions.major_shift.type).toBe('noul'); expect(body.questions.event.type).toBe('choice');
    expect(body.questions.respect).toMatchObject({ type: 'score', criteria: ['drops a lot', 'drops a little', 'no change', 'rises a little', 'rises a lot'] });
    expect(result).toMatchObject({ majorShift: .93, event: 'offensive_joke', behavior: .05, usage: { inputTokens: 812, cost: .00003 } });
    expect(result.nudges.respect).toBeCloseTo(-1.6); expect(result.nudges.comfort).toBeCloseTo(-.5);
  });
  it('asks one emotion question per sentence and falls back to neutral for unusable answers', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ answers: { s0: { choice: 'bitterness', probabilities: { bitterness: .7 } }, s1: { choice: 'not-an-emotion' } } })));
    const result = await new JevDecider(jevConfig, fetcher as typeof fetch).emotions({ character: alex, relationship: initialRelationship(alex), conversation: [], sentences: ['That was not funny.', 'Let\'s move on.'] }, new AbortController().signal);
    const body = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(Object.keys(body.questions)).toEqual(['s0', 's1']); expect(body.questions.s0.criteria).toHaveProperty('anger');
    expect(result.choices).toEqual([{ emotion: 'bitterness', probability: .7, probabilities: { bitterness: .7 } }, { emotion: 'neutral', probability: 0 }]);
  });
  it('retries a rate-limited request before giving up', async () => {
    const answers = { s0: { choice: 'anger', probabilities: { anger: .9 } } };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('busy', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ answers })));
    const result = await new JevDecider(jevConfig, fetcher as unknown as typeof fetch).emotions({ character: alex, relationship: initialRelationship(alex), conversation: [], sentences: ['No.'] }, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(result.choices[0].emotion).toBe('anger');
    const always = vi.fn(async () => new Response('busy', { status: 429, headers: { 'retry-after': '0' } }));
    await expect(new JevDecider(jevConfig, always as unknown as typeof fetch).judge({ character: alex, relationship: initialRelationship(alex), conversation: [], line: 'x' }, new AbortController().signal)).rejects.toThrow('429');
    expect(always).toHaveBeenCalledTimes(3);
  });
  it('rejects incomplete answers and never echoes upstream bodies', async () => {
    const incomplete = new JevDecider(jevConfig, (async () => new Response(JSON.stringify({ answers: { major_shift: { noul: .2 } } }))) as typeof fetch);
    await expect(incomplete.judge({ character: alex, relationship: initialRelationship(alex), conversation: [], line: 'x' }, new AbortController().signal)).rejects.toThrow('incomplete');
    const rejected = new JevDecider(jevConfig, (async () => new Response('or-key leaked', { status: 401 })) as typeof fetch);
    await expect(rejected.judge({ character: alex, relationship: initialRelationship(alex), conversation: [], line: 'x' }, new AbortController().signal)).rejects.not.toThrow('or-key');
  });
  it('splits replies into sentences without losing text', () => {
    expect(splitSentences('That was not funny. Let\'s keep things respectful! Okay?')).toEqual(['That was not funny.', 'Let\'s keep things respectful! Okay?']);
    const long = Array.from({ length: 25 }, (_, i) => `Sentence number ${i}.`).join(' ');
    expect(splitSentences(long)).toHaveLength(20); expect(splitSentences(long).join(' ')).toBe(long);
  });
});

describe('DeepSeek as the decision model', () => {
  const config = { provider: 'deepseek' as const, url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', key: 'ds-key', timeoutMs: 4000, majorThreshold: .7 };
  const completion = (content: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 900, completion_tokens: 60, total_tokens: 960 } }));
  it('asks for the quick check as JSON and clamps the answers into range', async () => {
    const fetcher = vi.fn(async () => completion({ majorShift: 1.4, event: 'offensive_joke', behavior: .05, nudges: { comfort: -1.5, trust: -1, interest: -.5, respect: -3, closeness: -1 } }));
    const result = await new DeepSeekDecider(config, fetcher as unknown as typeof fetch).judge({ character: alex, relationship: initialRelationship(alex), conversation: [], line: 'Haha you are stupid, just kidding.' }, new AbortController().signal);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; const body = JSON.parse(String(init.body));
    expect(url).toBe('https://api.deepseek.com/chat/completions'); expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ds-key');
    expect(body).toMatchObject({ model: 'deepseek-flash', response_format: { type: 'json_object' }, thinking: { type: 'disabled' } });
    expect(JSON.parse(body.messages[1].content).latestUserLine).toBe('Haha you are stupid, just kidding.');
    expect(result).toMatchObject({ majorShift: 1, event: 'offensive_joke', behavior: .05, usage: { inputTokens: 900, outputTokens: 60 } });
    expect(result.nudges.respect).toBe(-2);
  });
  it('maps weighted emotion candidates per sentence and drops unknown emotions', async () => {
    const fetcher = vi.fn(async () => completion({ sentences: [{ emotions: { bitterness: .6, determination: .4 } }, { emotions: { 'not-real': 1 } }] }));
    const result = await new DeepSeekDecider(config, fetcher as unknown as typeof fetch).emotions({ character: alex, relationship: initialRelationship(alex), conversation: [], sentences: ['I see.', 'Okay.'] }, new AbortController().signal);
    expect(result.choices).toEqual([{ emotion: 'bitterness', probability: .6, probabilities: { bitterness: .6, determination: .4 } }, { emotion: 'neutral', probability: 0 }]);
  });
  it('rejects malformed answers without echoing the upstream body', async () => {
    const decider = new DeepSeekDecider(config, (async () => completion({ majorShift: .2 })) as unknown as typeof fetch);
    await expect(decider.judge({ character: alex, relationship: initialRelationship(alex), conversation: [], line: 'x' }, new AbortController().signal)).rejects.toThrow('incomplete');
  });
});

describe('conflict-aware mock fallback',()=>{
  it('distinguishes an argument from a repeated personal dismissal',async()=>{
    const model=new MockDecider(),relationship=initialRelationship(alex),signal=new AbortController().signal;
    const disagreement=await model.judge({character:alex,relationship,conversation:[],line:'I disagree with that assumption.'},signal);
    expect(disagreement.event).toBe('disagreement');expect(disagreement.nudges.respect).toBe(0);expect(disagreement.majorShift).toBeLessThan(.7);
    const pressured=await model.judge({character:alex,relationship:{...relationship,tension:.8,lastShift:{event:'insult',turnId:'old',major:true}},conversation:[],line:'Stop being so sensitive. Tell me now.'},signal);
    expect(pressured.event).toBe('boundary_pressure');expect(pressured.nudges.respect).toBeLessThan(0);expect(pressured.majorShift).toBeGreaterThan(.7);
  });
});

describe('turn judgment and voice in the coordinator', () => {
  function setup(decider: Decider = new MockDecider(), provider: AppraisalProvider = new MockAppraisalProvider(), conflict?:ConflictTuning) {
    const store = new ConversationStore();
    const coordinator = new AdaptationCoordinator(store, scenarios, { provider: 'mock', model: 'unused', timeoutMs: 1500, maxDelta: .1,
      appraisalTrigger: 'major_shift', decision: { ...jevConfig, provider: 'mock' }, conflict }, provider, decider);
    const session = store.create(scenarios[0]); coordinator.initialize(session.id, 'adaptive');
    return { store, coordinator, id: session.id };
  }
  it('ordinary lines only nudge the relationship; no full appraisal runs', async () => {
    const appraise = vi.fn(); const h = setup(new MockDecider(), { name: 'spy', appraise } as unknown as AppraisalProvider);
    h.store.snapshot(h.id, 1, [user('u1', 0, 'I went to a pottery class.')]);
    const result = await h.coordinator.judgeTurn(h.id, 'u1');
    expect(result).toMatchObject({ major: false, event: 'interest', stateVersion: 1 }); expect(result.instructions).toBeUndefined();
    expect(appraise).not.toHaveBeenCalled();
    const state = h.coordinator.current(h.id);
    expect(state.lastProcessedTurnId).toBe('u1'); expect(state.relationship!.interest).toBeGreaterThan(initialRelationship(alex).interest);
    expect(h.coordinator.get(h.id).judgments).toHaveLength(1);
    expect(await h.coordinator.judgeTurn(h.id, 'u1')).toMatchObject({ major: false, stateVersion: 1 }); // idempotent
  });
  it('passes the configured anger strength through to the real TTS tag selection',async()=>{
    for(const anger of [0,.8]){
      const decider=new MockDecider();vi.spyOn(decider,'emotions').mockResolvedValue({choices:[{emotion:'neutral',probability:.85,probabilities:{neutral:.85,anger:.15}}]} as never);
      const h=setup(decider,undefined,{provocation:.8,anger}),data=h.coordinator.get(h.id);
      data.states[data.states.length-1].relationship={...initialRelationship(alex),tension:.45};h.store.setAdaptation(h.id,data);
      const spoken=await h.coordinator.voice(h.id,'a1','That was unnecessary.',new AbortController().signal);
      expect(spoken.record.sentences[0].emotion).toBe(anger===0?'neutral':'anger');
      expect(spoken.input.startsWith('<|emotion:anger|>')).toBe(anger!==0);
    }
  });
  it('a major shift runs the full appraisal first and returns the new instructions', async () => {
    const h = setup();
    h.store.snapshot(h.id, 1, [user('u1', 0, 'Hi, nice to meet you.'), reply('a1', 1, 'Nice to meet you too.'), user('u2', 2, 'Haha you are kind of stupid, just kidding.')]);
    await h.coordinator.judgeTurn(h.id, 'u1');
    const result = await h.coordinator.judgeTurn(h.id, 'u2');
    expect(result).toMatchObject({ major: true, event: 'offensive_joke' }); expect(result.instructions).toContain('You are Alex');
    const data = h.coordinator.get(h.id);
    expect(data.attempts.map(a => [a.turnId, a.status])).toEqual([['u2', 'committed']]);
    const state = h.coordinator.current(h.id);
    expect(state.lastProcessedTurnId).toBe('u2'); expect(state.realism).toBeDefined();
    expect(state.relationship!.tension).toBe(.8); expect(state.relationship!.respect).toBeLessThan(initialRelationship(alex).respect);
    expect(data.judgments!.at(-1)).toMatchObject({ major: true, appraised: 'committed' });
    expect(result.instructions).toContain('still affected by the user\'s offensive joke');
  });
  it('refuses to judge a line that has not been recorded yet', async () => {
    const h = setup(); await expect(h.coordinator.judgeTurn(h.id, 'missing')).rejects.toThrow('Record the finalized user line');
  });
  it('falls back to keyword rules and the mood when the decision model fails, instead of going neutral', async () => {
    const h = setup({ name: 'broken', judge: async () => { throw new Error('rate limited'); }, emotions: async () => { throw new Error('rate limited'); } });
    h.store.snapshot(h.id, 1, [user('u1', 0, 'Nice weather today.'), user('u2', 1, 'You are stupid.')]);
    expect(await h.coordinator.judgeTurn(h.id, 'u1')).toMatchObject({ major: false });
    expect(await h.coordinator.judgeTurn(h.id, 'u2')).toMatchObject({ major: true, event: 'insult' });
    expect(h.coordinator.get(h.id).judgments!.at(-1)!.error).toBe('Decision model failed.');
    const { input, record } = await h.coordinator.voice(h.id, 'a2', 'That was rude.', new AbortController().signal);
    expect(record.error).toBe('Decision model failed.'); expect(input).toMatch(/^<\|emotion:(anger|bitterness)\|>/);
  });
  it('tags a tense character expressively and tells the whole turn in order in the log', async () => {
    const decider = new MockDecider();
    vi.spyOn(decider, 'emotions').mockResolvedValue({ choices: [{ emotion: 'determination', probability: .7, probabilities: { determination: .7, anger: .3 } }] } as never);
    const h = setup(decider);
    h.store.snapshot(h.id, 1, [user('u1', 0, 'Hi there.'), reply('a1', 1, 'Hello.'), user('u2', 2, 'You are stupid, just kidding.')]);
    await h.coordinator.judgeTurn(h.id, 'u1'); h.coordinator.finishTurn(h.id, { reply: 'Hello.', tts: { model: 'higgs-tts-3', voice: 'default', input: 'Hello.', seconds: 1, ms: 10 } });
    await h.coordinator.judgeTurn(h.id, 'u2');
    const { input } = await h.coordinator.voice(h.id, 'a2', 'I did not find that funny.', new AbortController().signal);
    expect(input).toBe('<|emotion:anger|><|prosody:expressive_high|>I did not find that funny.');
    const printed: string[] = []; vi.stubEnv('VITEST', ''); const spy = vi.spyOn(console, 'log').mockImplementation(m => { printed.push(String(m)); });
    try { h.coordinator.finishTurn(h.id, { reply: 'I did not find that funny.', discardedDraft: 'Ha, fair!', tts: { model: 'higgs-tts-3', voice: 'default', input, seconds: 2, ms: 30, firstAudioMs: 300 } }); }
    finally { spy.mockRestore(); vi.unstubAllEnvs(); }
    const story = printed.join('\n');
    const order = ['YOU', 'CHECK', 'DRAFT', 'DEEPSEEK', 'STATE', 'VOICE', 'TTS3', 'ALEX'].map(label => story.indexOf(`  ${label}`));
    expect(order.every(i => i >= 0)).toBe(true); expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(story).toContain('Turn 2'); expect(story).toContain('"You are stupid, just kidding."'); expect(story).toContain('discarded unheard: "Ha, fair!"');
    expect(story).toContain("mock's top: determination 0.70; mood favoured anger");
  });
  it('tags each sentence with its emotion for TTS 3 and records the choice', async () => {
    const decider = new MockDecider(); vi.spyOn(decider, 'emotions').mockResolvedValue({ choices: [{ emotion: 'bitterness', probability: .7 }, { emotion: 'neutral', probability: .5 }] });
    const h = setup(decider);
    const { input, record } = await h.coordinator.voice(h.id, 'a1', 'That was not funny. Let\'s keep things respectful.', new AbortController().signal);
    expect(input).toBe('<|emotion:bitterness|>That was not funny. <|reset|>Let\'s keep things respectful.');
    expect(record.sentences.map(s => s.emotion)).toEqual(['bitterness', 'neutral']);
    h.coordinator.recordVoiceTiming(h.id, 'a1', { ttsFirstAudioMs: 280 });
    expect(h.coordinator.get(h.id).voices!.at(-1)).toMatchObject({ replyItemId: 'a1', ttsFirstAudioMs: 280 });
  });
});
