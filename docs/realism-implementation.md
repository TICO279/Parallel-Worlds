# Character realism baseline

Implemented on 2026-10-23 from [the tone and realism plan](phase2-realism-plan.md).
This is a testable baseline, not evidence that emotional realism has been solved.

## Behavior and saved context

Alex and Morgan have stable preferences, priorities, sensitivities, competing motives
and disagreement styles. These remain separate from mutable scores and conversational
memory. Initial instructions allow independent preferences, concise statements, neutral
responses and measured disagreement without compulsory reassurance or a follow-up question.

Each successful version-2 appraisal adds a concise interpretation, source quotes and IDs,
uncertainty, mixed reaction, expectations, an alternative interpretation, competing motives,
and an acting brief (intent, stance, concern, expression, move, scope and avoidance).
Private assessment is distinct from outward expression. Uncertainty is a model-reported
judgment: high means least certain; it is not a calibrated probability or user diagnosis.

The provider-independent interface is unchanged. Mock is the development default;
DeepSeek Flash remains the preferred live provider; opt-in OpenAI support is retained.
The production coordinator supplies qualified turn IDs, and live adapters require the
strict version-2 Zod schema. Legacy exports and older custom-provider fixtures remain
readable. Invalid JSON, schema failures, invalid evidence, timeout, cancellation or stale
results retain the previous state and memory and show a failed attempt. A failed live
request never silently becomes a successful mock appraisal.

The appraiser receives the last six complete dialogue items plus the separate saved
state and bounded memory. Memory cites finalized stored turns; assistant sources must
be complete and uninterrupted. The backend checks exact excerpts and known IDs, assigns
note IDs and commits memory and scores under one state version. Self-reported results
remain claims to examine, not independently verified accomplishments.

Memory defaults to eight notes of at most 160 characters. Resolved notes count toward
capacity and are evicted first, then older low-priority notes; active boundary-pressure
concerns are protected. Each state records actual eviction IDs. Adding the same note
can update its evidence rather than duplicating it. Full transcripts and earlier state
snapshots remain available after active memory is compacted.

Deterministic policy allows zero and mixed score changes. Positive trust requires a
behavioral event, sufficient certainty and no unresolved boundary pressure. Claims,
compliments, disclosures and apologies do not automatically raise trust. Repeating
identical wording cannot compound positive deltas. An apology can ease discomfort
without repairing trust. The initial repair heuristic requires two distinct, grounded
respectful continuations before a pressure concern can be resolved; promises alone do
not count. This is a transparent baseline heuristic, not a scientific theory of trust.
The numeric step limit remains configurable.

Every compiled instruction snapshot records its exact text, SHA-256 hash, state version,
triggering turn, timestamp and compiler version. State snapshots retain appraisal schema,
profile and compiler versions, evidence, memory and brief. Application records distinguish
dispatch, acknowledgement, deferral and failure; reply timing records the version
acknowledged before response creation and flags overlapping updates as uncertain.

Automatic Boson replies can begin before transcription and appraisal finish. Therefore
the running application sends persistent concerns, provisional perspective and expression
guidance for future replies. It saves turn-specific intent/move suggestions for inspection
and leaves them out of automatic instructions; it does not issue a belated command to
acknowledge an old apology. Pending client suggestions also expire on a new speech/text
turn, even while transcription is pending. No new response.create or synchronous switch
was introduced. Acknowledgement proves receipt, not semantic compliance or same-turn use.
The separate strict-context/gating experiment remains disabled and unqualified.

Storage is still backend memory plus manual JSON export. The export includes appraisal,
memory, exact instruction history, application/timing records and branch metadata without
credentials. A backend restart clears sessions. The browser tree can retain previews,
but it is not a durable backend journal or an import workflow. Validated branches restore
the selected checkpoint and only memory grounded in that path; future branch evidence
cannot leak into the new branch. Missing source checkpoints explicitly report a reset.

## Configuration

Existing `.env` keys are preserved. Relevant fields in `.env.example`:

