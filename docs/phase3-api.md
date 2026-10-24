# Phase 3 mobile-web integration

This is the hackathon MVP contract: one original plus one alternative per conversation. The separately developed frontend owns presentation. The server owns branch membership, ordered history, eligibility, checkpoints, active selection, suggestions and scoring. A durable branch can be continued through multiple temporary Higgs sessions.

Source client entry: `client/index.ts`. It exports `Phase3Client`, typed errors/contracts, `HiggsClient`, `SessionRecorder`, replay helpers and the existing pure transcript reducer. It imports no server code. Reference this source entry through a workspace/path alias in the separate Vite frontend; keep the relative `src/audio`, worklet, `src/realtime` and `shared` dependencies together. No published package, new framework, React state library or copied branch logic is required.

## Local connection and ownership

Use the frontend's same-origin `/api` proxy to `http://127.0.0.1:3000`. Supported frontend origins remain localhost/127.0.0.1 on 5173, 5174 and 3000. Do not set an unrelated API origin and expect CORS. Example Vite setting: `server: { proxy: { '/api': 'http://127.0.0.1:3000' } }`.

`GET /api/v1/bootstrap` sets an HttpOnly, SameSite=Strict `pw_device` cookie. Use `credentials: 'include'` (the SDK does). Do not read/copy this cookie into localStorage. The server persists its hashed device identity and scopes every Phase 3 record and linked legacy session to it. Keep the same hostname when switching ports; localhost and 127.0.0.1 have different cookies. IDs alone do not authorize access. A new browser/device cannot claim an old conversation merely by knowing its ID.

This deployment still binds to loopback. A phone cannot use its own 127.0.0.1 to reach a laptop. Actual remote/mobile deployment, HTTPS and account authentication are outside this MVP; don't publicly expose the current localhost service. A mobile-first frontend can integrate locally now using the same-origin proxy.

## Core endpoints

All responses have `Cache-Control: no-store`. New domain responses use `schemaVersion: 1`. Use JSON and an `Idempotency-Key` (8–160 letters/digits/hyphens/underscores/colons) on POST mutations. Preserve the same key when retrying the same mutation; change it for a different operation. The SDK generates keys if omitted, but pass and retain one yourself across transport retries.

| Endpoint | Purpose |
|---|---|
| GET `/api/v1/bootstrap` | Cookie, context qualification, analysis provider |
| POST `/api/v1/conversations` | Create original branch: `{ "scenarioId": "alex-first-date" }` |
| GET `/api/v1/conversations` | Recover owned conversation summaries after reload |
| GET `/api/v1/conversations/:id` | Conversation, active branch/epoch, branch summaries/revisions |
| GET `/api/v1/conversations/:id/branches` | Original and optional alternative |
| GET `/api/v1/branches/:id/timeline?cursor=0` | Up to 80 ordered nodes, server-computed eligibility, next cursor |
| POST `/api/v1/conversations/:id/branches` | Fork before an eligible user answer |
| POST `/api/v1/conversations/:id/restorations` | Prepare a fresh session for an existing durable branch |
| POST `/api/v1/restorations/:id/connection-attempts` | Fresh credential/config/history and fenced session attachment |
| POST `/api/v1/restorations/:id/events` | Confirm ready or failed restoration |
| GET `/api/v1/restorations/:id` | Recover operation status after an uncertain request |
| PUT `/api/v1/sessions/:id/conversation` | Revisioned transcript/playback observations |
| GET `/api/v1/branches/:id/suggestion` | One recommendation, or null |
| POST `/api/v1/branches/:id/suggestion-dismissals` | Remember dismissal |
| POST `/api/v1/conversations/:id/analyses` | `{ "kind": "evaluation" }` or explicit `"suggestion"`; returns 202 job |
| GET `/api/v1/analyses/:id` | Poll status/result without transcript payloads |
| POST `/api/v1/analyses/:id/retries` | One explicit retry of a failed job |
| GET `/api/v1/conversations/:id/export` | Full durable graph, checkpoints, session audit and analysis results |

Existing `/api/scenarios`, `/api/health`, `/api/sessions/:id`, `/api/sessions/:id/adaptation`, application acknowledgements and latency endpoints remain. Linked sessions require the same owner cookie. Legacy conversation PUT cannot bypass the new recording safeguards.

## Create, recover and inspect

```ts
import { Phase3Client } from '@parallel-worlds/client'; // your alias to client/index.ts
const api = new Phase3Client();
const capabilities = await api.bootstrap();
const created = await api.create('alex-first-date', crypto.randomUUID());
let overview = await api.get(created.conversation.id);
const page = await api.timeline(overview.conversation.activeBranchId);
```

Creation returns `{schemaVersion:1, conversation, branch}`. Example compact timeline:

