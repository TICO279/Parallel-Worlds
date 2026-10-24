# Mobile dating practice review

Branch: mobile-dating-review, based on origin/main2 (3781fed).

Open Ember at http://127.0.0.1:3000/, select a profile, then Parallel Worlds.
Have an exchange, choose Evaluate, Pause conversation, then Review my practice.
DeepSeek returns a supported strength and up to three suggestions for the active path.
Each quote and user node ID is validated before display. Partner context must match
that date. Existing character feelings remain under an expandable section.

View turn closes the sheet, restores the reviewed path, scrolls to its timeline
point and pulses its caption. Try again starts a fresh session with only the
root-to-parent path before that user turn. Original nodes remain saved. Replayed
items must be acknowledged in order before mic or typed input is enabled.
Feedback changes neither the live response prompt nor TTS styling.

No new credentials are needed if DEEPSEEK_API_KEY and BOSON_API_KEY are set locally.
No dummy feedback, audio, or secret files are added. Reviews are kept in memory;
refresh preserves conversation trees but requires generating feedback again.
The latest 60 completed transcript lines (up to 2000 characters each) are reviewed.

Testing: build/typecheck and automated suite; live mobile preview with typed turns,
DeepSeek feedback, exact-turn navigation and fresh-session replay. Physical phone
microphone testing requires an HTTPS address; current delivery is browser preview.
