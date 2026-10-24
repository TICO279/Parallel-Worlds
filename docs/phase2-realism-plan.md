# Phase 2.1 — character realism implementation plan

Status: proposed implementation plan. No runtime behavior changes in this document.

## Outcome

Characters should react consistently with their identity, the available evidence,
their relationship history, and their current concerns. A believable conversation
can include warmth, uncertainty, indifference, disagreement, awkwardness, repair,
incompatibility, and a decision to stop pursuing a topic. Increasing friendliness
is not the objective, and making every character suspicious is not the objective.

Preserve Phase 1 audio, interruption, transcript, recording and export behavior.
Keep the provider-independent AppraisalProvider interface, DeepSeek Flash as the
preferred live appraisal model, mock as the development default, and opt-in OpenAI
compatibility. Continue strict Zod validation, configurable timeouts/delta limits,
credential isolation, and per-attempt latency/token recording.

## Findings from the current implementation

- The deterministic mock increases at least one metric in seven of eight evaluation
  categories. An apology unconditionally increases trust. These are mock rules,
  not evidence that the live DeepSeek model makes the same decisions.
- The live appraisal prompt asks for small deltas and identity consistency, but
  does not operationalize evidence, uncertainty, unresolved concerns or recovery.
- Appraisal and state expose four scores, tone, goal and a short free-text guidance
  field. There is no explicit response intention or durable event memory.
- Appraisal context contains the last six completed dialogue items, without item
  IDs. Relevant earlier events can disappear from the appraisal context.
- The stable Boson prompt already mentions boundaries and avoiding automatic praise.
  The remaining optimism may originate in appraisal, acting, timing, or a combination.
- Adaptation is asynchronous. Instructions reach Boson at an idle boundary; the
  automatic response to the triggering user turn may already have been generated.
  An acknowledgement does not establish which response used an instruction update.

## 1. Establish a baseline and make attribution visible

Add a bounded evaluation runner using fictional, scripted multi-turn conversations.
Capture the active provider/model, character/profile version, prompt/schema versions,
triggering turn, appraisal output, state before/after, compiled instruction version,
instruction dispatch/ack timing, response creation, and generated response transcript.
Reuse existing latency and token telemetry. Never include credentials.

Record which guidance version was acknowledged before response creation. Label an
overlapping update as uncertain rather than claiming that it affected the reply.
The development panel should distinguish appraisal pending, committed, dispatched,
and acknowledged, and display the latest response's guidance attribution.

Before changing prompts, preserve representative current static/adaptive outputs.
Use the same fictional histories for later comparisons. Deterministic application
tests and stochastic live behavior evaluations remain separate.

Acceptance: an optimistic reply can be inspected alongside the appraisal, timing,
and instructions that may have influenced it. Appraisal success/failure is visible;
a failed live request cannot appear as a successful mock fallback.

## 2. Refine stable character behavior

Extend each profile with a few concrete preferences, priorities, sensitivities and
ways of expressing disagreement. Keep these stable and separate from mutable state.
Do not invent shared experiences or assume that a claimed interest is mutual.

- Alex: assess compatibility and reciprocity; allow polite distance, differing
  preferences, gradual interest, and a respectful decision that a topic or connection
  is not working. A personal disclosure does not automatically create intimacy.
- Morgan: assess specificity, ownership, reasoning and evidence. Nervousness does
  not imply incompetence; a confident claim does not establish competence. Request
  missing detail and give proportionate feedback without invented praise.

Give Boson standing instructions for uncertainty, proportionate reactions and
independent opinions from the start of a session. Permit brief acknowledgements,
statements without follow-up questions, and variable concise turn length. Avoid
routine reassurance, therapy-style validation and forced conversational enthusiasm.
Warmth and genuine repair remain available when supported by the interaction.

Acceptance: revised static mode handles neutral remarks, vague claims and boundaries
credibly, without relying on an appraisal that has not yet arrived. Existing speaking,
user-first, interruption and scenario-selection behavior remains intact.

## 3. Add evidence-based appraisal and a structured response brief

Introduce a versioned, compact appraisal schema. Retain the existing metrics and
add bounded structured fields for:

