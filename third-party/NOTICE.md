# Boson tutorial attribution

Parallel Worlds incorporates code and a recorded protocol fixture from
[boson-ai/Higgs-Realtime-Tutorial](https://github.com/boson-ai/Higgs-Realtime-Tutorial),
revision `87f1ae81434d8a65126503ceef36871e0b529f5c`, under the Apache License 2.0.
The complete upstream license is preserved in `BOSON-LICENSE`.

Reused or adapted material: audio capture and playback, worklet loading, capture
and playback AudioWorklets, resampling and PCM conversion, resampling tests, and
the three-turn transcript fixture. Authentication, configuration and transcript
processing follow the tutorial's implementation patterns.

Modifications add cancellation and cleanup, explicit overflow failure, session
acknowledgement gating, scenario-independent configuration, lifecycle handling,
and transcript reconciliation. Tool-calling and framework integrations are omitted.
