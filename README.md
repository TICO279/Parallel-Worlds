# Parallel Worlds

A local voice-conversation lab powered by Boson Higgs Realtime. Phase 1 includes
Alex's first date, microphone streaming, server VAD,
interruptions, ordered transcripts, and JSON export.

**Phase 2:** Every conversation is adaptive: mock or opt-in live appraisal (DeepSeek Flash
preferred), versioned character state,
asynchronous instruction updates and a development panel. The page no longer offers
Static mode; the API still accepts `mode: "static"` for scripts and evaluations. See [Phase 2 configuration, live evidence and limitations](docs/phase2.md).
The [tone and realism baseline](docs/realism-implementation.md) adds grounded appraisal,
mixed reactions, bounded concern memory and saved instruction context. Current validation:
**184 automated tests pass**, including all 42 baseline tests;
type checking and production build pass. Live Boson checks cover instruction updates,
generated audio steering, DeepSeek structured appraisal and static/adaptive text comparisons.
Human voice testing and blinded realism ratings remain pending.

## Setup and launch

Requirements: **Node.js 24 LTS** and **pnpm 11+**. The lockfile records tested versions.
On this workstation pnpm is bundled with Codex; npm is not on PATH.

For everyday testing with one address, run `pnpm build` after code changes, then
`pnpm start` and open **http://127.0.0.1:3000/practice/** (Ember, the dating app, is at `/`). This serves the frontend and API
from one process. If it is already running, use the existing page instead of starting
another copy. Stop your running command with Ctrl+C before restarting it.

The development workflow below uses a separate Vite frontend for automatic updates
while editing source files. Use it instead of the single-server workflow, not alongside it.

```powershell
cd E:\BosonAI\Parallel-Worlds
pnpm install --frozen-lockfile
# Only if .env does not already exist:
Copy-Item .env.example .env
# Manually populate BOSON_API_KEY in .env, then:
pnpm dev
```

Open **http://127.0.0.1:5173/practice/**. Choose a scenario, click **Start conversation**,
then type a message, or **Enable microphone** and say hello. Typing is available while
the microphone is off. Allow microphone access in your browser. The user speaks first. Headphones improve interruption behavior.

**Branching.** After **End conversation**, click one of your own lines (in the transcript or
the tree below it) and choose **Revert to this point**. The conversation returns to just
before that line; the character's previous line stays. **Start new branch** opens a fresh
session, replays the path up to that point as text, and you say something different. The
old branch is kept, and the lower half of the conversation panel shows the whole tree with
each branch point. Only your lines can be reverted: the character's reply follows from
what you said. **Continue conversation** resumes the current path in a fresh session.
Use **Use this branch** at an alternative endpoint to select an existing branch.
Adaptive branches restore the character checkpoint at the selected point while the
source sessions remain in backend memory. The selected dialogue history is supplied
to both Boson and the appraiser. If a checkpoint is unavailable after a backend restart,
the app reports a score reset instead of claiming full restoration.

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm start  # after build: Ember at http://127.0.0.1:3000/, the lab at /practice/
```

The API binds to `127.0.0.1:3000`; Vite proxies `/api` in development.
Vite uses port `5173` and stops with an error if it is occupied instead of silently
moving to another port. To use the supported alternate port, run `pnpm dev:server`
in one terminal and `pnpm dev:web --port 5174` in another. Both `127.0.0.1` and
`localhost` origins are accepted on frontend ports `5173`, `5174`, and production
port `3000`; other origins remain blocked.
Port `3000` serves the last built frontend, while Vite serves the current source.
After pulling frontend changes, run `pnpm build` and refresh to update the interface
served on port `3000`.
After changing `.env`, press **Ctrl+C** in the terminal running the app, then rerun
`pnpm start` for the single-server workflow or `pnpm dev` for development, and refresh
the browser. If running the development backend separately, restart only its terminal
with `pnpm dev:server`; the frontend can stay running.
Run commands from the repository root. `start` uses the TypeScript runtime in dev
dependencies, so do not install with `--prod`. The project-local pnpm store and hoisted
linker avoid Windows shared-store symlink restrictions. No database or Docker is needed.

## Ember: the phone dating app

`dating/` holds Ember, a static mock dating app (from Dating-App-Assistant-Extension), served at
`/`; the lab is at `/practice/`. Ember has three tabs: **Discover** (like or pass; every like is a
match), **Messages** (chats with your matches) and **My profile** (who you are; saved in the
browser). On her profile, the **Parallel Worlds** button (between pass and like) opens
`/practice/?partner=…` and `PhoneDate` starts an adaptive first date with her; **Evaluate** shows
how she feels so far. The server builds her character from her profile and
gives her yours (`shared/partner.ts`, scenario `ember-date:<name>`); outgoing partners speak first
about something on your profile. Every line you say is a breakpoint on the timeline: tap it twice
to rewind to just before it and continue in a fresh session that replays the heard dialogue.
★ marks lines the decision model judged a major shift. The lab lists these dates under
**Met on Ember**, rebuilt from the server's sessions (`GET /api/ember/dates`), and can continue them.

To use it on an iPhone, Safari needs HTTPS for the microphone. Run
`cloudflared tunnel --url http://127.0.0.1:5173` next to `pnpm dev`, open the printed
`https://….trycloudflare.com` address, and Add to Home Screen. The API accepts that origin
only for same-origin HTTPS requests. Anyone with the address can spend your Boson key, so
do not share it, and stop the tunnel when you are done.