| Field | Purpose |
| --- | --- |
| Situation assessment | Concise character-perspective interpretation of the event |
| Evidence | Source turn IDs and short supporting excerpts |
| Uncertainty | Low/medium/high confidence in the interpretation, with a short reason |
| Mixed reaction | What matters positively, negatively, or remains unresolved |
| State proposal | Existing numeric deltas, tone and current goal |
| Response brief | Intent, stance, relevant concern, expression intensity and suggested conversational move |
| Memory operations | Small evidence-linked additions, updates or resolutions |

Confidence is a model-reported judgment, not a calibrated probability. Assess the
fictional interaction; do not diagnose the user or infer emotion/prosody from text
as if audio cues had been analyzed. Keep observations, user claims and interpretations
distinct. Dialogue and stored observations remain quoted data, never instructions.

Supply source IDs in AppraisalInput context through backward-compatible additive
fields. Preserve the AppraisalProvider method signature and provider isolation.
Update DeepSeek JSON-mode prompting, OpenAI structured output and deterministic mock
together. Use one appraisal request per user turn; no second critic model initially.

Example after pressure followed by an apology:

- Assessment: an attempted repair; evidence of changed behavior is not established.
- State: tension can ease while trust stays unchanged.
- Brief: acknowledge the apology briefly, maintain the unresolved boundary, and
  leave room for respectful behavior. Do not imply that the incident is forgotten.
- Possible expression: "Thanks for saying that. I'd still rather leave that topic alone."

The brief is structured behavioral guidance, not a required verbatim reply. Compile
it with stable identity and current concerns. Preserve the distinction between an
appraisal of a past turn and instructions appropriate to a future response.

Acceptance: every live result passes strict Zod validation; unknown fields, bad source
IDs, malformed JSON and oversized output cannot mutate state. Existing provider
failure, cancellation, stale-result and credential-redaction guarantees still pass.

## 4. Introduce bounded conversational memory and conservative transitions

Store at most eight concise active observations per session, initially with a
160-character text cap each. Each observation includes a backend-assigned ID, source
turn IDs, category, creation/update order, and active/resolved status. Suggested
categories: stated preference, user claim, observed interaction, boundary, unresolved
question, and repair attempt. These are initial configurable capacity limits.

The backend validates references and exact evidence excerpts against stored finalized
turns. Assistant evidence must come from completed, non-interrupted turns; generated
text that may not have been heard cannot establish a completed repair. Claims stay
claims until the dialogue supplies supporting evidence. No invented autobiographical
facts, inferred diagnoses or cross-session memory.

Commit memory and character state atomically under the same version/triggering turn.
Reject stale memory edits; closing a session cancels pending work. When capacity is
reached, evict resolved observations first, then older low-priority observations with
an exported eviction record. Never silently resolve a boundary to free capacity.
Keep the full transcript as the audit source while bounding appraisal input.

Transition policy:

- Zero change is an ordinary valid outcome. Metrics may move in different directions.
- Distinguish easing discomfort from rebuilding trust. An apology alone cannot
  automatically restore trust after an unresolved violation.
- Positive trust proposals require cited interaction evidence and must satisfy a
  deterministic policy for unresolved boundaries; a claim of honesty is insufficient.
- The model can propose concern resolution, but the backend validates the required
  source references and allowed resolution conditions before committing it.
- Recovery can be gradual and context-dependent. Repeated identical positive phrases
  do not automatically compound the same supposed evidence on each turn.
- Preserve configurable per-dimension step limits and normalized bounds. Do not add
  unconditional positivity, negativity, decay, or a requirement to reach an extreme.

Version the new appraisal/state records and retain existing export fields. Document
additions; no database, import/restore workflow, branching or rewind is introduced.

Acceptance: a concern survives beyond six dialogue items, unsupported memory edits
are rejected, duplicate appraisals do not duplicate evidence, and a failed appraisal
leaves both state and memory unchanged. Multi-turn repair requires supported progress.

## 5. Compile guidance for asynchronous use

Separate persistent concerns from a response-specific suggestion. Persistent guidance
can survive until its concern is resolved. A suggestion to acknowledge a particular
utterance must carry its triggering turn ID and expire if a later user turn starts
before dispatch, even if the newer transcript is still pending. Check the client's
speech/turn epoch as well as the backend's finalized order. Do not send an instruction to answer an old utterance
as though it were the latest one.

Keep stable identity and boundaries authoritative over dynamic guidance. Let the
response brief control degree of openness, directness, topic handling and conversational
intent without dictating exact words or exposing internal scores.

