# Mobile frontend integration

Implemented on `feature/mobile-frontend-integration`, starting from Phase 3 main
`eb5c2abf3eb6dc2f9014f55467a5b5423e85649c`. The preferred frontend was located at
the exact remote reference `origin/main2`, commit
`3781fed7213e8042c77f90ee61e7f8ca95a55813`. This is a selective frontend port;
the source branch is not merged. Main and the source reference remain unchanged.

## Imported presentation and preserved backend

The mobile entry uses the source's Ember discovery/profile layout, dark Parallel
Worlds conversation layout, flame/rings SVG paths, styling, manifest and eight
photo assets. Only Alex is displayed. The photos are preserved byte-for-byte;
`src/mobile/provenance.json` records their SHA-256 hashes and source paths.
Public profile text comes from the existing server's Alex scenario. The source
branch's user biography, other dating characters and invented profile details
are not presented as Alex's identity.

No source backend, dynamic profile builder, competing audio/TTS/VAD implementation,
environment configuration or package dependencies were imported. The existing
`server/`, `shared/`, `client/`, `src/realtime/`, `src/audio/`, `src/recording.ts`,
`.env.example`, Vite configuration and package/lock files are unchanged from main.
This preserves Higgs Realtime, DeepSeek appraisal, SQLite, revision/idempotency
checks, qualification gates, branch isolation, suggestions and evaluation.

The new files are presentation (`views.tsx`, `mobile.css`), route glue
(`MobileApp.tsx`, `navigation.ts`), and UI orchestration
(`controller.ts`, `useMobileConversation.ts`, `types.ts`). The original labs remain
available; their business logic was not copied into the mobile UI.

## Run and navigate

Use the existing `.env` and commands. No new environment variables are required.

```powershell
pnpm dev
# Open http://127.0.0.1:5173/

# Or serve the built frontend and API from one process:
pnpm build
pnpm start
# Open http://127.0.0.1:3000/
```

Use one launch workflow at a time. If a server is already running, reuse it.
After rebuilding, refresh port 3000 to receive the updated frontend.

| Route | Screen |
| --- | --- |
| `/` | Ember discovery, Alex and server-owned saved dates |
| `/profile/alex` | Alex's profile and Parallel Worlds entry |
| `/worlds/:conversationId` | Saved date, active timeline, voice and comparison sheets |
| `/lab` or `/?lab` | Existing conversation lab, including Morgan |
| `/phase3` | Existing backend test harness |

Deep links fetch owned server state. Unknown or malformed links never create a
replacement conversation. Ownership uses the existing HttpOnly device cookie;
use the same hostname to recover dates. There is no authoritative browser tree
or localStorage history in the new frontend.

## Real API wiring

The reusable contract and examples remain in [phase3-api.md](phase3-api.md), with
the TypeScript entry at `client/index.ts`. The mobile controller uses that client:

1. Bootstrap ownership/capabilities, load `/api/scenarios` and health, then list
   owned conversations. Profile selection is limited to `alex-first-date`.
2. Create a conversation with a retained idempotency key, or GET an existing
   overview and its paginated active timeline. The server supplies branch IDs,
   revision numbers, rewind eligibility, checkpoints and completed turns.
3. On a microphone gesture, prepare a restoration and fresh connection attempt.
   Reuse `HiggsClient`, replay the server prefix, wait for configuration/history
   acknowledgement and server confirmation, then enable capture. The user speaks
   first; the UI does not inject a greeting or unsolicited response.
4. Use the existing transcript reducer for immediate display and `SessionRecorder`
   for serialized observations. A recorder stays bound to one temporary session.
   Completed/playback/interruption events synchronize independently of audio.
5. Poll asynchronous appraisal guidance, the active branch suggestion and any
   evaluation job. Forward instruction updates and application/latency receipts
   through the existing adapter and API. This does not add synchronous gating.
6. A suggestion marker or Undo opens a rewind preview showing the preceding
   character question and the answer being replaced. At a completed boundary,
   pause capture, await recording/appraisal, disconnect, refresh eligibility and
   fork before that server turn. The alternative opens paused; a new microphone
   gesture restores it. The original is retained. There is at most one alternative.
