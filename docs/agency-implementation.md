# Independent behavior and variation prototype

Implemented locally on 2026-10-24 from the [agency plan](phase2-agency-and-variation-plan.md).
This iteration preserves the Phase 1 audio path and the realism baseline, and makes the
acting contract testable before expanding to strict voice control.

## Try it

Run the app and refresh the page. All page conversations use adaptive state. Before
connecting, choose **Reply timing**:

- **Automatic · voice and text:** stronger independent profiles, evidence-based appraisal, saved
  policy decisions and asynchronous guidance for future voice or typed replies.
- **Directed · typed experiment:** microphone disabled. Record the current typed turn,
  appraise it, save a decision and exact response intent, acknowledge its complete session
  instructions, then explicitly request one correlated reply. Expect several seconds of
  latency. This is an experimental way to inspect current-turn behavior, not qualified
  synchronous voice control.

Static remains available through explicit `mode: "static"` API requests for baselines
and scripts; it is no longer offered on the page. Omitted API mode defaults to adaptive.

The upstream `v2.1` version and always-visible **Start over** control are preserved.
Start over requires a second click and cancels confirmation when the scenario changes.
It disconnects before resetting local dialogue, seed/checkpoint pointers and visible scores;
previous JSON exports and backend inspection records are not deleted by this browser reset.

**Behavior variation** chooses the project setting, steady policy (0), subtle (.35) or
more (.7). Different seeds may choose different suitable actions. Neither words nor
provider inference are deterministic. A seed reproduces the application's disposition
and policy draws, not Boson's or DeepSeek's token sampling.

Alex can keep a different preference, decline pressure or acknowledge an ordinary remark
briefly. Morgan can withhold an assessment, name missing ownership and challenge another
vague answer without praising it. Both still allow earned interest and credit. Authored
examples illustrate behavior; they are not a fixed conversation script.

## What changed

`realism-2` profiles separate directness, initiative, positive expressiveness and investment.
Stable rules permit low interest, disagreement and concise statements without compulsory
questions. Delivery guidance asks for level, restrained speech. Small session variation
is translated into a working manner; values, tastes, standards and scenario facts remain fixed.

The pure `agency-1` policy selects from acknowledge, answer, disagree, probe, challenge,
boundary and credit. It filters eligibility before scoring, limits random selection to
actions within .75 of the best utility, and uses centered softmax weights. Zero variation
uses stable tie-breaking. Keyed SHA-256 draws have separate namespaces for disposition
and action, using a saved seed and logical decision ordinal. Polls, retries and exports
do not reroll decisions.

The first authored preference conflict recognizes Alex's quiet-place preference against
an explicit statement of liking clubs. This is deliberately narrow, not general semantic
understanding of all preferences. Other nuance remains the actor/appraiser's responsibility.
There is no new generic belief or commitment database; stable preferences and the existing
evidence-linked memory remain authoritative. General topic-specific commitments and a
broader action vocabulary are follow-up work after human calibration.

Investment can fall after consecutive weak claim events and recover on reciprocity or
respectful continuation. A first weak answer, nervousness or neutral small talk does not
consume it. This is a baseline heuristic, not a measure of the user's character or an
automatic reason to close a connection. Repeated-pressure detection keeps a boundary
active when an apology still asks for the same private disclosure.

Automatic updates compile continuing disposition, concerns and perspective. They do not
dispatch the policy's turn-specific action against a later utterance. Directed mode
compiles that action into a current response contract with an endorsement constraint,
sentence/question budget and delivery instruction.

## Compact appraisal transport

Initial live trials exposed repeated vocabulary errors in rich version-2 model output:
appraisal `brief.move` differs from backend action names, and memory categories differ
from event names. The appraiser now receives character assessment/memory without the
downstream behavior candidates or draw history.

Production requests use the strict `evidence-v1` wire schema. The model supplies bounded
assessment fields, deltas, stance and one optional observation (`memoryText` may be empty).
Backend code assigns source citations, memory IDs/categories, permitted repair-resolution
references, acting move and schema versions. Both the wire response and expanded
version-2 appraisal are validated with Zod before the existing grounded transition.
Unsupported fields or enums are rejected, not silently coerced.

The attached citation identifies the current finalized turn using its first 160 characters;
it is not a model-selected explanation of which words prove its interpretation. Full
trigger text remains in the transcript. Semantic grounding still requires review.
Memory-resolution proposals remain subject to the existing sustained-repair guard.

Legacy fully valid version-2 provider responses and custom/mock providers remain supported;
the actual wire profile is recorded in attempt telemetry. DeepSeek uses JSON output mode;
OpenAI retains its structured-output adapter. The AppraisalProvider method signature is
unchanged, with an additive output-profile hint. There is no second live critic or silent
mock substitution after a failed live request.

## Directed response lifecycle and failure handling

The typed client supplies an item ID, sends the user message once and waits for its echo.
Recording must synchronize before the backend prepares a fresh plan for the latest user
turn. A failed appraisal leaves state unchanged and cannot authorize a fresh reply.
Plans are idempotent while prepared, expire after 30 seconds and cannot be re-prepared
after dispatch. The server rejects superseded turns and invalid lifecycle transitions.

Client sequence: complete session.update → matching ACK → persisted authorization →
one response.create carrying intent ID and context hash → matching response.created →
playback → completion/drain → persistent-guidance update → matching restoration ACK.
The user input remains unavailable during this controlled sequence. The experiment
does not accept microphone turns; normal automatic adaptive voice and interruption behavior
remain available in their own sessions.