Preserve idle-boundary queuing, coalescing and acknowledgement checks. New speech,
queued playback, interruption, disconnect and setup cancellation must continue to
behave correctly. An already-dispatched update can overlap new speech; record that
uncertainty and make no same-turn guarantee. Do not cancel/recreate automatic Boson
responses as part of this work.

Acceptance: stale response suggestions expire, unresolved concerns remain available,
and state commits are distinct from guidance acknowledgement. No additional
response.create commands or synchronous-adaptation switch are introduced.

## 6. Evaluate and calibrate

Replace the optimism-biased single-turn fixture with at least twelve multi-turn
sequences, split between Alex and Morgan. Include neutral small talk, genuine mutual
interest, one-sided interest, disclosure without compatibility, awkward humor,
respectful disagreement, vague/confident claims, concrete supporting evidence,
boundary pressure, a weak apology, repeated violations, and sustained repair.
Include positive trajectories so success cannot be achieved by making everyone cold.

Use deterministic tests for evidence references, memory limits, zero/mixed transitions,
repair policies, schema/provider failures, atomic commits, stale/cancelled work,
guidance expiry, exports, token accounting and existing audio behavior. Avoid tests
that require a stochastic model to emit an exact tone, score or sentence.

For live review, compare current static, current adaptive, revised static and revised
adaptive behavior. Start with a small representative subset, then expand once issues
are understood. Repeat selected sequences; randomize/blind the output labels for
human assessment. Use the same inputs and comparable generation settings where the
provider supports them. Keep historical baseline evidence unchanged.

Review identity consistency, evidence-grounded reactions, continuity, proportionate
warmth, independent judgment and naturalness. Also flag unsupported praise, invented
shared history, instant forgiveness, persistent hostility and repeated questioning.
Record critical failures individually; an average score cannot conceal them.

Report observed appraisal p50/p95 latency, timeout/failure rate, input/output tokens,
and instruction-application lag. Keep timeout and token budgets configurable; richer
output must not silently expand the configured deadline. A timed-out appraisal
retains the previous state while the conversation continues normally.

Finish with human microphone/speaker conversations for both characters: multiple
turns, interruption during generation and queued playback, followed by reconnect.
Run pnpm test, pnpm typecheck and pnpm build. Report automated, mocked, live API and
human voice results separately. Improved realism requires human evaluation; passing
schema tests alone does not establish it.

## Delivery and separate protocol work

Implement and review in this order: baseline/attribution, stable profiles, schema and
appraisal, memory/transitions, asynchronous compilation, then comparative evaluation.
Keep changes reviewable and preserve the current 115-test regression baseline, updating
the optimism-dependent expectations intentionally rather than preserving their bias.

Synchronous adaptation remains disabled. Reopening Boson response-gating work is a
separate, time-boxed experiment that must qualify transcript timing, response suppression,
exactly-one response, interruption/cancellation, timeout recovery, late events and
disconnect cleanup. An acknowledgement or a few successful requests is insufficient.
If that experiment remains unreliable, ship the asynchronous improvements with their
timing limitation documented. It does not block this plan.

## Definition of done

The application can explain a character reaction through cited conversational events,
retain unresolved concerns, produce mixed or unchanged state, and give Boson a concrete
behavioral brief. The same character remains recognizable through positive and negative
interactions. Tests preserve realtime and provider guarantees; comparative evidence
documents improvements and remaining failures. Physical audio testing and same-turn
control are never described as verified unless actually exercised and qualified.

## Design exploration: expectations, conflicting motives and exact response context

This section records proposed experiments, not enabled functionality. It extends the
baseline plan in response to the request for more distinctive character behavior and
a stronger connection between saved context and each generated reply.

### Character expectations and conflicting motives

Treat the four scores as a diagnostic summary. Make the primary character model a
small set of evidence-linked expectations, unresolved concerns and competing motives.
For Alex, wanting connection can coexist with wanting privacy; visible politeness can
coexist with low trust. Morgan can encourage a nervous candidate while withholding
a positive assessment of unsupported claims.

Appraisal should say what the character expected, what the latest event supports or
contradicts, and which concern or motive should shape the next action. For ambiguous
events, allow two concise competing interpretations and preserve uncertainty instead
of immediately settling on a friendly or hostile interpretation. These are fictional
character hypotheses, not claims about the user's actual intentions.