7. Evaluate waits for a completed boundary and synchronized recording, then requests
   a server evaluation and polls its job. The sheet displays at most two recorded
   paths, evidence, coverage and provisional/null scores. It invents no trajectory
   or successful comparison when a job fails or evidence is missing.

Mutation keys survive transport failures for the current UI operation. If a fork
commits but its response is lost, a refresh recognizes the matching server child
instead of creating another one. Returning to an existing branch reuses it; a
disconnection alone does not create a branch. Unsynchronized records block path
switching rather than being silently discarded. Reload reconstructs the view from
the API; abrupt browser termination can still lose unsubmitted observations.

## Mobile states and errors

Connecting/restoring disables capture until readiness. The microphone can cancel
pending setup, pause capture, or reconnect from saved context. Back navigation ends
and synchronizes the connection first. Stale callbacks are scoped to their original
temporary session. Recording failures and action errors remain visible together.

Rewind and Evaluate are unavailable during speech generation/playback or unfinished
transcription. Server eligibility reasons remain visible in the timeline. A second
alternative is blocked. Suggestions are shown only when active, attached to the
displayed branch/turn and at an idle boundary; tentative suggestions are labeled.
Evaluation failure has an explicit retry, and insufficient evidence remains null.

This remains the loopback-only deployment documented in the API guide. Responsive
layout emulation does not verify a physical phone. HTTPS/network access and mobile
OS microphone policies need a separate deployment/device check. Do not expose the
current local service to the public network to work around this limitation.

## Verification on 2026-10-24

| Check | Result and scope |
| --- | --- |
| Complete automated suite | **309 passed, 27 files**; all 266 existing tests retained |
| Type checking | `pnpm typecheck` passed |
| Production build | `pnpm build` passed |
| Focused frontend tests | Controller lifecycle/cancellation/stale callbacks, recording barriers, retained mutation keys/lost-fork recovery, route recovery, asset hashes, rendered controls/suggestion boundaries/two-path evidence and error states |
| Complete journey with real local API | New controller + real SDK/HTTP/SQLite/reducer/recorder: create, record three exchanges, asynchronous suggestion, rewind, exact prefix restoration, alternative exchanges, two-path evaluation and reload recovery; voice events, Boson credentials/qualification and appraisal are deterministic fixtures/mocks |
| Browser layout/navigation | Discovery → Alex profile → new date; saved-date resume and full reload; 375×812 and 320×568 layouts inspected |
| Production HTTP | Root, profile, saved-date deep link and both labs return the built SPA; all eight images return matching bytes; manifest served |
| Live Boson in this integration | Real credential/configuration/replay setup reached connected ready, with no unsolicited response before user speech |
| DeepSeek in this integration | Preserved unchanged; failure/structured responses covered by existing automated tests. No fresh live DeepSeek call was used to validate this UI. Earlier live evidence remains in the Phase 3 report |
| Physical microphone/speaker | Capture attempt failed in the in-app browser: “Microphone could not start. Allow microphone access and check your input device.” No spoken turns, audible reply, physical-device rewind or interruption acceptance is claimed |
| Protected code and credentials | Backend/shared/client/audio/config unchanged; project credential values absent from changed files; `.env` and runtime data remain ignored |

Screenshots were saved as `mobile-profile-320.png` and
`mobile-conversation-375.png` in the task's local visualization artifacts. They show
the actual profile and paused conversation, not a simulated successful voice call.

Before approving a main merge, manually validate with an available microphone:
Alex profile → Parallel Worlds → several spoken exchanges → a saved timeline
suggestion → rewind preview → alternative speech → Evaluate → two-path comparison.
Also verify interruption during generation/queued playback, disconnect/reconnect,
and an actual target phone's safe areas/audio permissions. Earlier live semantic
context qualification remains required; acknowledgements alone do not prove recall.

The integration is committed on its dedicated feature branch only. Main has not
been merged, nothing has been pushed, and no branches have been deleted.
