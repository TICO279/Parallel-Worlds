# Score updates and branch continuity

## What was fixed

- Static mode no longer displays initial numbers as live appraisal scores. It explains
  that Adaptive must be selected before connection.
- Adaptive scores show values out of 100, actual numeric changes, the triggering user
  turn, appraisal pending/failure, and committed versus Boson-acknowledged versions.
  Acknowledgement is not proof of which instructions a generated reply followed.
- Final score synchronization continues after disconnect until pending recording and
  appraisal work settles. Cancelled pollers cannot overwrite a newer session's view.
  Closing a session still cancels pending appraisal; cancellation is shown as a failed
  attempt, not a fabricated score update. Temporary polling errors clear on recovery.
- The selected scenario and branch position determine the displayed checkpoint.
  Historical checkpoints are explicitly labelled previews rather than live scores.
- A pending typed request cannot be double-submitted. Seed replay echoes cannot steal
  the latency attribution for a newly typed message.

## Appraisal deadline

A live DeepSeek diagnostic with fictional input timed out at the existing 1500 ms
deadline. A subsequent validated request took 1456 ms; another took 2334 ms with a
6000 ms deadline. The live browser's first successful appraisal took 1838 ms. These
few samples are not a latency benchmark, but demonstrate why the previous deadline
could leave scores unchanged despite a working connection.

This workstation's project `.env` now sets `APPRAISAL_TIMEOUT_MS=6000`. Credentials
were preserved and remain ignored by Git. The default remains configurable; six
seconds is an initial live-test budget, not a guarantee of provider response time.
Failure retains the previous state and is displayed. Audio remains asynchronous
and is not held waiting for appraisal.

An opt-in diagnostic is available:

```powershell
pnpm probe:appraisal --live
```

It uses the explicitly selected project provider, sends a fictional utterance, and
prints only measured latency, validated deltas and whitelisted usage. It can make
two billable requests: first with the configured deadline, then a 10-second diagnostic
deadline if needed. It never prints credentials or raw provider errors.

## Branch behavior

The browser tree preserves sibling alternatives. A fresh Boson session replays only
the selected path as text, and the backend receives the same complete dialogue for
bounded appraisal context. Replayed history is stored separately from new session
turns: it is not appraised again or double-counted as new evidence.

When an Adaptive conversation continues or forks, the backend locates the last
committed state at or before the selected user turn in the source session. It copies
scores, tone, goal and guidance into version zero of the new session. IDs, version
ordering and future changes belong to the new session. Parent checkpoint references
are exported, and the old branch's state history is unchanged. The frontend cannot
submit arbitrary score values as an authoritative checkpoint.

Only completed dialogue is replayed. Interrupted assistant text can contain words
the user never heard, so it remains inspectable but is excluded from the new session.
Audio, prosody and exact word-level playback are not reconstructed. This is a textual
continuation with a character checkpoint, not a deterministic replay of the original
audio model's internal state.

The UI can select an alternative endpoint with **Use this branch**, preview its saved
scores and start a continuation. Browser storage is schema-validated; cycles, malformed
nodes and missing parents are rejected. Rendering avoids recursive traversal of long
chains. Storage quota/unavailability produces a visible export warning.

## Retention and export

Browser trees and captured score checkpoints live in localStorage for the current
origin. Ports 3000, 5173 and 5174 have separate browser storage; their trees are not
automatically shared. Use port 3000 consistently for normal testing.

The UI's JSON download includes `conversationTree`, `activePathNodeIds` and
`treeExportVersion`, plus the current server export when available. Export still
works for a browser-only tree when the backend session has disappeared, with an
explicit warning. The server export includes replay history and checkpoint provenance.

Authoritative backend sessions remain in memory. After a restart, text history can
still replay from browser storage, but server checkpoint restoration is unavailable:
the bootstrap explicitly reports that scores start from initial values. Browser
checkpoint previews are not silently imported into the authoritative store. No
database, cross-origin migration or JSON-import workflow is added here.

## Verification

152 automated tests pass, including the original 42, with type checking and production
build passing. Added coverage includes closed-session polling, stale callback suppression,
score/status rendering, storage failures, checkpoint selection and isolation, branch
history in appraisal, reset reporting, malformed/cross-scenario references, replay
filtering and HTTP export provenance.

Live API verification includes DeepSeek JSON validation, latency and usage with the
project key. Browser checks exercise Adaptive typed input against Boson and DeepSeek.
In the browser, the original path's trust moved 40 → 43 → 33. Reverting before the
second user turn previewed 43, and the new session restored 43. A different continuation
then reached 45 on its own branch while the original checkpoint stayed at 33. Three
browser appraisals took 1838, 2061 and 1564 ms; all would have exceeded the old budget.
One upstream WebSocket close with code 1012 occurred during branch setup; an explicit
retry connected and completed the alternative turn. This is not evidence of uninterrupted
provider availability.
Physical microphone/speaker testing and synchronous adaptation remain separate and
are not established by these checks.
