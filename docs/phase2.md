# Phase 2 — adaptive character state

## Operation and configuration

New page conversations and omitted API modes default to adaptive. Static is retained
only as an explicit API option for scripts and evaluations. Automatic adaptive mode is **asynchronous**:

`finalized user transcript → recorded snapshot → ordered backend appraisal → validated state version → composed instructions → idle-boundary session.update → acknowledged guidance for future responses`.

Automatic mode retains server VAD and interruptions. Appraisal never delays its
response path or sends an extra `response.create`. The client waits until generation
and playback finish and the user is neither speaking nor awaiting an automatic reply
before sending queued guidance. A state may be committed before its guidance is applied.
An update already sent cannot be unsent if new speech begins; no same-turn guarantee
is claimed. The optional development panel distinguishes committed/acknowledged versions.

The [directed typed experiment](agency-implementation.md) is a separate adaptive reply-timing
option. It waits for a saved current-turn acting plan and does not enable synchronous voice control.

The existing `.env` is preserved. Defaults work with the existing Boson key:

```env
APPRAISAL_PROVIDER=mock
APPRAISAL_TIMEOUT_MS=1500
CHARACTER_MAX_STATE_DELTA=0.10
```

Timeout range: 100–30,000 ms. Per-dimension numeric step limit: 0–1. The ±0.10 value is
a starting default, not a permanent rule. Scores always remain in [0,1]. A zero limit
freezes numeric values while still recording interpretation, tone and guidance.
These are fictional simulation controls, not scientific measurements of emotion.

The mock is a deterministic lexical fixture covering disclosures, interests, humor,
disagreement, intentions, boundaries and repair, with profile-dependent rules. It is
not a general language-understanding model. Invalid, failed, stale or timed-out
appraisals retain the previous state and record the failure; there is no silent
substitution of mock emotions after a live provider fails.

### Preferred initial live appraisal: DeepSeek Flash

Mock remains the development default even when live credentials are present. To test
live appraisal, explicitly select DeepSeek in your project `.env`:

```env
APPRAISAL_PROVIDER=deepseek
DEEPSEEK_API_KEY=your-project-key
APPRAISAL_MODEL=deepseek-flash
```

The preferred initial live model is `deepseek-flash` (currently DeepSeek V4.1 Flash).
The adapter posts to `https://api.deepseek.com/chat/completions` using its
OpenAI-compatible request format, `response_format: {type: "json_object"}`, a compact
appraisal shape in the prompt, `max_tokens: 900`, and `thinking: {type: "disabled"}`.
JSON mode does not establish schema validity: every result still passes the existing
strict Zod appraisal schema before any state changes. Empty content, malformed JSON,
unexpected fields/types, incomplete output, API/network failures and cancellation
retain the previous state and record a sanitized failure. No raw provider body is
stored or logged. The existing configurable deadline covers the complete HTTP request
and validation, with late results discarded.

`APPRAISAL_MODEL` overrides the model for the selected provider. Empty/unset selects
`deepseek-flash` for DeepSeek or `gpt-6-luna` for OpenAI. This permits later benchmarks
without changing the provider-independent `AppraisalProvider` interface. Providers
return either a legacy plain appraisal or a validated appraisal with request-local
telemetry; they share no mutable last-request counters. Keys are backend-only and
excluded from session data and exports. Project `.env` values override inherited values.

Restart the backend after editing `.env`: stop `pnpm dev` with Ctrl+C and rerun
`pnpm dev`, or restart just `pnpm dev:server` if running frontend/backend separately.
Start a new session, select Adaptive mode, and inspect the development panel and JSON
export for the provider, model, measured latency and token usage. This does **not**
enable synchronous character adaptation: Boson response gating remains unqualified
and no setting enables that path.

