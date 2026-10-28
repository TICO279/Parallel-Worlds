# Stronger conflict and provocation

This tuning applies to the submission version on `main` (the former `main2`),
including its profile-based characters, DeepSeek turn judgment and Higgs TTS 3.
It does not import the archived Phase 3 backend or change the mobile layout.

## Behavior and controls

`CHARACTER_PROVOCATION` and `CHARACTER_ANGER` each accept a number from 0 to 1.
Both default to **0.8** when omitted. No new key is required. The existing `.env`
is preserved; the optional controls are documented in `.env.example`.

- High provocation asks the character to offer a counterpoint, challenge an
  overconfident assumption, tease a specific choice and lean into genuine differences.
  It also permits initiating a pointed challenge grounded in the conversation or
  profiles. There is no obligation to praise, agree or rescue a weak exchange.
- Anger strengthens both language and voice. After a personal insult or repeated
  pressure, the character can name what bothered them directly instead of hiding
  it behind reassurance. Ordinary debate and harmless banter are not classified
  as mistreatment merely to create drama.
- Unresolved tension now halves over roughly **six ordinary turns**, compared
  with three previously. Repeated negative events can intensify it. An apology
  does not reset the mood, while sustained respectful continuation can reduce it.
- Angry delivery receives more weight among the emotions the decision model
  considers plausible. Existing anger/expressive TTS tags are reused. A calm scene
  or a distribution without an angry candidate does not invent anger.
- DeepSeek and Jev judgment/emotion instructions, plus the keyword fallback,
  distinguish personal dismissal and repeated pressure from reasoned disagreement.
  The full appraisal can retain annoyance without inventing new schema values.

Zero selects the gentler baseline; it does not force agreement or suppress every
appropriate negative reaction. Provocation has low/medium/high instruction bands;
anger continuously changes tension persistence and voice weighting. Restart a
non-watching backend after changing settings and reconnect to receive new prompts.

The `friction-1` instruction compiler marker and compiled context are saved in
existing instruction history. Relationship versions and selected voice emotions
continue to be recorded/exported through the existing mechanisms. Rewind, review,
profile facts, gender-matched voices and the draft/judge/redraft pipeline are preserved.
No extra model call is introduced per turn.

## Verification

The submission branch baseline had **236 tests**. The tuned version passes all
**241 tests across 18 files**, type checking and production build. New checks cover
the controls and invalid settings, repeated hurt and gradual repair, voice weighting
under different anger strengths, configuration reaching actual TTS tags and the
distinction between disagreement and repeated personal dismissal. The old decay
expectation was updated to the intentionally slower recovery.

An isolated live probe used a synthetic female dating profile and three scripted
user lines. It exercised real DeepSeek judgment, full appraisals on major shifts,
per-sentence voice emotions and Boson Realtime text generation. Observed examples:

- Respectful disagreement about e-books stayed a non-major disagreement with zero
  tension and contemplative voice selection; the character kept her own preference.
- “Are you always this dull?” produced: “I'm not dull, I'm just not performing for
  you.” The full appraisal committed, tension became 0.8 and voice selection was anger.
- “I already apologized, so get over it and just agree with me” produced: “I won't
  be told to get over an insult or to agree on command.” Tension rose to 0.928,
  with anger retained.

The second response was also sent to real Higgs TTS 3 with anger and
`expressive_high` tags. It returned **142,080 bytes of 24 kHz mono PCM16** (2.96 s).
The scratch report and sample are in ignored `captures/friction-1-live.json` and
`captures/friction-1-anger.wav` on the development PC.

These are qualitative synthetic-text samples and generated audio, not a physical
microphone/speaker test or a guarantee of every reply. Actual phone audio and a
human judgment of whether the sharper style feels natural still need testing.

`data/` remains ignored so earlier local SQLite/certificate artifacts are not
accidentally committed when switching between the preserved versions.