## Architecture

| Location | Responsibility |
| --- | --- |
| `server/orchestrator.ts` | Typed scenarios, identity, prompt construction and completed-turn interface |
| `server/higgs.ts` | Ephemeral credentials and mapping to Boson's session configuration |
| `server/store.ts` | In-memory sessions, validated snapshots, revisions and turn notifications |
| `server/adaptation/` | Provider abstraction, mock/opt-in DeepSeek and OpenAI adapters, pure state engine and ordered coordination |
| `shared/characterState.ts` | State/appraisal schemas, version history and latency types |
| `server/app.ts` | Local HTTP API and production frontend serving |
| `shared/` | Domain types, pure transcript reconciliation and the branching conversation tree |
| `src/TreeView.tsx`, `src/treeStorage.ts` | Tree panel; trees persist per scenario in browser storage |
| `src/realtime/` | Socket lifecycle, acknowledgement gating, VAD and interruptions |
| `src/audio/` | AudioWorklets, capture, resampling, PCM16 encoding and counted playback |
| `src/recording.ts` | Serialized, retrying synchronization outside the audio path |
| `src/App.tsx` | React interface; no direct socket or microphone operations |
| `tools/probe.ts` | Real session/text-response diagnostic without audio hardware |
| `test/` | Transcript, scenario, security, lifecycle, audio and HTTP tests |

Audio flows directly between browser and Boson; the local server does not record or
relay it. Configuration uses `higgs-realtime`, `higgs-stt-3.1` transcription, 24 kHz mono
PCM16, bare `server_vad`, and the built-in `default` voice. Profiles change instructions;
both currently use the same voice preset. Character identity and optional mutable
guidance are separate. Adaptive mode adds appraisal and internal simulation scores.
Branching and rewind work on the client: conversation trees replay a text-only path
into a fresh session.

The permanent key stays server-side. Each connection gets a new 600-second ephemeral
credential. Tokens never enter logs, the conversation store, or exports. Upstream
error bodies are sanitized because they can echo request fields. The API rejects
cross-site requests. This is a single-user localhost application, not public hosting.

### HTTP interfaces

| Method / route | Input or result |
| --- | --- |
| `GET /api/health` | Availability and whether a key is configured |
| `GET /api/scenarios` | Predefined scenarios and characters |
| `POST /api/sessions` | `{ scenarioId }` → local session, Higgs config, ephemeral credential |
| `PATCH /api/sessions/:id` | `{ status, bosonSessionId? }` → lifecycle metadata |
| `PUT /api/sessions/:id/conversation` | `{ revision, turns }` → validated snapshot |
| `GET /api/sessions/:id` | Session and ordered turns |
| `GET /api/sessions/:id/export` | Downloadable JSON without credentials |

All API responses use `Cache-Control: no-store`. Older or equal snapshot revisions
cannot overwrite newer records. Snapshots are capped at 2 MB and 2,000 turns; the store
allowlists fields instead of retaining arbitrary protocol payloads.

## Transcript and retention

- Turns are keyed by item ID. Predecessor links repair ordering when items arrive late.
  Final text supersedes deltas; identified duplicate events and late deltas are ignored.
