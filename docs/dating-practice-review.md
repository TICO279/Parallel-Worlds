# Dating practice review

Semantic turn detection is committed on dev1-joy at 625a303. This feature lives on
practice-review-ui and does not change live appraisal, TTS, or character prompts.

After ending a conversation with Alex, click Review my practice. A separate server-side
DeepSeek request reviews only the selected completed transcript path, excluding failed
transcription and interrupted replies, up to the latest 60 lines and 2,000 characters per
line. The UI reports truncation/excluded text. The project DeepSeek key stays server-side.
The review returns a supported strength (or null) and up to three specific suggestions.
Every item must cite an exact quote in a submitted user turn. Schema errors, invented
IDs/quotes and assistant-turn references fail closed with a retryable error, not dummy
feedback. Missing key gets a configuration message. Requests abort on unmount or starting
another live session. Reviews retry once when needed, with a total 45-second timeout.

Coaching focuses on mutual engagement, listening, self-disclosure, curiosity, context and
boundaries. It must not optimize attraction, encourage persistence after rejection, score
people, invent personal facts, or judge pronunciation from transcripts. Suggested wording
is optional. Results are generated advice, not facts about what real dates want.

Click a quote / View this moment to restore the reviewed path, highlight and focus its
user line. Try again from here uses the existing revertTo logic: replay only completed
history before that user line, connect a fresh session, and let the user speak or type a
new response. Original nodes and branches remain in the tree. The existing checkpoint
restoration behavior is retained. Review actions are disabled during live conversations.
Switching scenarios or clearing the conversation clears the local review. Reviews are
currently in-memory UI state: refreshing requires generating a new review; conversation
trees retain their existing browser persistence and export behavior.

Tests cover input/output validation, exact evidence and IDs, missing credentials, sanitized
provider failures, request separation, and replay-before-target without deleting history.
Manual browser checks should cover live feedback, quote navigation, a retry branch,
loading/error states, and viewing the preserved original branch.

## Retry replay correctness

Manual branching and review retry now use replayPlan, capturing one ancestor path for
both server-side branch restoration and the new WebSocket's seed events. Retry begins
at the target user node's parent. The target user text, its old assistant reply, later
turns and sibling branches are excluded; all original tree nodes remain available.
The client captures seed events before asynchronous bootstrap and sends one item at a
time, waiting for matching conversation.item.added acknowledgments. It enables input
only after all history is accepted. Duplicate echoes cannot replay history twice. A
10-second missing-ack timeout ends the connection rather than permitting partial replay.
Previous recording synchronization is awaited before creating the replacement session.
Interrupted/unfinalized dialogue follows the existing exclusion policy. Server checkpoint
restoration still reports a reset if the authoritative checkpoint is unavailable.
