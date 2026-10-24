# Live acceptance and next experiments

## Baseline acceptance

Authenticated connectivity and basic text-response probes passed for Alex and Morgan
on 2026-10-23 after a local key was supplied. The acknowledged server VAD threshold
was 0.85. Voice, live interruptions, and the remaining acceptance checks are pending.

Run in sequence. Record date, browser/device, pass/fail, and sanitized event names
and timings. Never capture tokens, handshake subprotocols or raw credential responses.

1. **Connectivity:** `pnpm probe` receives `session.created`, produces a completed text
   response and closes. Compare the acknowledged model/VAD to requested configuration.
2. **Profiles:** Test both scenario IDs. Ask Alex about a first-date preference and
   Morgan about interview expectations. Check distinct behavior, continuity and
   independent opinions. Treat this as qualitative, not deterministic wording.
3. **Voice:** Have at least five spoken exchanges. State a name or preference and ask
   about it later. Check response timing, output, input transcription and mic status.
4. **Interruptions:** Request a long answer. Interrupt during generation and again
   while already-generated audio is playing. Verify prompt silence, no resumed old
   audio, sticky interruption status, and plausible playedMs. Ask what was last said
   to check server context. Also interrupt before the first audio chunk and end a
   session during playback.
5. **Recording/lifecycle:** Compare JSON export to visible IDs, timestamps, ordering,
   text finality and interruption metadata. Reconnect and verify a new empty context.
   Deny mic permission, disconnect during pending permission/setup, and verify the OS
   microphone indicator stops. Test another browser/device before claiming compatibility.

Keep physical audio and authenticated API results separate from mocked test results.

## API uncertainties

- The tutorial's August 2026 VAD threshold default is 0.55; current documentation lists
  0.85. Begin with `{ type: "server_vad" }`, inspect resolved values and test quiet
  speech, pauses and noise before explicitly tuning supported parameters.
- Confirm truncation acknowledgements during cancellation, after generation, and at
  zero played milliseconds. The baseline follows the tutorial's local flush plus
  explicit `conversation.item.truncate`; acknowledgement alone does not establish
  exact heard-word transcript alignment.
- Verify acknowledgement sequencing, transcription model availability, session limits
  and expired-key behavior against the account used for the demo.
- No word-level transcript timing guarantee has been established here.

## Next: character-state update timing

Use a separate diagnostic session, outside the demo audio path. Keep stable identity
and voice fixed. Change only brief guidance such as “Be more reserved in the next
reply,” using documented `session.update`. Correlate its `event_id` with acknowledgements
or errors. Record monotonic receipt times for:

`speech_stopped → user transcription completed → update sent → session.updated → response.created → first audio delta → response.done → playback drained`.

Repeat three cases: update while idle between turns; update after a user turn but before
the next response if that window exists; update during generation. Use contrasting
instructions and observe which response changes, whether audio is interrupted, and
whether configuration is rejected or the connection closes.

Acknowledgement confirms acceptance, **not when behavior takes effect**. If auto VAD
starts the response before appraisal could finish, do not race an external LLM against
it. Separately evaluate documented manual turn control (`turn_detection: null`, input
commit, explicit response creation) and its latency cost, or apply guidance only at a
later safe response boundary. Only then connect a completed-turn appraisal subscriber
to qualitative state snapshots and the context builder.

## Following: rewind feasibility

Open a new session and replay a short finalized conversation using documented text
items. Compare character consistency and factual memory; handle interrupted turns
without assuming unheard generated text was spoken. Then change one user response
and compare manually. Evaluate lost prosody and server-side summarization effects.
Do not assume an existing socket can rewind or audio history can be restored. Add
branching only after replay behavior is established experimentally.

References: [tutorial](https://github.com/boson-ai/Higgs-Realtime-Tutorial),
[sessions](https://docs.boson.ai/models/higgs-realtime/guides/connections-and-sessions),
[VAD](https://docs.boson.ai/models/higgs-realtime/guides/turn-detection-and-interruptions),
[client events](https://docs.boson.ai/api-reference/realtime/client-events).
