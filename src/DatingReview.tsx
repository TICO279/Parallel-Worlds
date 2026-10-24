import { useEffect, useRef, useState } from 'react';
import type { PartnerBrief } from '../shared/partner';
import type { TreeNode } from '../shared/domain';
import { validateDatingReview, type DatingReview as Review, type ReviewTurn } from '../shared/datingReview';
import { api } from './recording';
export function DatingReview({ path, busy, onView, onPractice, scenarioId, partner, onPause }: {
  path: TreeNode[]; busy: boolean; scenarioId: string; partner: PartnerBrief; onPause(): void; onView(id: string, headId: string): void; onPractice(id: string): void;
}) {
  const [review, setReview] = useState<{ result: Review; headId: string; omitted: boolean } | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (busy) { controller.current?.abort(); setLoading(false); } }, [busy]);
  const eligible = path.filter(n => n.status === 'complete' && !n.transcriptionFailed && n.text.trim());
  const canReview = eligible.some(n => n.role === 'user') && eligible.some(n => n.role === 'assistant');
  async function requestReview() {
    controller.current?.abort(); const c = new AbortController(); controller.current = c;
    const turns: ReviewTurn[] = eligible.slice(-60).map(n => ({ nodeId: n.id, role: n.role, text: n.text.slice(0, 2000) }));
    const headId = path.at(-1)!.id;
    setLoading(true); setError(null);
    try {
      const raw = await api<unknown>('/api/dating-review', { method: 'POST', signal: c.signal,
        body: JSON.stringify({ scenarioId, partner, turns }) });
      if (!c.signal.aborted) setReview({ result: validateDatingReview(raw, turns), headId,
        omitted: eligible.length > 60 || eligible.some(n => n.text.length > 2000) || eligible.length !== path.length });
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : 'Feedback is unavailable. Please try again.'); }
    finally { if (!c.signal.aborted) setLoading(false); }
  }
  return <section className="dating-review" aria-label="Dating feedback">
    <div className="review-header"><div><p>Notice what worked. Try another way to connect.</p></div>
      <button className="export-button" disabled={busy || loading || !canReview} onClick={() => void requestReview()}>
        {loading ? 'Reviewing your conversation…' : review ? 'Review this conversation again' : 'Review my practice'}</button></div>
    {busy && <button type="button" onClick={onPause}>Pause conversation</button>}
    {busy && <p className="review-note">Pause your conversation when you’re ready for feedback.</p>}
    {!busy && !canReview && <p className="review-note">Have an exchange first, then come back here.</p>}
    {loading && <p role="status">Looking for specific moments to learn from…</p>}
    {error && <p role="alert" className="review-error">{error}</p>}
    {review && <div className="review-results">
      <p className="review-note">Feedback for the conversation you reviewed.{review.omitted && ' Only completed text was reviewed, limited to the latest 60 lines and 2,000 characters per line.'}</p>
      {review.result.strength && <article className="review-strength"><span className="eyebrow">SOMETHING THAT WORKED</span><h3>{review.result.strength.title}</h3>
        <blockquote>“{review.result.strength.quote}”</blockquote><p>{review.result.strength.explanation}</p>
        <button className="review-link" disabled={busy || loading} onClick={() => onView(review.result.strength!.nodeId, review.headId)}>View this moment ↗</button></article>}
      <div className="review-suggestions">{review.result.suggestions.map((s, i) => <article className="review-suggestion" key={`${s.nodeId}-${i}`}>
        <span className="eyebrow">TRY A DIFFERENT APPROACH · {i + 1}</span><h3>{s.title}</h3>
        <button className="review-quote" disabled={busy || loading} onClick={() => onView(s.nodeId, review.headId)}>“{s.quote}” <span>View turn ↗</span></button>
        <p>{s.explanation}</p><div className="review-alternative"><b>One possible way to say it</b><p>{s.alternative}</p></div>
        <button className="revert-button" disabled={busy || loading} onClick={() => onPractice(s.nodeId)}>Try again from here ↗</button>
        <small>Your original branch stays. You choose what to say next.</small></article>)}</div>
      {!review.result.suggestions.length && <p>No specific changes were suggested for this conversation. You can keep practicing with a new topic.</p>}
    </div>}
  </section>;
}