```dotenv
APPRAISAL_PROVIDER=mock
APPRAISAL_MODEL=
APPRAISAL_TIMEOUT_MS=1500
CHARACTER_MAX_STATE_DELTA=0.10
CHARACTER_MEMORY_CAPACITY=8
CHARACTER_MEMORY_TEXT_LIMIT=160
APPRAISAL_MAX_OUTPUT_TOKENS=1600
DEEPSEEK_API_KEY=
```

For the project's live tests, provider is `deepseek`, model is `deepseek-flash` and the
existing timeout is 6000 ms. The code does not silently expand that deadline. Memory
capacity accepts integers 1–32, note length 40–160 and output budget 600–4000 tokens.
Keep keys server-side; never use a VITE_ key. The inherited OpenAI key is not selected
without the existing explicit project opt-in. Restart the backend after `.env` changes.

## Verification

Automated: **184 tests pass**, plus `pnpm typecheck` and `pnpm build`. Coverage includes
all 42 original baseline tests, 12 multi-turn realism sequences split evenly between
the characters, grounded evidence, unchanged/mixed scores, repeated phrases, concerns
beyond six messages, gradual repair, bounded eviction, atomic failure, branch isolation,
schema/provider failures, suggestion expiry and overlapping guidance attribution. Existing
audio interruption, cleanup, recording and score tests remain in the suite.

Live API: fictional text conversations use Boson replies and project-configured DeepSeek
appraisal. The unchanged [historical baseline](realism-baseline-results.json) contains
10 replies and five appraisals. The [first revised run](realism-revised-results.json)
completed 10 replies, but one of five appraisals failed schema validation; previous state
was retained. A bounded reproduction observed an invalid memory category. The prompt now
explicitly separates event values from the allowed memory categories. Strict validation
remains in place rather than coercing an unknown category.

The [confirmation run](realism-confirmation-results.json) completed 10 replies with five
of five committed appraisals and no timeout. These are small, stochastic samples:

| Measurement | Historical baseline | Revised confirmation |
| --- | ---: | ---: |
| Appraisal attempts / failures | 5 / 0 | 5 / 0 |
| Appraisal p50 / p95 (nearest rank) | 1905 / 2199 ms | 3910 / 4778 ms |
| Input / output tokens, all attempts | 3062 / 648 | 11104 / 2741 |
| Missing usage records | 0 | 0 |
| Context commit → acknowledgement p50 / p95 | Not captured | 146 / 301 ms |

The acknowledgement lag is measured by the controlled text runner, which waits between
turns; it is not normal browser polling/idle-boundary latency. Richer appraisal costs
more tokens and time. Across both revised trials, nine of ten appraisals committed and
one was rejected; the confirmation result does not erase the first failure.

Observed boundary trajectory: the old adaptive Alex changed trust 40→30→25→35 and became
warm immediately after the first topic change. Revised confirmation changed 40→30→25→25,
retained the concern and recorded one step of repair. Revised Morgan distinguished a
general claim from concrete self-reported results. These are observations, not a quality
score. Unsupported praise still appeared in a revised static reply ("That's a strong
start" to an unsupported claim), and model style can still overuse questions. Do not
claim these issues are eliminated.

Browser: the production interface was exercised with typed Morgan turns, generated audio,
live DeepSeek appraisal, version acknowledgement and the expanded interpretation/memory
panel. This verifies the integration path, not physical speaker fidelity. Human microphone,
speaker, barge-in/reconnect acceptance and blinded realism ratings remain **unverified**.
No new gating qualification was claimed or attempted as part of this baseline.

## Repeat and review

Run the app first, then opt into billable text trials:

```powershell
pnpm evaluate:realism --live --smoke --label my-trial
# Omit --smoke for all 12 sequences; the runner has a fixed time box.
pnpm review:realism baseline revised-confirmation
```

Reports are written to ignored `captures/`. Copy the historical baseline report from
`docs/` into that directory when reviewing a fresh checkout. The review command shuffles
anonymized conversations into `captures/realism-review-blinded.md`, keeps the assignment
key separate and produces a latency/token summary. The packet asks a human to rate
identity, grounded reaction, continuity, proportionate warmth, independence and naturalness,
and to flag critical praise/history/forgiveness/hostility/questioning failures individually.
The tool does not assign its own realism score. Repeat selected sequences and perform
physical voice sessions before asserting a behavioral improvement.