```json
{
  "schemaVersion": 1, "branchId": "original-id", "revision": 7,
  "nodes": [
    {"id":"session-id/item-id","role":"user","text":"I enjoy pottery.","status":"complete","rewindable":true},
    {"id":"session-id/reply-id","role":"assistant","text":"What do you make?","status":"complete","rewindable":false,"reason":"This exchange has not finished with a complete transcript and playback."}
  ],
  "nextCursor": null
}
```

Only user answers can be replaced. Use server `rewindable` and `reason`; do not derive eligibility from text or a browser tree. A user target identifies the answer to remove. Its preceding character question remains in the shared prefix. The first user turn has an empty prefix. Interrupted/unheard assistant text is retained for export but cannot be silently replayed as heard history. Unresolved predecessor gaps, incomplete transcripts and missing checkpoints block exact restoration.

## Fork and connect an existing path

End the current realtime session, flush recording, then fetch fresh revisions. Fork once; retry that mutation with the same key if its response was lost.

```ts
overview = await api.get(created.conversation.id);
const original = overview.branches.find(b => b.id === overview.conversation.rootBranchId)!;
const child = await api.fork(overview.conversation.id, original.id,
  targetUserTurnId, original.revision, forkRequestKey);
overview = await api.get(overview.conversation.id);
const restoration = await api.restore(overview.conversation, child.id, restoreRequestKey);
const boot = await api.connectRestore(restoration.id, connectionAttemptKey);
```

Fork request JSON is `{sourceBranchId,targetUserTurnId,expectedSourceRevision}`. It copies server references to the exact prefix/checkpoint. It never accepts client text, scores or state snapshots. It does not activate the child.

Restore request JSON is `{branchId,expectedConversationRevision,expectedActiveEpoch}`. Bootstrap returns `{session,config,credential,restoration,attachment,history}`. `session.id` and `attachment.sessionId` are temporary application session IDs; `branchId` is durable; the observed Boson session ID is recorded separately. Do not persist `credential` anywhere. An attempt lasts up to 120 seconds. Reuse `/restorations` to resume the same branch later; do not create a new branch just because a socket disconnected.

Never blindly repeat a socket generation after a lost bootstrap. Query the operation; a retry of the same connection-attempt key returns `CONNECTION_RETRY_REQUIRED`. Explicitly replace it using a new attempt key; the prior attachment is fenced out. This creates no extra branch. Server idempotency results contain no credential.

## Reuse the audio adapter

Keep `src/realtime`, `src/audio`, the worklet files and their relative imports. The Vite build bundles the worklets. Start `connect()` from a user gesture to unlock AudioContext, then enable the microphone only after `onState('ready')`. Capture/playback remain 24 kHz mono PCM16; audio flows directly browser↔Boson. The backend never relays or stores audio.

Wire `bootstrap` to the restore/connect sequence above, save its result in a connection-scoped variable, `seed: () => replayEvents(boot.history)`, and:

```ts
confirmReady: async signal => {
  boot.restoration = await api.confirm(boot.restoration, 'ready', readyRequestKey, signal);
}
```

Providing `confirmReady` enables the adapter's strict configuration/history acknowledgement gate. It checks the echoed instructions and every ordered replay item before server activation. It rejects unsolicited setup responses. Backend restoration additionally requires a passing live context report matching the authored scenario hash. These checks are separate: ACKs do not prove semantic recall. Alex has bounded live text/generated-audio qualification; Morgan's Phase 3 restored context is not qualified, while Morgan's existing lab conversation remains available.

For immediate rendering, use `reduceTranscript`/`orderedTurns` per temporary session and ignore `isReplayEcho(event)`. This is provisional display state, not the branch database. Preserve `client.playback_complete`; generation completion alone is not playback completion. Send snapshot/lifecycle observations with the existing serialized recorder:

```ts
const recorder = new SessionRecorder(boot.session.id, showRecordingWarning,
  (url, options) => api.transport(url, options),
  `/api/v1/sessions/${boot.session.id}/conversation`);
```

Call `snapshot(orderedTurns(localTranscript))` on final/done/failed, interruption, playback-complete and close events; patch lifecycle through the recorder. Record Boson's session ID from its session-created event. Keep each recorder bound to its original session; never retarget old callbacks to a new branch. The existing adapter suppresses stale socket generations. Send application/latency observations through the existing session routes if using asynchronous appraisal polling. The original `App.tsx` and small `Phase3Harness.tsx` show the wiring; neither is required by the backend.

On disconnect, call `client.disconnect()`, flush the recorder, and retrieve the server overview/timeline. The server may already have committed an operation whose HTTP response was lost: reconcile rather than assuming failure. Persist only IDs/request keys/UI preferences locally. Unsynced audio/transcripts can still be lost if the browser is terminated while offline; surface recording warnings.

## Suggestions and evaluation