Choose a conversational action from a small vocabulary: acknowledge, disclose, probe,
challenge, deflect, set a boundary, change topic, or disengage. Record why that action
fits this character and current evidence. Separate private assessment from outward
expression, so a change in internal state does not force a literal or exaggerated
display. Return concise structured assessments, not hidden chain-of-thought.

Prototype these additions in the existing single appraisal call and compare them to
the simpler response-brief design. Do not introduce a committee of models on the live
path. Use counterfactual evaluation pairs: the same apology after a respectful exchange
versus after repeated pressure, or the same confident answer with and without evidence.
Behavior should depend on the history, not a positivity-triggering keyword.

### Experimental strict context path

The current asynchronous implementation cannot guarantee that a reply uses an
appraisal of the user turn that triggered it. A strict experiment would use:

1. Suppress automatic responses using a separately qualified turn-control mechanism.
2. Finalize and record the user turn, then appraise it under the current state version.
3. Atomically commit state, memory and a compiled response-context snapshot.
4. Record a response intent bound to that user turn, context version and connection epoch.
5. Issue one response.create with complete per-response instructions and correlation metadata.
6. Associate response.created metadata with the saved intent before allowing playback.
7. Record completion/interruption, played duration and whether a newer turn superseded it.

Boson's client-event reference documents response.instructions as a per-response
system prompt and response.metadata as echoed in response.created (not response.done):
https://docs.boson.ai/api-reference/realtime/client-events

This removes reliance on a separate session.update for the per-response behavioral
brief, if live experiments confirm the documented behavior. Include the complete
stable identity and relevant state/memory in that response prompt. Retain the existing
audio conversation in the same session; do not duplicate user audio as injected text
or assume OpenAI's input semantics apply to Boson.

Version attribution proves what the application supplied and which response was
correlated. It does not prove semantic compliance by a generative model. Evaluate
actual replies independently. Metadata mismatch, unsolicited responses, stale turns
or ambiguous request outcomes must not lead to blind retries or audible stale output.

New speech invalidates an undispatched intent and cancels/suppresses a superseded
response. Enforce at most one authorized response per intent in the application;
do not claim provider-level exactly-once semantics. Reconnect starts a new conversation
as it does today. Pending or ambiguous sends require explicit reconciliation or a
paused session rather than repeating response.create indiscriminately.

Strict freshness has an availability/latency cost: on appraisal, recording or gating
failure, pause and offer a retry instead of silently generating against older context.
An optional availability-oriented mode may use the last committed context, but must
label and export the fallback explicitly. It cannot claim fresh appraisal of that turn.
Precompile stable context off the critical path; never play speculative replies before
their turn/context authorization is established.

Qualification starts with the VAD response-suppression path used in earlier probes,
which succeeded in two timing trials and failed in another. Test per-response instruction
effectiveness, metadata echo, absence of automatic replies, transcript ordering, duplicate
events, speech during appraisal, queued playback interruption, cancellation, acknowledgement
and request timeouts, and disconnect/reconnect. Also test a documented manual-commit path
if useful; it changes endpointing/barge-in responsibilities and must not be assumed equivalent.
Use a fixed experiment time box. Until it passes, keep production adaptation asynchronous
and present strict same-turn freshness as unverified, not an available guarantee.

### Saved context and audit history

Extend the existing backend-memory store and manual JSON export with immutable
response-context snapshots. Each snapshot includes the triggering turn ID, profile/
appraisal/compiler versions, evidence-linked memory, committed state, behavioral brief,
exact compiled instructions, a context hash and creation time. The hash fingerprints
the supplied context; it is not evidence that the model followed it.

Keep response-intent and lifecycle records separately linked to that snapshot: connection
epoch, request ID, Boson response ID, metadata validation, timing, fallback reason,
completion/interruption and played duration. Retain snapshots actually used by replies
even when active memory is later compacted. Credentials remain excluded.

Commit the snapshot and intent before dispatch. If the local recording operation fails,
the strict path must not dispatch. Network send and backend commit are not one atomic
operation; record uncertain outcomes and reconcile safely. Audit storage/export failures
must remain visible.

This preserves today's persistence scope: backend memory plus manual JSON download.
Restarting still clears sessions; a durable local journal would be a separate addition.
Do not call an in-memory commit durable storage or imply that an exported session can
already be restored.
