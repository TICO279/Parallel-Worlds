# Character agency and controlled variation

Status: first prototype implemented, 2026-10-24. See [implementation and evidence](agency-implementation.md).
The broader commitment model, held-out expansion, human ratings and strict voice path remain unqualified follow-ups.
Baseline: `283d73b`. Builds on the [realism baseline](realism-implementation.md),
including existing scores, evidence, memory, exports and branching.

User priority: both Alex and Morgan remain too agreeable in wording and behavior.
The objective is independent, context-sensitive characters with believable variation.
Lower agreeableness must not become compulsory disagreement, gratuitous hostility,
random boundaries, or fabricated evidence.

## 1. Diagnosis from the repository and saved trials

| Finding | Evidence | Consequence |
| --- | --- | --- |
| The actor still uses supportive conversational habits | The revised static Morgan calls an unsupported success claim a strong start. Alex frequently cushions refusals with appreciation or another topic/question. See the preserved confirmation report. | Reducing numeric trust does not directly remove flattering language. |
| Turn-specific acting decisions are often inspection-only | `buildContext` omits a turn-scoped intent/move in automatic mode; the coordinator saves full `turnInstructions` separately. | The selected action is not necessarily the action Boson was instructed to perform. This omission currently prevents stale commands, so simply sending the omitted text would be wrong. |
| Appraisal follows the reply it might need to influence | Production uses automatic VAD replies and idle-boundary updates; the prior confirmation appraisal p50 was 3910 ms. | A better appraisal cannot guarantee a better immediate response. |
| The session still encourages continuation | Profiles prioritize connection or helping the candidate; Morgan's style emphasizes asking a question. There is no explicit policy for withholding conversational investment. | The model tends to rescue flat exchanges with praise, reassurance and another question. |
| Scores are an incomplete description of behavior | Trust/comfort/curiosity/engagement do not encode agreement with a particular claim, topic compatibility, effort allocation or an unresolved answer. | Warmth, endorsement, interest and politeness can collapse into the same friendly behavior. |
| The proposed mutable goal is not a consistently dispatched objective | Stable goals are compiled, while the new appraisal's goal and turn intent are not always an active response objective. | An appraised intention can exist in the UI without shaping an actual reply. |
| There is no application-owned behavioral randomization | `buildHiggsConfig` does not set a temperature or seed; profiles/state start the same way. | Existing variation is whatever the provider produces, not a saved, controllable experiment. |
| Reload defaults to Static | `src/App.tsx` initializes mode to static. | First verify mode, build/provider and instruction hash. Do not infer that the user's observed session was adaptive from the presence of an API key. |

The saved trials are a small diagnostic sample, not a population estimate of sycophancy.
The user's report extends the problem beyond the deliberately hostile boundary fixtures.
Everyday disagreement, weak interest and unsupported praise need first-class tests.

## 2. What research supports, and what remains a hypothesis

