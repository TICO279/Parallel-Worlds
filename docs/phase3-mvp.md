# Phase 3 hackathon MVP

Implemented on `feature/branching-evaluation`. The separately developed mobile-first frontend remains a separate project; this branch provides backend contracts, a reusable source client, and a small `/phase3` test harness. The existing `/` conversation lab, Alex/Morgan, automatic voice, directed typed experiment, variation, transcripts and exports are retained.

## Try it

Use the already running development app at `http://127.0.0.1:5173/phase3`. If stopped, run `pnpm dev` once. Do not start a duplicate copy on occupied ports. Production: `pnpm build`, then `pnpm start`, then `http://127.0.0.1:3000/phase3`.

1. Create a **New demo**, Connect, then Enable microphone. You speak first.
2. Complete at least three short exchanges, including a meaningful answer or disagreement. Suggestions run asynchronously after the third complete exchange. A model may legitimately decline to recommend a moment.
3. End the conversation and wait for recording to synchronize. Preview a server-eligible user answer, then Create alternative. The preceding character question and exact saved checkpoint are retained.
4. Connect the alternative, enable the microphone, and answer differently. End and Evaluate. Two recorded paths appear with coarse communication scores, provisional/coverage flags, evidence and one observed comparison insight.
5. Use the Path selector to inspect/reconnect an existing path. A branch can span multiple temporary Higgs sessions. Export JSON for a full audit.

Interrupted or unfinished history cannot be silently treated as a complete replay. Rewind before such a moment, or use the unchanged existing lab. A missing checkpoint does not reset character state while claiming successful restoration. The demo permits one alternative per conversation; creating another demo preserves the previous conversation in server storage. The harness recovers the latest owned Alex conversation after reload; the API lists all owned conversations.

## Runtime and persistence

Node 24 and pnpm are required. Runtime SQLite is `data/parallel-worlds.sqlite`, ignored by Git. Override the directory with `PARALLEL_WORLDS_DATA_DIR`. Back up that directory with the server stopped. Never commit the database or credentials.

The database persists sessions, branch membership, exact source prefixes, checkpoints and provenance, connection attempts, idempotency receipts, suggestions, immutable evaluation inputs/results and telemetry. Session snapshots and corresponding branch observations commit in one transaction. A restart closes dead socket attachments and marks in-flight analysis uncertain; it does not erase saved dialogue/checkpoints. Queued work may resume, but ambiguous provider calls are not automatically rebilled.

Existing legacy browser trees remain browser-owned. Their backend source sessions now persist when using the normal server entry, but no unverified browser state or historical JSON is imported as a server-owned Phase 3 checkpoint. New Phase 3 branches never depend on localStorage.

Defaults:

```dotenv
PHASE3_ANALYSIS_PROVIDER=
PHASE3_ANALYSIS_MODEL=deepseek-flash
PHASE3_ANALYSIS_TIMEOUT_MS=15000
PARALLEL_WORLDS_DATA_DIR=data
```

Blank analysis provider follows an explicitly configured DeepSeek appraisal provider, otherwise mock. Set `mock` explicitly for deterministic development or `deepseek` with the project `DEEPSEEK_API_KEY` for live analysis. Failed live calls never silently substitute mock. Existing appraisal timeout/state-change settings remain separate. No inherited OpenAI credential is used by Phase 3.

## Restoration gate

Normal voice capture/playback remains in the existing adapter. A new `confirmReady` hook opts into instruction/history acknowledgement gating and backend activation. Replayed user/assistant text is server-prepared. No automatic `response.create` is sent while seeding, and unsolicited generation is rejected. Microphone input stays unavailable until activation.

The server also checks `docs/phase3-restoration-results.json`. A successful semantic report must match the exact authored scenario hash; ACKs alone do not qualify restoration. Current bounded qualification covers Alex, with three text and two generated-audio restoration trials. Morgan's original lab still works, but Morgan Phase 3 restored context remains gated. Changing the profile invalidates the saved qualification. This is textual reconstruction with saved application state, not restoration of Boson's hidden audio/prosody state or deterministic replay of model sampling.

## Analysis and scoring

Suggestions consider an earlier completed answer after a character question, excluding the current exchange and opening introduction. Backend verifies target IDs and exact quoted evidence. One optional annotation is stored per branch; dismissal is remembered. Model confidence .50–.64 is shown as tentative, not a fact about the user or likely outcome. Below .50 stays unavailable.

Evaluation uses stable rubric `communication-1`, five coarse behavioral anchors, exact user evidence, and deterministic weights: clarity 30%, curiosity 25%, reciprocity 25%, boundary respect 20%. Each scored category requires at least two distinct user evidence turns and confidence ≥.65. The highest anchor requires three examples. Boundary respect additionally requires two user responses after an explicit character limit. Unsupported categories are null, not zero; available weights are renormalized and the total is provisional. No available category means no score.

The evaluator cannot score the assistant in place of the human: real quotes from only assistant turns are rejected as `EVALUATION_SUBJECT_INVALID`. Results retain the model anchor, exact evidence, unavailable reasons, content hash/revision, usage and latency. Scores are simulated communication assessments, not attractiveness, compatibility, likability, or human worth. No tiny score-difference significance or causal human-outcome claim is made.

Comparison uses canonical shared IDs and the actual fork, never similar text. The insight quotes the actual alternative choices and subsequent character replies. The fixed SVG lanes are layout only. Compression, semantic phase-label calls, a third branch, account login, public/mobile hosting and a graph editor are deferred.

## Integration and verification

- [API integration guide](phase3-api.md): endpoint paths, payloads, typed client, audio wiring, idempotency, loading/disconnection and recovery.
- [Verification report](phase3-verification.md): automated versus live API and physical microphone evidence, including adverse experiments.
- [Boson report](phase3-restoration-results.json) and [DeepSeek report](phase3-analysis-results.json): sanitized recorded outputs, timings, tokens and historical attempts.

Physical microphone/speaker rewind testing remains a separate manual acceptance task. Use headphones, speak several turns, interrupt once, and verify that unsafe points remain unavailable; then create an eligible alternative and check recall, no post-fork facts, natural continuation and old history preservation. Do not claim this human/device test was completed by the automated probes.