Protocol references: [models](https://api-docs.deepseek.com/quick_start/pricing/),
[JSON output](https://api-docs.deepseek.com/guides/json_mode/),
[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/),
[thinking control](https://api-docs.deepseek.com/guides/thinking_mode/).
The request format was checked against these official docs on 2026-10-23.
**No live DeepSeek call was made: this project's `.env` has no DeepSeek key.**
Model access, live schema adherence, token counts and real latency remain unverified.

### Other providers

Optional OpenAI configuration, using **your own project key**:

```env
APPRAISAL_PROVIDER=openai
APPRAISAL_OPENAI_PROJECT_KEY=true
OPENAI_API_KEY=
APPRAISAL_MODEL=gpt-6-luna
```

Both provider selection and explicit project-key intent are required. An inherited
agent key alone cannot activate OpenAI. Project `.env` values take precedence over
inherited appraisal values, including credentials. The HTTP adapter uses strict JSON
Schema, no hosted tools, `store: false`, and sanitized errors. It was tested with mocked
responses only. **No live OpenAI inference was performed**, and account/model access,
live schema compatibility, price and latency remain unverified. Restart the backend
after changing configuration.

## Live protocol results

Tests ran on **2026-10-23, America/New_York**, using isolated Boson sessions and fictional
inputs. Recorded ISO timestamps are UTC and can show October 24. The main experiment
has a 180-second hard limit; each explicit-steering diagnostic has a 45-second limit.

**Experiment A:** Nine updates across three sessions retained the session ID, audio/
voice settings and a remembered name/hobby. Instructions-only and complete updates
returned matching `session.updated` acknowledgements. This establishes preservation
for the tested fields, not universal merge semantics. Every update supplies a complete
composed instruction string; production updates omit voice/audio fields.

Repeated identical questions produced identical replies within each session, so those
trials did not establish emotional steering. A follow-up with distinct questions and
CALM/BRIGHT/CAUTIOUS diagnostic prefixes produced all three requested markers. Repeating
that follow-up in **audio output mode** produced real audio deltas and all three markers
in the generated spoken transcripts. This verifies instruction steering, not improved
emotional realism. Diagnostic markers are never used in the application prompts.

**Experiment B:** Server VAD accepted `create_response: false`. Artificial appraisal
delays of 1,000 and 2,000 ms produced no premature response and exactly one requested
response. First audio arrived 2,491 ms and 3,982 ms after the server speech-stop
notification; transcription arrived after 320 ms and 247 ms. The 250 ms trial timed
out waiting for `response.done`. Cancellation, interruption and deadline recovery were
not sufficiently qualified within the time box. **Synchronous mode is not shipped**;
there is no environment switch that enables an unqualified response-control path.

Reproduction commands make real, billable Boson requests:

```powershell
pnpm probe:adaptation
pnpm probe:steering
pnpm probe:steering --audio-output
pnpm evaluate:adaptation --live
```

The main runner synthesizes a fictional utterance using the official tutorial's TTS
pattern and sends paced 24 kHz PCM16, exercising real VAD, transcription and generated
audio without recording the user's microphone. The evaluation runner uses the local
HTTP app plus live Higgs text responses and refuses to run unless appraisal is mock.
Neither credentials nor audio payloads are saved.

Evidence: [protocol](phase2-protocol-results.json), [text steering](phase2-steering-results.json),
[audio steering](phase2-audio-steering-results.json), [static/adaptive evaluation](phase2-evaluation-results.json).

## Persistence and interfaces

Exports now include server-owned `adaptation`: immutable states, validated appraisal
output/attempts, application acknowledgements, and measured latency records. Each state
links its previous state and user turn, with session/character IDs, branch `main`,
version, order and timestamp. Transcript revisions are independent and cannot replace
state history. The coordinator exposes lookup by triggering turn for future restoration.
Data remains in backend memory plus manual JSON export; restarting loses it. There
is no database, branch execution, import/restore action, or rewind interface.

| Method / route | Addition |
| --- | --- |
| `POST /api/sessions` | Optional `mode: static | adaptive`; default adaptive |
| `GET /api/sessions/:id/adaptation` | History, prepared instructions, provider and timing mode |
| `POST /api/sessions/:id/appraisals` | Idempotently process an already-recorded finalized `turnId` |
| `POST /api/sessions/:id/adaptation/application` | Record known `version` as acknowledged, deferred or failed |
| `POST /api/sessions/:id/latencies` | Validate and merge measured browser milestones |

Appraisal is serialized per session. Pending transcription prevents later finalized
user turns from overtaking it. Duplicate, stale and cancelled output cannot overwrite
history. Stable identity, goals and boundaries remain separate from dynamic state.
Bounded appraisal context excludes unfinished, failed and interrupted assistant text.

## Latency and evaluation

The browser's monotonic clock records VAD stop notification, final transcription,
response creation, first received audio and actual AudioWorklet playback-start
notification. It estimates speech end by mapping Boson's `audio_end_ms` to the sent
PCM timeline. End-to-end latency starts at that estimate when available, otherwise
at the VAD notification, with a clear label. This is measured application timing;
device output latency and actual human hearing cannot be measured here. Appraisal
latency is recorded independently, rather than inferred from its configured timeout.

Each live appraisal attempt also records the configured `model` and normalized
`usage`: `inputTokens`, `outputTokens`, `totalTokens`, and cache/reasoning counts when
reported. Usage is validated and whitelisted; raw API objects are never exported.
Input includes the schema/prompt, stable character, state and bounded dialogue context.
Output counts come from the API, not a text-length estimate. Known usage is retained
even when returned appraisal JSON is rejected. HTTP failures/timeouts can consume
tokens without returning statistics: missing usage is **unknown**, never zero. The
mock makes no API call and has no token consumption. Per-attempt exports support
later latency/token comparisons; these measurements do not assert equivalent quality.

The live evaluation covers eight event categories and a repair follow-up in each mode.
Static retained state v0; Adaptive committed and acknowledged v1–v9. Each row records
`responseGuidanceVersion` from **before** response creation, separately from the version
committed afterward. An asynchronous update cannot retroactively affect an earlier reply.
`responseAndRecordingMs` includes text response, recording, appraisal and acknowledgement;
it is not a voice-latency number or a controlled benchmark.

For manual review, compare replies blind using the same profile and input sequence.
Score identity consistency, context sensitivity, emotional continuity and naturalness
from 1–5. Note invented shared history, automatic agreement and poor boundary handling.
Repeat runs before conclusions: stochastic differences and the current small fixture
do not establish improved emotional realism.

All **115 automated tests pass**, including the original 42. Type checking and the
production build pass. Tests cover schemas, numeric limits/configuration,
determinism, identity, versions, duplicates, ordering, stale/late results, provider errors,
timeouts/cancellation, explicit key intent, deferred application, exports and latency.
DeepSeek tests mock the exact request/response boundary and cover JSON mode, model
selection, malformed/empty/schema-invalid output, truncation, HTTP 401/429/500,
network failures, aborts/deadlines, concurrent request-local usage, failed-output
usage persistence, credential exclusion, and OpenAI telemetry compatibility.

**Live verified:** Boson configuration/context retention, explicit steering with text
and generated audio, two completed synthetic-audio timing trials, local app → mock
appraisal → immutable history → acknowledged Higgs guidance, and browser Adaptive
connection/debug-panel behavior.

**Mocked:** event interpretation, DeepSeek/OpenAI HTTP responses and token statistics, cancellation/race recovery,
and controlled browser timing assertions.

**Unverified:** physical microphone/speaker conversations in both modes, adaptive
updates during human interruptions, live external appraisal, synchronous reliability,
and improved realism. Run the [manual voice checklist](experiments.md) in both modes
before the demonstration. The failed timing trial is preserved rather than hidden.
