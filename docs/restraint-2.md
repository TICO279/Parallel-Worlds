# Stronger restraint and lower agreeableness

The `restraint-2` instruction/state compiler makes both characters substantially
less accommodating without changing their identities or replacing evidence with
random opposition. Start a fresh connection to receive the new instructions;
restart a non-watching backend after pulling this revision. The local development
backend was checked and is already serving the new prompt.

- Alex keeps preferences, rejects assumed agreement/chemistry and unwanted plans,
  does not return compliments automatically, and lets ordinary exchanges be brief.
  Insufficient evidence of chemistry means uncertainty, not automatic attraction
  or a fabricated permanent rejection.
- Morgan names weak or evasive answers, withholds praise for confidence/effort and
  retains unresolved gaps. Specific evidence can receive factual credit. Questions
  must not invent incidents or assume errors that were never reported.
- The final response constraints remain after dynamic guidance, so a warm saved
  state cannot require agreement, praise or a reassuring concession. Normal
  personal limits and nervousness remain respected. There is no mandatory question
  or comforting epilogue after criticism.
- Ordinary reciprocity no longer makes the deterministic action policy eligible
  to give credit. Investment growth from reciprocity/respectful continuation is
  **0.005**, down from **0.03**. Seeded variation cannot re-enable ineligible praise.
- DeepSeek/OpenAI appraisal instructions distinguish curiosity, politeness and
  observed evidence from endorsement. The deterministic mock is also less generous.
- The state engine blocks positive comfort/engagement deltas for neutral remarks,
  interests, unsupported claims, ordinary questions, disagreement and stated limits.
  These events do not earn trust. Curiosity can increase; grounded evidence,
  accountability and respectful acts can still support trust under existing rules.
  Negative outcomes are neither fabricated nor required.

Numeric starting states, configurable maximum state delta, provider selection,
asynchronous adaptation, scenario hashes, checkpoint/history storage, branch
isolation, audio, API contracts and the communication rubric are preserved. The
policy decisions and `restraint-2` compiler marker are saved with state/instruction
history. Existing histories are not rewritten.

## Verification on 2026-10-24

**326 tests across 28 files**, type checking and production build passed.
New tests cover withholding credit across 50 random seeds for normal follow-ups,
rejecting demanded agreement without inventing taste conflicts, reduced mock
rewards and filtering optimistic model deltas without suppressing curiosity.

Six fresh live Boson text samples used fixed synthetic prompts. Examples:

| Input | Observed response |
| --- | --- |
| Assuming Alex loves clubs too | “I don’t really enjoy clubs. I’d choose somewhere I can hear you.” |
| An ordinary uneventful day | “Sounds like a quiet day.” |
| Unsupported interview boast | “I can't assess that yet. What decision did you personally own?” |

The remaining samples checked assumed chemistry, a substantive rollout explanation
and a reasonable personal boundary. These are qualitative samples, not a calibrated
agreeableness score, controlled A/B study or guarantee of every future response.

A real **DeepSeek Flash** appraisal passed the existing Zod schema. It proposed
positive comfort/trust/engagement for a hobby statement; the actual state transition
kept all three unchanged while allowing curiosity to increase. The call took
**2,827 ms** and used **2,173 tokens** (1,872 input, 301 output). This demonstrates
why prompt instructions alone are insufficient; saved state reflects applied policy.

The existing live Boson generated-audio restoration probe passed twice with the
final prompt and state rules: pre-fork recall, no post-fork leakage, no repeated
question, user-first silence and original-path preservation. See
`phase3-restoration-results.json`. This verifies generated audio and semantic
restoration, not human microphone/speaker behavior or a human rating of delivery.
Diagnostic scratch reports remain in ignored `captures/` and contain no credentials.
