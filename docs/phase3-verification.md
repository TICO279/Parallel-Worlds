# Phase 3 verification — 2026-10-24

Scope: hackathon MVP, one original and one alternative, backend independent of the product frontend. Branch: `feature/branching-evaluation`. No push or merge.

## Automated

**266 tests across 23 files pass**, including all 228 original tests. Type checking and production build pass. Tests requiring local HTTP access run with loopback permission; sandbox-only loopback `EACCES` is not treated as an application regression.

Focused additions cover exact prefix and checkpoint restoration (including concern memory and seeded draw position), independent branches, one branch across multiple sessions, immutable original history, interrupted/unheard/incomplete forks, authored-profile qualification, stale events/attachments, final-recording retries, superseded attempts, transaction rollback and SQLite reopen, ownership and legacy-route bypasses, idempotency conflicts, API serialization, replay ACKs and unsolicited audio, exact evidence/subject validation, deterministic weights/provisional/null results, highest-anchor support, branch consistency, actual shared/fork IDs, cache reuse/invalidation, timeout, explicit retry, malformed/empty/HTTP provider responses, and browser fetch receiver binding.

These tests do not establish natural voice quality or the external provider's reliability.

Render tests also exercise the final recorded two-path result, category evidence/provisional labels, the single-path case without a fabricated alternative, and the voice-only integration harness.

## Live Boson

The bounded diagnostic uses the same backend fork/restore/recording APIs and replay gate, fresh ephemeral credentials, real generated replies, and fictional facts. Character-state appraisal in these trials is deterministic mock, which isolates restoration from an additional model dependency.

- Three text-output restoration trials passed.
- Two generated-audio restoration trials passed and received actual audio deltas.
- Each recalled its pre-fork dog name and pottery detail, withheld the later original secret code and Peru fact, did not duplicate the preceding question, produced no unsolicited response during the measured setup window, and left the original branch hash unchanged.
- The generated-audio run took about 15 seconds total; the time box was 180 seconds. No unbounded retries or bulk benchmark was run.
- This qualifies the bounded Alex/profile context path, not Morgan or every possible conversation. Profile fingerprints fail closed on mismatch.

Three earlier setup attempts failed before semantic qualification: the diagnostic did not initially reconcile a text-final event lacking an item ID. The report preserves those failures and the corrected text run. They are not silently counted as successful trials. The production audio transcript handling was not replaced to accommodate that diagnostic.

See `phase3-restoration-results.json`. Generated output audio is not evidence that a person heard it. Exact heard-word alignment and the provider's hidden state are not reconstructed.

## Live DeepSeek

Real `deepseek-flash` JSON calls used a fictional deterministic original/alternative fixture; state appraisal was mock and there were no Boson calls in this diagnostic.

- Three suggestion calls returned structured evidence. Earlier outputs selected the opening with low confidence; the final candidate policy excludes the opening because it has no preceding question. The final output selected the actual earlier user answer and cited its preceding question and answer exactly, at confidence 0.60. It is a **tentative exploration**, supported under the final .50–.64 presentation policy; that presentation rule was tested offline against the live output, without another billed call. Historical unavailable statuses are preserved in the raw report.
- The first two branch assessments incorrectly graded Alex. Backend evidence requirements produced no usable scores. This exposed a role-labeling problem rather than justifying invented totals.
- The subject prompt was corrected, assistant-only evidence is now explicitly rejected, and follow-up assessments referenced the human user's real turns. The final two-call confirmation used the completed boundary-evidence rule and retained anchors/unavailable reasons. Both branches produced validated, provisional scores with deterministic backend aggregation.
- Latency and usage are retained for every returned call. The last two assessments took approximately 4.2 and 3.1 seconds. These small samples do not establish test/retest calibration, rubric fairness, or population validity.

The report contains all nine model calls across the iterations: three suggestions and six category-assessment requests. Revisions are separate; do not combine them into a favorable aggregate success rate. The final comparison insight is deterministic and quotes actual fixture dialogue; no extra comparison/compression LLM call was made.

See `phase3-analysis-results.json`. The final state checkpoint path with live DeepSeek appraisal plus physical voice was not independently exercised in these restoration probes; its persisted-state mechanics are covered by focused automated tests and the existing appraisal implementation.

## Browser and physical testing

The existing Vite/API servers were reused. Browser checking found and fixed a native browser `fetch` receiver error that Node HTTP tests did not expose; a regression test now covers it. The harness recovered its durable conversation after reload, connected through the strict gate, remained silent before user input, and exposed microphone controls only after readiness. Disconnect/recording cleanup and another fresh temporary connection to the same durable branch were checked.

**No actual microphone speech, physical speaker listening, or human barge-in acceptance was performed in this phase.** The existing worklet/audio tests remain passing. The `/` conversation lab remains available and the new frontend has not been redesigned in this branch.

## Limits and next checks

One alternative only; no advanced compression, third path, database server, native app, authentication deployment or public API hosting. Persistence is local SQLite and device-scoped cookies. Offline browser termination can lose unsynchronized observations. Unsafe interrupted prefixes are explicitly unavailable. Different model attempts can yield different assessments; conservative evidence gates do not make the rubric objective psychology.

Next manual check: a short real microphone conversation with Alex, one eligible rewind, a different spoken answer, then evaluation/export. Confirm audible continuation, no repeated question, factual isolation, correct original preservation and resource cleanup. Do this before presenting physical voice rewind as accepted.
