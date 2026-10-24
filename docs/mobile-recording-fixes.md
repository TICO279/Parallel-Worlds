# Mobile recording rejection and blocked evaluation

The reported screenshots came from another copy of the app. Its database and
exact rejection code were not available for inspection. Two local reproductions
demonstrated bugs capable of producing this failure, and both now have regression
tests against the original behavior.

## Corrections

- **Close ordering:** a final snapshot arriving during an earlier PUT could be
  sent after the recorder had PATCHed the session closed. The durable API correctly
  refused that write. The recorder now drains the newest pending snapshot before
  sending closed/error lifecycle status, and stops flushing after disposal.
- **Delayed predecessors:** an assistant item can reference a user item whose
  metadata has not arrived. The UI previously sent that unresolved chain to the
  strict API, then treated `INVALID_ORDER` as a terminal rejection. It now retains
  the provisional display locally, waits for the missing predecessor and sends
  the repaired ordering. A restoration's last `pwseed_` item remains a valid first
  predecessor. The server's ordering checks have not been loosened.
- **Rejected-session cleanup:** terminal recording failure disconnected the socket
  without saving closed lifecycle status, leaving the backend attachment active.
  Cleanup now closes both. A failed lifecycle write remains a navigation/setup
  barrier and can be retried. Rejected local observations are replaced on screen
  with authoritative saved turns, and the warning includes the precise safe error
  code. Unsaved words are never presented as successfully recorded history.
- **Evaluation feedback:** preparation shows a loading state while recording and
  appraisal settle. A current failure takes precedence over an old comparison,
  and requesting a new evaluation clears the stale result. An unfinished/unheard
  saved exchange is explained explicitly. Undo no longer claims both paths are
  complete merely because the second branch exists; the menu provides access to
  either saved path independently of a successful comparison.

Backend, SQLite records, shared contracts/reducer, Higgs transport/audio adapter,
scenario hashes, credentials and the analysis rubric are unchanged. This repair
does not invent missing replies, remove incomplete history or mark unheard audio
as played. Existing incomplete paths remain ineligible for exact replay or a
completed-path comparison. History accepted before a rejection stays intact;
speech never accepted by the other server cannot be reconstructed from a screenshot.

## Verification

On 2026-10-24, **322 tests across 28 files**, type checking and production build
passed. The added tests cover the late final snapshot/close race, a missing
predecessor followed by delayed transcription through the real HTTP API/SQLite,
terminal rejection with an offline lifecycle-write retry followed by successful
saved-prefix evaluation/reconnection, and current evaluation errors/loading.

These are automated/synthetic event tests. No new live Boson or DeepSeek calls or
physical microphone tests were used for this repair. The other copy still needs
to run the corrected source before its actual conversation can be checked.

## Update the other copy

Use `feature/iphone-test-access`, which includes the mobile integration, female
Alex portrait, optional private iPhone gateway and these fixes. Main has not been
merged. Check `git status` and preserve any local work before switching; never
reset or overwrite uncommitted changes to get this update.

```powershell
git fetch origin
git switch feature/iphone-test-access
git pull --ff-only origin feature/iphone-test-access
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm start
```

Stop an old app command with Ctrl+C before starting another process on the same
port. Production port 3000 serves the latest build; development port 5173 serves
current source. Keep the existing `.env` and SQLite files. Refresh the browser
after updating, then test a new date with complete replies before rewinding and
evaluating. A warning like `Recording stopped (INVALID_ORDER)` now identifies the
server code to include if the problem recurs; do not share API keys or raw
credential-bearing network payloads.