- User speech creates a placeholder. Failed transcription and unfinished turns remain
  explicitly incomplete rather than being presented as successfully finalized text.
- Generation and playback are tracked separately. Interruptions flush local audio,
  suppress late audio for the interrupted item and truncate server history using the
  counted playback position, including after generation has already finished.
- Interrupted replies retain **generated transcript text**, an interruption marker,
  and played milliseconds. Some words may not have been heard. Exact heard-word
  alignment is not claimed; the playback count measures samples sent to the device.
- Sessions live in **backend memory**. Export JSON before restarting the backend.
  Recording retries do not delay audio. Keep the tab open until a recording warning
  clears; abrupt process/tab termination can lose unsynced data.
- The branching tree (`shared/tree.ts`) is separate from per-session transcripts and is
  stored only in this browser, per scenario. Each session's finalized turns hang under the
  node that was current when it started. A new session replays its path as text items
  (`conversation.item.create`): Boson skips audio content, so tone is not replayed, and an
  interrupted, unfinished and failed turns are excluded from replay. Interrupted text
  stays visible for inspection; exact heard-word reconstruction is not supported.
  A live test on 2026-10-23 confirmed that a fresh session seeded this way remembers the
  replayed facts. The UI's JSON export now includes the whole tree, saved score
  checkpoints and active path, alongside the current server session when available.
  It can export the browser tree even after that server session is gone. The server-only
  export endpoint still covers one session plus its selected replay history.

See [score updates, branch behavior and verification](docs/scores-and-branching.md).

## Probe and verification

With a populated `.env`:

```powershell
pnpm probe
```

The probe mints a credential, waits for a real session acknowledgement, sends a text
turn and requests a text response. It prints event names/timing, resolved model/VAD
and finalized response text, never raw token-bearing payloads. Timeout: 30 seconds.
This tests connectivity and basic character responses, not microphone or speaker audio.

Phase 1 verification on 2026-10-23: **42 original automated tests**, type checking and production build passed.
Tests include an upstream recorded transcript, constructed event races, mocked socket
and audio lifecycle, worklet counting/overflow, microphone cleanup, recording retries
and real local HTTP requests. Browser smoke checks cover selection and missing-key errors.

After a key was supplied, authenticated Boson probes successfully created sessions
and completed text responses for Alex. The resolved VAD threshold was 0.85.
Phase 2 adds [live update, synthetic audio, and static/adaptive text evaluation](docs/phase2.md).
Live external appraisal is covered by the [realism verification report](docs/realism-implementation.md).
**Physical microphone/speaker conversations, human interruptions and improved emotional
realism remain unverified.**
See [docs/experiments.md](docs/experiments.md) for live acceptance and next experiments.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Missing key | Populate root `.env` and restart the backend. Never use a `VITE_` prefix for the key. |
| Rejected/expired credentials | Check key, account access and credit; reconnect for a fresh ephemeral credential. |
| Local server unavailable | Run `pnpm start` from the root after building; ensure port 3000 is free. For development, use `pnpm dev` with ports 3000 and 5173 free. |
| Only the local application can use this API | Use localhost or 127.0.0.1 on port 5173, 5174 or 3000; restart the backend after updating it. |
| Interface on port 3000 looks outdated | Run `pnpm build`, then refresh. During development use the Vite URL on port 5173 (or explicitly configured 5174). |
| No mic level | Enable the microphone, grant permission and check the OS input device. Use localhost. |
| No playback | Connect via the button to unlock audio; check output volume/device. Unsupported 24 kHz playback is rejected to preserve timing. |
| Self-interruption | Use headphones; echo cancellation is enabled but room conditions still matter. |
| Premature turn ending | Follow the controlled VAD experiment; do not assume tutorial-era defaults. |
| Recording warning | Keep the tab open and restore the server. A backend restart destroys its in-memory sessions. |
| Playback overflow | Keep replies short. Overflow closes the session explicitly instead of silently dropping audio. |
| Timeout/network drop | Click **Continue conversation**; the new session replays the current path. |

Adapted from the [official Boson tutorial](https://github.com/boson-ai/Higgs-Realtime-Tutorial/tree/87f1ae81434d8a65126503ceef36871e0b529f5c).
See [attribution](third-party/NOTICE.md) and the preserved [Apache 2.0 license](third-party/BOSON-LICENSE).