Uncorrelated responses/audio are blocked before playback; duplicate creation events do
not reauthorize a reply. Disconnect cancels setup and ignores late results. Missing or
ambiguous creation is recorded as uncertain and closes the session; no blind generation
retry is performed. Failed generation is recorded as failed rather than completed.
Audit-write failures are visible. Session context is restored before another typed turn.

The application saves what it supplied and correlated; this does not prove semantic
compliance by the actor. The client-enforced one-request rule is not a provider exactly-once
guarantee. Reconnect creates a new session as before.

## Saved context and branches

Each state checkpoint includes disposition, seed, variation, investment, action history,
logical random position and the selected decision with candidate scores/reasons. Session
exports add exact response plans/instructions/hashes and timestamped lifecycle events.
Provider usage, latency, wire profile and sanitized validation paths are retained.
Invalid raw provider values and credentials are not retained in validation diagnostics.

Adaptive/Directed branches restore their selected checkpoint, including its root seed
and random position, without later branch draws. A new session ID does not reroll a
restored decision stream. An explicit variation choice changes future policy sampling;
the saved disposition and past decisions stay fixed. Static replay retains dialogue and
identity but has no appraised checkpoint to restore; it starts a new disposition.

Storage remains backend memory plus manual export. A browser checkpoint preview is not
a durable journal or a server-session import. Backend restart still clears sessions;
unavailable checkpoints explicitly report a reset. Export before restarting if the full
response audit matters.

## Configuration

```dotenv
# Empty: 0 for mock, 0.35 for an explicitly configured live appraisal provider.
CHARACTER_BEHAVIOR_VARIATION=
# Optional reproducible experiment seed, exported with the session. Never an API key.
CHARACTER_BEHAVIOR_SEED=
```

Existing timeout, numeric delta and output-token limits remain configurable. The project's
6000 ms live deadline and credentials were preserved. Mock is still the development
default; it uses zero policy variation unless explicitly overridden. OpenAI keys retain
the explicit project opt-in. No new dependency or database was introduced.

## Verification and experiments

Automated after upstream integration: **228 tests pass**, with typecheck and production build. Added checks cover
seed reproducibility and eligibility, no random evidence/score mutation, pressure and
neutral behavior, consecutive claims, current-turn intent authorization, exact hashes,
duplicate events, cancellation, uncertain sends, failed generation, persistent-context
restoration, export redaction, branch random-position restoration, and strict compact
wire parsing across mocked DeepSeek/OpenAI adapters. All 42 original baseline tests remain.
Integration checks also cover adaptive-by-default sessions, retained static API baselines,
the reply-timing controls, version/reset visibility and secret-safe runtime logging.

Live protocol finding: a 32-response comparison using response.instructions returned
matching metadata but its 16 contract responses largely restarted with greetings rather
than answering the supplied turn. This path is not shipped. Repeating the comparison
through session.instructions produced relevant contract responses across all eight
fictional probes, twice each. That is agent inspection, not blinded human realism grading.
Four isolated generated-audio trials also returned audio and matching metadata.

The four-arm, two-seed pilot planned 96 text replies and completed 88. Six conversations
stopped on invalid appraisals; skipped later turns were not retried. It demonstrated
different eligible actions under variation, but does not establish that variation improved
realism. Earlier smoke/confirmation failures remain in local captures. Compact transport
was introduced afterward to remove the observed enum/ID collision surfaces.

Current-run counts and latency/token summaries are recorded in
[the verification summary](agency-verification-results.json). Do not combine revisions
into one success rate or erase the earlier failures. Structured validity, metadata echo
and naturalness are separate measures.

Final compact-wire confirmation: **12 replies, 12 committed appraisals, zero rejected
appraisals**, p50 **2982 ms** and p95 **3909 ms** appraisal latency. This is a small
two-scenario text sample, not a reliable estimate of all future failure rates. The
earlier pilot used the richer wire format and had six rejected appraisals out of 46;
its results do not establish a performance rate for the final compact format. No new
large pilot was run simply to obtain a favorable aggregate.

Different policy actions can still produce the same wording: one final Morgan pair
selected acknowledge versus challenge, but both said the answer still did not identify
the user's own decision. Seeded action diversity therefore does not establish language
diversity or better realism. This remains a human-review question.

Browser testing exercised two consecutive directed Morgan turns with generated speech,
appraisal, acknowledgement, recorded completion and restored input. No unearned praise
appeared in those two replies. This is a small observed sample, not proof that all
agreement/optimism issues are eliminated.

A final browser check through the compact wire path also kept Alex's quieter-place
preference against assumed shared enthusiasm for clubs, then answered ordinary bus
small talk with a brief statement and no question. Both turns completed and restored
the input; the test session was ended with its state retained.

**Not qualified:** synchronous voice gating, physical microphone/speaker/barge-in behavior
for this iteration, blinded human preference/naturalness scores, the proposed held-out
576-response expansion, a general topic-commitment system, and automatic conversational
ending. Those remain separate experiments rather than advertised guarantees.

## Reproduce and review

```powershell
pnpm evaluate:acting --live
# Diagnostic reproduction of the unsuitable override transport:
pnpm evaluate:acting --live --response-override
pnpm evaluate:acting --live --smoke --audio-output
pnpm evaluate:directed --live
pnpm evaluate:directed --live --pilot
pnpm review:agency captures/directed-pilot-1792852763883.json
```

Live commands are billable. They use fictional inputs, isolated sessions and no audio
recording. Captures stay in ignored `captures/`; review packets hide arm/seed labels and
keep their assignment key separate. The review tool supplies no automated realism score.
Run the smaller checks first; do not expand bulk trials until the observed failures and
human ratings justify it.