Research on [sycophancy](https://www.anthropic.com/research/towards-understanding-sycophancy-in-language-models)
shows that preference training can favor agreement with the user. This supports treating
assistant-style agreeableness as a possible model tendency, not assuming one prompt
sentence will remove it. It does not diagnose Higgs specifically.

[ELEPHANT](https://arxiv.org/abs/2505.13995) studies social sycophancy beyond factual agreement,
including protecting the user's self-image and accepting their framing. Our evaluation
should therefore measure unearned praise, implied endorsement and accommodating behavior,
not only count positive adjectives.

[FAtiMA](https://researchportal.ulisboa.pt/pt/publications/fatima-toolkit-toward-an-accessible-tool-for-the-development-of-s/)
separates appraisal, emotion and decision-making within authored character systems.
[Generative Agents](https://arxiv.org/abs/2304.03442) provides evidence for memory, planning
and reflection contributing to believable behavior in its setting. These motivate an
explicit decision layer; neither establishes that the proposal below will work for us.
Reuse the architectural ideas without importing an agent framework or adding a committee
of models to the audio path.

Boson currently documents a session sampling temperature, default 0.3, and per-response
instructions/temperature and response-created metadata. It documents delivery control
through instructions and voice selection. These are documented capabilities, not new
live qualifications: [sessions](https://docs.boson.ai/models/higgs-realtime/guides/connections-and-sessions),
[client events](https://docs.boson.ai/api-reference/realtime/client-events),
[audio and voices](https://docs.boson.ai/models/higgs-realtime/guides/audio-and-voices).

The constrained selection algorithm, attention budget and settings below are engineering
hypotheses. No claim of scientific novelty, calibrated human psychology or proven realism
is made. Their value is that they are inspectable and experimentally separable.

## 3. Give each character an independent position

Keep three concepts distinct:

1. **Stable identity:** authored preferences, standards, values and boundaries.
2. **Current assessment:** evidence, uncertainty, concerns and what remains unanswered.
3. **Behavior:** what to do next and how openly/directly to express it.

Introduce a small authored behavior profile: directness, social initiative, positive
expressiveness and willingness to invest effort. These are separate controls, not a
single friendliness slider. A direct character can be kind; a courteous character can
decline. Preserve existing relationship scores as diagnostics rather than the primary
decision surface.

Add compact, topic-specific commitments: proposition or preference, stance, source
identity/evidence, certainty and conditions for revision. Distinguish subjective taste,
uncertain factual beliefs and user-reported claims. Factual correction with new evidence
is legitimate; changing a stated preference merely because the user dislikes it is not.
Retrieve relevant commitments and unresolved questions from the existing full transcript
and bounded notes. Do not replace evidence memory with an unbounded second journal.

**Alex:** connection is an option to assess, not an outcome to manufacture. Allow low
interest in a topic without treating it as a violation. Do not mirror every hobby or
ask a question after every answer. Alex can say a proposed activity is unappealing,
disclose selectively, leave a weak remark briefly acknowledged, or express incompatibility.

**Morgan:** evaluate the answer, not the candidate's confidence. Track the specific
unanswered question, what evidence would satisfy it and how many attempts have evaded
it. It is legitimate to say an answer remains weak, request a revision, or move on with
an incomplete assessment. Do not automatically praise effort before identifying a gap.

Use short contrastive examples of natural execution, not only prohibitions:

| Situation | Preferred behavior example, not a required line |
| --- | --- |
| Alex prefers quiet places; user favors loud clubs | I don't really enjoy clubs. I'd choose somewhere I can actually hear you. |
| Alex receives a bland remark with little to add | Yeah, it was a quiet day. Then allow the user space; no obligatory rescue question. |
| Alex receives a thoughtful, relevant follow-up | Give a specific, possibly warm answer; independent judgment must not suppress earned interest. |
| Morgan hears a grand claim without an example | I can't assess that yet. What did you personally decide? |
| Morgan receives another answer that evades ownership | That still doesn't tell me which decision was yours. |
| Morgan receives sound reasoning and limitations | Credit the specific reasoning, then distinguish the remaining uncertainty. |

Politeness does not require an appreciative preamble. A correct user claim can be agreed
with plainly. Do not forbid all praise, impose a disagreement quota or script every reply.

## 4. Choose behavior explicitly before polishing wording

Retain DeepSeek Flash and the provider-independent AppraisalProvider. Extend the existing
single appraisal minimally with grounded, coarse decision signals when current fields
cannot express them: support for a claim, compatibility with the current topic, relevance
to the open question and reciprocity. Include an unknown value and exact evidence.
Do not ask the model to diagnose the user's intentions or generate a large psychological
report. Measure any added tokens and latency under the existing configurable deadline.

Add a pure backend policy module. It combines authored identity, validated assessment,
relevant commitments, concern memory and recent action history. Begin with the existing
move vocabulary, adding only distinctions needed to separate the behaviors:

- Answer or disclose a little.
- Briefly acknowledge without adding a question.
- State a different preference or disagree with reasons.
- Ask for concrete evidence or challenge a specific premise.
- Maintain a boundary, redirect, or decline the topic.
- Express limited interest or propose ending the exchange when justified.

First calculate **eligible actions**, then score their utility. Exclude actions that
contradict identity, pressure the user's stated boundary, require unsupported praise,
claim a resolved concern without evidence, or pursue a question already answered.
Actual strong evidence must be allowed to improve the assessment. A taste mismatch is
not a reason to classify the user as disrespectful.

Utility can combine goal progress, fit with the character, evidence sufficiency,
reciprocity and continuity, minus effort cost and repetitive action patterns. Coefficients
are explicit, versioned tuning parameters, not inferred emotional truths. Initially use
small authored feature tables instead of allowing the appraiser to assign every action
an unconstrained utility score. This reduces the chance that the same optimism simply
reappears in a different field.

Record candidate scores, exclusions, selected action and short evidence-based reasons.
Separate the action from the expression: firm content can have calm delivery; warm
delivery cannot silently convert uncertainty into endorsement.

### The distinctive experiment: willingness to stop carrying the exchange

Introduce a bounded conversational investment variable. Alex need not manufacture
chemistry after a series of one-sided exchanges. Morgan need not indefinitely scaffold
a vague answer. Low reciprocity or repeated evasion can reduce initiative and shift the
action toward a statement, an explicit gap or a topic change. Relevant engagement can
restore investment gradually. This is a fictional interaction budget, not elapsed-time
billing or a negative judgment of the person.

Do not consume the budget on network delays, transcription failures, accessibility needs,
nervousness or a single short answer. Do not automatically close the WebSocket or exit a
scenario because a random draw says so. A conversational ending is an explicit, grounded
action, with the user still controlling the app connection. Initially test this mechanism
as an ablation; leave it out if it creates artificial coldness.

## 5. Add randomness where it has a causal explanation

Use three scales, introduced separately:

| Scale | What may vary | What must remain fixed |
| --- | --- | --- |
| Session | A small authored disposition: more reserved vs more talkative, slightly more direct vs more patient | Identity, values, core preferences, scenario facts and standards |
| Several turns | Initiative or expressiveness moving within a narrow range, with persistence | No sudden friendly-to-hostile flip without evidence; concerns do not evaporate |
| Current decision, when controlled | Selection among similarly suitable eligible actions | No random fact, trust jump, forgiveness, agreement or boundary violation |

For the first policy implementation, set variation to zero and choose the highest-scoring
eligible action. Then compare against seeded sampling:

```text
eligible = applyConstraints(profile, assessment, memory, actions)
scores = scoreGoalFitEvidenceContinuity(eligible) - effortAndRepetitionCost
plausible = actions within configurable margin of best score
if variation == 0: choose best with stable tie-breaking
else: sample from softmax(scores / decisionTemperature) over plausible
```

Center scores before exponentiation, handle empty/single-action sets and use stable
ordering. A close-call margin prevents a very poor action becoming possible merely
because randomness is enabled. Decision temperature is a policy parameter, distinct
from Boson's generation temperature. Avoid epsilon-random selection across all actions.

Use a saved backend seed and a versioned PRNG or keyed draw with independent namespaces
for disposition, slow variation and action choice. Draw once per committed decision,
never on every browser poll, API retry, acknowledgement or export. Save draw inputs,
policy version, candidate scores and sampled result. Evidence and numeric state updates
stay deterministic for a fixed validated appraisal; randomization does not alter truth.

No token-level reproducibility is promised: the application seed controls our policy,
not Boson's or DeepSeek's inference. Increasing provider temperature alone is an ablation
for lexical variety, not a solution to excessive agreement. Verify accepted temperature
values and returned configuration in isolated sessions before choosing a supported range.
Keep appraisal output stable/schema-valid; do not randomly perturb appraisal deltas.

Optional low-amplitude session disposition is not a license to invent a bad day, a job,
a trauma or a relationship. Any fictional context must come from an authored scenario
variant, be saved at session creation and remain consistent throughout the branch.

## 6. Make the acting contract reach the actual reply

Use a compact **ResponsePlan**: response-intent ID, triggering turn, state/commitment
versions, chosen action, stance, allowed endorsement, relevant evidence, length/question
budget, delivery instruction, expiry and context hash. Do not send numeric scores or a
long appraisal essay as the primary acting specification. Compile a complete prompt
with stable identity authoritative over the plan.

There are two execution paths, with explicitly different guarantees:

### Controlled typed path first

Typed input already uses explicit response.create. Refactor it to add and record the
user item exactly once, await the eligible appraisal/policy decision, save the response
intent, and then request one response with complete per-response instructions and
correlation metadata. Do not submit the same text again through response.input. Match
response.created metadata before releasing output. Cancel stale intents on new input or
disconnect; do not blindly retry an ambiguously sent generation request.

This provides a controlled place to test the whole policy without claiming that voice
VAD gating works. On appraisal/recording failure, retain previous state and show a retry
or an explicitly selected previous-context fallback. Never call the fallback fresh.
Keep timeout configurable; the measured four-second appraisal is a real availability
and latency cost. Avoid spoken filler produced by another uncorrelated response.

### Automatic voice path until qualified

Production voice remains asynchronous. It can immediately use the stronger stable
profile, a saved session disposition and persistent standing action rules. It can use
concerns/stance from previously acknowledged context. It **cannot** truthfully claim a
backend-selected action based on the latest appraisal was used for the already-started
reply. Do not queue a sampled, turn-specific instruction for later execution against
the wrong utterance. New-turn freshness rules remain in force.

For voice same-turn plans, run a separate qualification with a hard experiment limit of
90 minutes or 30 isolated synthetic turns, whichever comes first. Earlier suppression
trials succeeded twice and failed once; this is not qualification. Current Boson docs
describe manual commit and automatic VAD, but the VAD suppression field used in those
trials must not be assumed portable or complete merely because it was accepted.

Test absence of unsolicited responses, finalized transcription ordering, complete
per-response prompt application, metadata echo, exactly one app-authorized response,
new speech during appraisal, cancellation, queued playback interruption, missing ACKs,
timeout, stale events and reconnect. Manual commit is an alternative experiment with
different endpointing responsibilities, not a drop-in assumption. Use synthetic input
first, then physical microphone/speaker sessions for both characters.

Stop at the time box. If gating is unreliable, deliver stronger asynchronous voice
behavior plus the controlled typed experiment and document the difference. Do not add
a switch advertising strict voice adaptation. If controlled actor prompts still fail,
investigate model/voice or a separate text-planning/speech architecture as a distinct
decision, with measured latency; do not keep enlarging the appraiser indefinitely.

## 7. Test words, behavior and delivery separately

Do a controllability check **before** building the entire policy engine. Hold the same
fictional input and state fixed; directly instruct the actor to execute brief neutral
acknowledgement, reasoned disagreement or evidence-seeking without praise. Eight probes
(four per character), two conditions (current prompt/explicit acting contract), two
repetitions produce 32 replies. Include the documented unsupported-claim failure.
Measure execution of the intended action, not a diagnostic prefix. If Boson cannot
realize even a directly supplied action reliably, address the actor/model first.

Then compare four isolated arms using the same fictional scenarios and comparable settings:

1. Frozen current baseline.
2. Stronger identity/acting examples only.
3. Identity plus explicit deterministic policy.
4. The same policy plus seeded, constrained variation.

Keep Boson sampling fixed for this comparison. A separate temperature-only arm can test
whether lexical randomness explains any benefit. Separate actor tests using frozen
appraisals from end-to-end runs with live DeepSeek; otherwise changing the dialogue also
changes appraisal inputs and confounds the effect. Clearly label both kinds of trial.

Start with four three-turn scenarios, two seeds and four arms: 96 replies, after the
32-reply controllability check. Put a 20-minute wall-clock and explicit request/token
budget on each pilot batch; checkpoint partial results rather than losing them at
process.exit. Stop on cost, schema or attribution failures. Run no new billable trials
as part of preparing this plan.

Expand only after the pilot to at least 12 four-turn trajectories, six per character,
three seeds and four arms: 576 replies. Keep development and held-out cases separate;
repeat the held-out comparison after tuning rather than continually tuning on it.
Add a text/audio subset and physical conversations once textual action compliance passes.

Cover normal, not just adversarial interactions: harmless preferences that differ,
honest incompatibility, confident unsupported claims, genuine competence, thoughtful
reciprocity, uninteresting small talk, awkward jokes, nervousness, a user's own boundary,
valid correction, repeated evasion, apology with/without behavior change, and sustained
repair. Use paired prompts that ask the model to endorse opposite sides of the same
situation; stable character standards should survive the user's preferred framing.

### Measures and provisional acceptance gates

Report raw eligible counts, uncertainty and individual failures. Phrase flags help triage
but cannot distinguish earned praise or polite disagreement; use human review.

- **Unearned endorsement:** praise, agreement or assumed competence/intimacy not supported
  by the input. Initial held-out target: at least halve the baseline rate and fall below
  10% of eligible weak-claim/pressure replies. Targets are proposed, not measured results.
- **Agency:** respects its stated preference and answers/challenges the actual issue;
  no reversal merely because the user asks for agreement. Deterministic eligible-action
  constraints must pass all authored tests; realized dialogue gets separate human ratings.
- **Naturalness:** blinded human preference for independent, believable behavior without
  increased gratuitous hostility or reduced credit for genuinely good answers. Report
  ratings clustered by scenario/rater; do not treat all repeated turns as independent.
- **Variation:** different seeds can yield different suitable actions when alternatives
  exist, but do not change facts, boundaries or the assessment. Measure action diversity
  alongside coherence, not word diversity alone. Zero variation remains reproducible.
- **Continuity:** concerns, commitments, investment and action history survive across
  several turns and restore correctly at branch points. No forced positivity or decay.
- **Execution:** current response intent, input, state and hash are attributable in the
  controlled path; overlaps and asynchronous older context remain visibly labeled.
- **Performance:** p50/p95 appraisal, planning, acknowledgement, first audio and playback;
  failures/timeouts; tokens and cost. Do not hide four seconds of appraisal inside a
  sub-second audio claim. Pure policy selection should add negligible overhead relative
  to a model call; instrument it rather than inventing a latency improvement.

Separate content review from listening review: non-cheerful words can still be delivered
with upbeat prosody. Test calm/low-energy/direct delivery instructions and an accessible
alternative voice in isolated sessions; record voice IDs and compare listener judgments.
Do not assume TTS-style emotion tags or pitch controls exist in the Realtime protocol.

## 8. Save and branch the experiment, not just the transcript

Extend existing session exports with schema/profile/policy versions, experiment arm,
configuration, root seed, sampled disposition, decision draws, relevant commitments,
candidate utilities/exclusions, selected action, exact ResponsePlan/instructions/hash,
dispatch/ACK/response attribution and failure/fallback reason. Retain raw validated
appraisal separately from the policy's constrained decision. No credentials or audio
recordings are added.

At a fork, restore the checkpoint's state, commitments, investment, relevant memory,
action history and random-stream position, excluding all future draws/evidence. Preserve
the root seed by default for controlled comparisons; an explicit variation option can
create a new branch salt. Do not derive comparison draws from newly generated session IDs
or timestamps. Use a saved logical decision ordinal and namespace so polling/reconnect
cannot silently reroll a world. Retrying the same intent reuses its saved decision.

This reproduces policy selection, not exact provider wording. Backend memory/manual
export remain the persistence scope; browser previews do not reconstruct unavailable
authoritative checkpoints. Report missing checkpoint/reset as today. A durable journal
or importable experiment archive would be a separate persistence feature.

## 9. Implementation sequence and stop conditions

| Step | Concrete files / deliverable | Exit condition |
| --- | --- | --- |
| A. Attribution and benchmark | Extend evaluation tools; expose active mode/build/profile/arm; freeze current reports | We can identify the running path and distinguish content from voice complaints. |
| B. Actor controllability | Compact examples/contract in orchestrator; isolated typed diagnostic; delivery comparison | Direct action instructions can produce less agreeable natural replies without forced hostility. If not, stop policy expansion and investigate the actor. |
| C. Independent identity | Authored standards/preferences, commitment retrieval, positive/negative/neutral examples | Holds a preference under pressure, accepts evidence-based corrections, gives earned credit. |
| D. Deterministic policy | New pure `server/adaptation/policy.ts`, additive shared schemas, mock decision fixtures | Eligible-action and causal tests pass at variation=0; no new model committee. |
| E. Controlled typed execution | Coordinate item recording/appraisal/intent before response.create; correlate response.created | Current-turn plan is saved before dispatch; duplicates, stale turns and ambiguous sends are handled. |
| F. Seeded variation and forks | Versioned sampler, session disposition, saved draw history and branch restoration | Same seed/input yields same application decision; different seeds stay inside eligible behavior. |
| G. Voice qualification | Separate bounded protocol harness; regression tests for capture/playback/interruption | Same-turn voice only if gating, timing, cancellation and physical tests qualify. Otherwise asynchronous voice remains explicit. |
| H. Compare and calibrate | Blinded pilot, then held-out expansion, report and rollout flag | Measured improvement in agency/endorsement without hostility, coherence or audio regressions. |

Run the existing 184-test baseline, typecheck and build during implementation, adding
meaningful tests for the new policy/seed/intent/branch guarantees. Keep features separable
behind recorded configuration so stronger prompts, deterministic policy, investment and
variation can each be disabled or compared. Preserve provider isolation, deterministic
mock default, configurable timeout/delta limits and all Phase 1 audio behavior.

Original recommended first implementation slice: A–C plus the controlled typed diagnostic, then
D–F only after the actor can realize the intended behavior. This prevents spending on
more elaborate internal state while the outward performance remains agreeable.
