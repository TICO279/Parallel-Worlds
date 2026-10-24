# Parallel Worlds

A local voice-conversation lab powered by Boson Higgs Realtime. Phase 1 includes
Alex's first date and Morgan's mock interview, microphone streaming, server VAD,
interruptions, ordered transcripts, and JSON export.

## Setup and launch

Requirements: **Node.js 24 LTS** and **pnpm 11+**. The lockfile records tested versions.
On this workstation pnpm is bundled with Codex; npm is not on PATH.

```powershell
cd E:\BosonAI\Parallel-Worlds
pnpm install --frozen-lockfile
# Only if .env does not already exist:
Copy-Item .env.example .env
# Manually populate BOSON_API_KEY in .env, then:
pnpm dev
```

Open **http://127.0.0.1:5173/**. Choose a scenario, click **Start conversation**,
then **Enable microphone** and say hello. Allow microphone access in your browser.
The user speaks first. Headphones improve interruption behavior. End the conversation
before reconnecting; every connection starts a new conversation with empty context.

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm start  # after build: frontend and API at http://127.0.0.1:3000/
```

The API binds to `127.0.0.1:3000`; Vite proxies `/api` in development.
After changing `.env`, press **Ctrl+C** in the terminal running `pnpm dev`, then run
`pnpm dev` again and refresh the browser. If running the backend separately, restart
only its terminal with `pnpm dev:server`; the frontend can stay running.
Run commands from the repository root. `start` uses the TypeScript runtime in dev
dependencies, so do not install with `--prod`. The project-local pnpm store and hoisted
linker avoid Windows shared-store symlink restrictions. No database or Docker is needed.

## Architecture

| Location | Responsibility |
| --- | --- |
| `server/orchestrator.ts` | Typed scenarios, identity, prompt construction and completed-turn interface |
| `server/higgs.ts` | Ephemeral credentials and mapping to Boson's session configuration |
| `server/store.ts` | In-memory sessions, validated snapshots, revisions and turn notifications |
| `server/app.ts` | Local HTTP API and production frontend serving |
| `shared/` | Domain types and pure transcript reconciliation |
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
guidance are separate. No appraisal, emotion scores, branching, or rewind is implemented.

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
- Reserved optional branch/fork/state-reference fields support later work without
  implementing branching, replay, rewind or comparative reasoning now.

## Probe and verification

With a populated `.env`:

```powershell
pnpm probe
pnpm probe --scenario morgan-interview --message "What makes a strong project explanation?"
```

The probe mints a credential, waits for a real session acknowledgement, sends a text
turn and requests a text response. It prints event names/timing, resolved model/VAD
and finalized response text, never raw token-bearing payloads. Timeout: 30 seconds.
This tests connectivity and basic character responses, not microphone or speaker audio.

Verified on 2026-10-23: **42 automated tests**, type checking and production build pass.
Tests include an upstream recorded transcript, constructed event races, mocked socket
and audio lifecycle, worklet counting/overflow, microphone cleanup, recording retries
and real local HTTP requests. Browser smoke checks cover selection and missing-key errors.

After a key was supplied, authenticated Boson probes successfully created sessions
and completed text responses for Alex and Morgan. The resolved VAD threshold was 0.85.
**Multi-turn live voice, interruption behavior against Boson, VAD tuning and physical
microphone/speaker behavior remain untested.** Character behavior has only received
this basic text smoke check. Upstream fixtures are not evidence of a new live audio test.
See [docs/experiments.md](docs/experiments.md) for live acceptance and next experiments.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Missing key | Populate root `.env` and restart the backend. Never use a `VITE_` prefix for the key. |
| Rejected/expired credentials | Check key, account access and credit; reconnect for a fresh ephemeral credential. |
| Local server unavailable | Run `pnpm dev` from the root; ensure ports 3000 and 5173 are free. |
| No mic level | Enable the microphone, grant permission and check the OS input device. Use localhost. |
| No playback | Connect via the button to unlock audio; check output volume/device. Unsupported 24 kHz playback is rejected to preserve timing. |
| Self-interruption | Use headphones; echo cancellation is enabled but room conditions still matter. |
| Premature turn ending | Follow the controlled VAD experiment; do not assume tutorial-era defaults. |
| Recording warning | Keep the tab open and restore the server. A backend restart destroys its in-memory sessions. |
| Playback overflow | Keep replies short. Overflow closes the session explicitly instead of silently dropping audio. |
| Timeout/network drop | Reconnect to start fresh; automatic history replay is not implemented. |

Adapted from the [official Boson tutorial](https://github.com/boson-ai/Higgs-Realtime-Tutorial/tree/87f1ae81434d8a65126503ceef36871e0b529f5c).
See [attribution](third-party/NOTICE.md) and the preserved [Apache 2.0 license](third-party/BOSON-LICENSE).
