# Documentation

Start with the [project README](../README.md) for setup, the iPhone tunnel and how to use the app.

## Current

| Document | What it covers |
| --- | --- |
| [Mobile dating practice review](mobile-dating-review.md) | Evaluate feedback on the phone: how reviews are generated and validated, jumping to a line, retrying it |

## Design history and evaluation

These record how the character system was built and measured. They were written while the app
was a desktop lab with two built-in characters, Alex (a first date) and Morgan (a mock
interview), and a choice between Static and Adaptive modes. Since then Morgan was removed, every
conversation is adaptive, and the product is the Ember phone flow. The reasoning and results
still describe how characters behave.

| Document | What it covers |
| --- | --- |
| [Phase 2: adaptive character state](phase2.md) | The appraisal pipeline, configuration, live evidence and limits |
| [Score updates and branch continuity](scores-and-branching.md) | How scores update, and how branches replay dialogue and restore state |
| [Character realism plan](phase2-realism-plan.md) | Goals and design for grounded, mixed and bounded reactions |
| [Character realism baseline](realism-implementation.md) | What was implemented from the plan, and how it was verified |
| [Live acceptance and next experiments](experiments.md) | Early connectivity checks and planned voice experiments |

## Evaluation results

Saved outputs of the evaluation and probe scripts in `tools/`, referenced by the documents above.
The scripts write to `captures/` (not committed); these are the copies kept with the reports.

| File | Produced by |
| --- | --- |
| `realism-baseline-results.json`, `realism-revised-results.json`, `realism-confirmation-results.json` | `pnpm evaluate:realism` |
| `phase2-evaluation-results.json` | `pnpm evaluate:adaptation` |
| `phase2-protocol-results.json` | `pnpm probe:adaptation` |
| `phase2-steering-results.json`, `phase2-audio-steering-results.json` | `pnpm probe:steering` (text and audio output) |

## Images

`images/architecture.png` and `images/turn-flow.png` (used in the project README) are rendered from
the HTML sources in `images/src/`. After editing a source, run `node docs/images/src/render.mjs`
(needs Google Chrome).