The first suggestion job starts asynchronously after three fully completed exchanges. The latest exchange and opening introduction are excluded from candidate selection. GET the suggestion periodically and display it only at an idle boundary. It contains `id,branchId,revision,targetTurnId,reason,significance,explorationPotential,confidence,evidence,status,tentative`. Scores from .50–.64 can appear as explicitly tentative exploration options; lower confidence remains unavailable. Dismissal is remembered. Suggestions never trigger a rewind or block audio.

Evaluate after the current speech/playback finishes and recording is synchronized:

```ts
let job = await api.analyze(conversationId, 'evaluation', evaluationRequestKey);
// Poll with backoff; do not resubmit the analysis on each render.
job = await api.analysis(job.id);
if (job.status === 'succeeded') renderComparison(job.result);
if (job.status === 'failed') showErrorAndOptionalExplicitRetry(job.error);
```

Statuses are `queued|running|succeeded|failed`. Results freeze exact content revisions. Concurrent/repeated unchanged requests reuse jobs/results; new turns invalidate the input hash. Jobs include provider/model and per-call measured latency/token usage. A process restart leaves an in-flight call explicitly uncertain, with no automatic rebilling. One explicit retry is permitted. New analysis is bounded to 50,000 text characters per path and four queued/running jobs per device.

The comparison returns the stored shared turn IDs, exact replaced fork turn, at most two paths, category anchors/evidence/explanations, overall/coverage/provisional, one grounded insight and `comparisonCaution`. Each path links its branch ID/revision/content hash. No complete transcript or audio is embedded. Render fixed original/alternative lanes; their vertical positions have no emotional meaning. Single-path results remain single-path. No third-branch selection or trend compression exists in this MVP.

Abridged completed-job example (the full response also contains category anchors, exact evidence and telemetry):

```json
{
  "schemaVersion": 1, "id": "analysis-id", "status": "succeeded", "kind": "evaluation",
  "result": {
    "schemaVersion": 1, "rubricVersion": "communication-1",
    "sharedTurnIds": ["source/user1", "source/reply1"], "forkTurnId": "source/user2",
    "paths": [
      {"branchId":"original-id","revision":4,"overall":27,"coverage":0.8,"provisional":true},
      {"branchId":"alternative-id","revision":3,"overall":75,"coverage":0.8,"provisional":true}
    ],
    "insight": "The recorded alternative replaced a demand for private details with a question about sketching.",
    "comparisonCaution": "Provisional assessments from limited evidence. Small differences are not established findings."
  }
}
```

Rubric `communication-1`: clarity .30, curiosity .25, reciprocity .25, boundary respect .20. Stable behavioral anchors map to 0/25/50/75/100 in backend code. Each assessable category needs two distinct user evidence turns and confidence ≥.65; the highest anchor needs three examples. Boundary respect needs two user responses after an explicit character limit. Missing evidence yields null, an `unavailableReason`, renormalized remaining weights and provisional overall. No available category means null overall. Never turn null into zero. Display coverage/caution and avoid ranking tiny or differently covered totals. These are simulated communication assessments, not attraction or human-worth scores.

## Errors and mobile state handling

Errors are `{ "code": "STALE_REVISION", "error": "Refresh the timeline before rewinding." }`; generic legacy errors may lack `code`. SDK `Phase3ApiError` exposes status/code/message.

- `STALE_REVISION`, `STALE_SESSION`, `STALE_ATTEMPT`, `REVISION_REUSED`: stop the stale operation and reload authoritative state. Do not automatically rewrite history or advance a revision to force acceptance.
- `INVALID_FORK`, `INVALID_PREFIX`, `CHECKPOINT_UNAVAILABLE`: show the reason and refresh eligibility; choose an earlier safe moment. A failed appraisal may carry forward the prior saved state explicitly; a missing checkpoint never silently resets it.
- `SESSION_ACTIVE`: finish/disconnect/flush first.
- `RESTORE_UNQUALIFIED`, `PROFILE_CHANGED`: preserve saved history; use the existing working lab or start a new conversation. Do not fake success.
- `CONNECTION_RETRY_REQUIRED`, `RESTORE_EXPIRED`: inspect operation status and explicitly prepare a fresh fenced attempt.
- `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_REQUIRED`: preserve the correct key/payload pair.
- `MVP_BRANCH_LIMIT`: this conversation already has its one alternative.
- `EVIDENCE_INVALID`, `EVALUATION_SUBJECT_INVALID`, `TIMEOUT`, `ANALYSIS_INVALID_OR_UNAVAILABLE`: analysis failed; existing history/audio are intact. No silent mock substitution.
- 404: absent or unowned record. 429: bounded queue busy. Network failure: show disconnected/retry state while retaining request IDs; recover via conversation/operation GET.

Model mobile UI state as idle → connecting/restoring → ready → closing/disconnected. Keep capture disabled throughout restoring, disable duplicate Connect, and keep Evaluate unavailable until a complete boundary. Analysis has its own independent loading state; it must never hold the microphone path. Reconstruct the screen after reload with list → overview → active timeline → suggestion/job status; no authoritative browser tree is needed.
