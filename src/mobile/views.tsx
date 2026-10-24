import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ComparisonResult, TimelineNode } from '../../client';
import type { ConversationProps, DiscoverProps, MobileState, ProfileProps } from './types';
import './mobile.css';

// Alex's displayed portrait is selected independently of the imported asset's source name.
const PHOTO = '/mobile/photos/maya.jpg';
const short = (text: string, length = 90) => text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
const glyphs = {
  back: 'M15 5l-7 7 7 7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  undo: 'M4 12a8 8 0 1 0 2.3-5.6L4 8M4 4v4.5h4.5',
  bars: 'M5 20V12M10 20V6M15 20v-9M20 20v-4',
  chat: 'M5 6.5h14v8.2H8.2L5 17.5V6.5z',
  rewind: 'M11 7l-6 5 6 5zM19 7l-6 5 6 5z',
  close: 'M6 6l12 12M18 6L6 18',
  refresh: 'M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3',
};
function Icon({ name, className = 'pw-icon' }: { name: keyof typeof glyphs; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d={glyphs[name]} /></svg>;
}
/** Original inline Ember flame and Parallel Worlds rings from main2. */
export function Flame() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.1 1.8c.3 3.2-1.6 4.8-2.8 6.6-1.2 1.8-1.8 3.1-1.8 5 0 1.2.4 2.2 1.1 2.9-1.3-.8-2.1-2.1-2.1-3.6 0-2.2 1.2-3.9 2.4-5.6.8-1.1 1.5-2.1 1.6-3.6.1-.8-.4-1.4-.7-1.8.7.4 1.6 1.5 2.3.1zM12 22c3.8 0 6.6-2.6 6.6-6.2 0-2.8-1.6-4.8-3-6.6-.5-.6-1.5.1-1.1.8.8 1.5.5 2.6-.5 3.7-.7.8-1.7 1.2-1.5-.9.2-1.8-.8-3.4-1.8-4.7-.4-.5-1.2 0-.9.6.7 1.7.3 3.3-.8 4.6-1.2 1.4-1.8 2.8-1.8 4.3C7.2 19.4 9.2 22 12 22z" /></svg>; }
export function Rings({ className = 'pw-rings' }: { className?: string }) { return <svg className={className} viewBox="0 0 40 26" aria-hidden="true"><circle cx="14" cy="13" r="9.5" /><circle cx="26" cy="13" r="9.5" /></svg>; }
function Status() {
  return <div className="statusbar ember-status" aria-hidden="true"><span>9:41</span><span className="status-icons ember-status-icons"><svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor"><rect x="0" y="7" width="3" height="5" rx=".6" /><rect x="4.5" y="5" width="3" height="7" rx=".6" /><rect x="9" y="2.5" width="3" height="9.5" rx=".6" /><rect x="13.5" y="0" width="3" height="12" rx=".6" /></svg><svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M1.5 4.2C3.8 2 6.6 1 8 1s4.2 1 6.5 3.2M3.6 6.4C5 5.1 6.6 4.4 8 4.4s3 .7 4.4 2M6 8.7c.6-.5 1.3-.8 2-.8s1.4.3 2 .8" /></svg><svg width="25" height="12" viewBox="0 0 25 12"><rect x=".6" y=".6" width="21" height="10.8" rx="2.4" stroke="currentColor" fill="none" strokeWidth="1.2" /><rect x="2" y="2" width="16" height="8" rx="1.2" fill="currentColor" /><rect x="22.6" y="3.8" width="1.6" height="4.4" rx=".6" fill="currentColor" /></svg></span></div>;
}
function Frame({ children, dark = false, photo = false }: { children: ReactNode; dark?: boolean; photo?: boolean }) {
  return <div className={`mobile-shell ${dark ? 'mobile-dark' : ''}`}><div className="stage ember-stage"><div className="phone ember-phone"><span className="btn-silent ember-btn ember-silent" aria-hidden="true" /><span className="btn-vol ember-btn ember-vol" aria-hidden="true" /><span className="btn-power ember-btn ember-power" aria-hidden="true" /><div className={`screen ember-screen ${dark ? 'pw-screen' : ''} ${photo || dark ? 'on-photo' : ''}`}><Status /><div className="mobile-content root">{children}</div><div className="island ember-island" aria-hidden="true" /><div className="home-indicator ember-home" aria-hidden="true" /></div></div></div></div>;
}
function SavedDates({ state, onResume }: { state: MobileState; onResume(id: string): void }) {
  return state.conversations.length ? <div className="mobile-saved-dates">{[...state.conversations].reverse().map((date, index) => <button className="thread-row" key={date.id} disabled={state.loading || Boolean(state.operating)} onClick={() => onResume(date.id)}><span className="avatar-wrap"><img src={PHOTO} alt="" /></span><span className="thread-copy"><strong>Alex</strong><em>Continue your saved conversation</em></span><span className="when">{index === 0 ? 'Latest' : new Date(date.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></button>)}</div> : <div className="empty"><Rings /><h2>A world waiting to happen</h2><p>Your conversations with Alex will stay here.</p></div>;
}
function LightNotice({ state }: { state: MobileState }) {
  return <>{state.error && <p className="mobile-light-note" role="alert">{state.error}</p>}{state.warning && <p className="mobile-light-note" role="status">{state.warning}</p>}</>;
}
export function DiscoverView({ state, onProfile, onResume, onRefresh }: DiscoverProps) {
  const [tab, setTab] = useState<'discover' | 'dates'>('discover');
  const name = state.profile?.character.name ?? 'Alex';
  return <Frame><div className="deck-view"><header className="topbar"><div className="brand"><Flame /><span className="word">ember</span></div><button className="icon-hit" aria-label="Refresh saved conversations" disabled={state.loading || Boolean(state.operating)} onClick={onRefresh}><Icon name="refresh" /></button></header><LightNotice state={state} />
    {tab === 'discover' ? <><div className="stack"><button type="button" className="swipe-card top mobile-discovery-card" aria-label={`View ${name}'s profile`} onClick={onProfile} disabled={!state.profile || state.loading}><img className="card-photo" src={PHOTO} alt={name} /><span className="bars" aria-hidden="true"><span className="on" /></span><span className="card-shade" /><span className="card-info"><span className="card-row"><span className="card-name">{name}</span><span className="chev"><Icon name="back" /></span></span><span className="prompt"><span className="kicker">A chance to connect</span><span className="prompt-text">{state.profile?.character.description ?? 'Getting your first date ready…'}</span></span></span></button></div><div className="actions mobile-discovery-action"><button className="solid" onClick={onProfile} disabled={!state.profile || state.loading}>Meet {name}<span aria-hidden="true"> ↗</span></button></div></> : <section className="mobile-dates-view" aria-label="Saved conversations"><h1 className="page-title">Your first dates</h1><SavedDates state={state} onResume={onResume} /></section>}
    <nav className="tabbar" aria-label="Ember navigation"><button className={`tab ${tab === 'discover' ? 'on' : ''}`} aria-label="Discover" aria-current={tab === 'discover' ? 'page' : undefined} onClick={() => setTab('discover')}><Flame /></button><button className={`tab ${tab === 'dates' ? 'on' : ''}`} aria-label="Your saved dates" aria-current={tab === 'dates' ? 'page' : undefined} onClick={() => setTab('dates')}><Icon name="chat" /></button></nav>
  </div></Frame>;
}
export function ProfileView({ state, onBack, onStart, onResume }: ProfileProps) {
  const name = state.profile?.character.name ?? 'Alex', latest = state.conversations.at(-1);
  return <Frame photo><div className="detail-view profile-view"><div className="detail-scroll"><section className="profile-hero"><img src={PHOTO} alt={name} /><header className="profile-nav"><button className="icon-hit" aria-label="Back to Discover" onClick={onBack}><Icon name="back" /></button></header><div className="profile-id with-actions"><h1>{name}</h1><p className="profile-where">A first date. A fresh possibility.</p><div className="profile-pills">{state.profile?.character.traits.slice(0, 3).map(trait => <span key={trait}>{trait}</span>)}</div></div></section><div className="pad"><div className="section-label">About Alex</div><p className="about">{state.profile?.character.description ?? 'Loading profile…'}</p><div className="section-label">The setting</div><div className="look-card">{state.profile?.setting}</div><div className="section-label">Our conversations</div><SavedDates state={state} onResume={onResume} /></div></div><div className="profile-actions"><button className="pw-orb" aria-label="Enter Parallel Worlds with Alex" disabled={!state.profile || Boolean(state.operating)} onClick={onStart}><span className="orb"><Rings /></span><span className="orb-label">Parallel Worlds</span></button>{latest && <button className="mobile-resume-profile" disabled={Boolean(state.operating)} onClick={() => onResume(latest.id)}>Continue our date</button>}</div><LightNotice state={state} /></div></Frame>;
}

function Sheet({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose(): void; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], summary, [tabindex="0"]') ?? [])];
        const first = items[0], last = items.at(-1);
        if (first && event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
        else if (first && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('keydown', escape); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="pw-sheet-root" onClick={onClose}><section className={`pw-sheet ${className}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={event => event.stopPropagation()}><div className="pw-grab" aria-hidden="true" /><div className="mobile-sheet-title"><h2>{title}</h2><button className="mobile-sheet-close" aria-label="Close sheet" onClick={onClose}><Icon name="close" /></button></div>{children}</section></div>;
}
export function ComparisonContent({ result, onSelectBranch, onClose }: { result: ComparisonResult; onSelectBranch(id: string): void; onClose(): void }) {
  const paths = result.paths.slice(0, 2);
  const labels = { clarity: 'Clarity', curiosity: 'Curiosity', reciprocity: 'Reciprocity', boundaryRespect: 'Boundary respect' };
  return <><svg className="mobile-trajectories" viewBox="0 0 330 130" role="img" aria-label={paths.length > 1 ? 'Shared past branches into original and alternative conversations' : 'One recorded original conversation'}>{paths.length > 1 ? <><path d="M18 64H108" stroke="#9ba8bb" /><path d="M108 64Q145 27 190 27H310" stroke="#ffb547" /><path d="M108 64Q145 101 190 101H310" stroke="#5aa8ff" /><circle cx="108" cy="64" r="4" fill="#d2dae7" /><text x="18" y="86">{result.sharedTurnIds.length ? 'Shared past' : 'Beginning'}</text><text x="194" y="17">Original</text><text x="194" y="122">Alternative</text></> : <><path d="M18 64H310" stroke="#ffb547" /><text x="18" y="47">Original</text></>}</svg><div className="mobile-result-paths">{paths.map((path, index) => <article className={index ? 'alternative' : 'original'} key={path.branchId}><h3>{index ? 'Alternative' : 'Original'}</h3><strong className="mobile-score">{path.overall ?? '—'}{path.overall !== null && <small>/100</small>}</strong><p className="mobile-score-status">{path.provisional ? 'Provisional' : 'Communication score'} · {Math.round(path.coverage * 100)}% assessable</p><button className="mobile-revisit" onClick={() => { onSelectBranch(path.branchId); onClose(); }}>Revisit this path</button><details><summary>See the evidence</summary>{Object.entries(labels).map(([key, label]) => { const category = path.categories[key as keyof typeof labels]; return <section className="mobile-category" key={key}><h4>{label}<span>{category.score ?? 'Unavailable'}</span></h4><p>{category.explanation}</p>{category.unavailableReason && <p className="pw-fine">{category.unavailableReason}</p>}{category.evidence.map((item, i) => <blockquote key={i}>“{item.quote}”</blockquote>)}</section>; })}</details></article>)}</div><p className="mobile-key-insight">{result.insight}</p><p className="pw-fine">{result.comparisonCaution}</p><p className="pw-fine">Communication in a simulation, not attraction, compatibility or human worth. Path positions show layout, not emotions.</p></>;
}
export function EvaluationContent({ state, onSelectBranch = () => {}, onClose = () => {}, onRetry = () => {} }: { state: MobileState; onSelectBranch?(id: string): void; onClose?(): void; onRetry?(): void }) {
  if (state.evaluation && ['queued', 'running'].includes(state.evaluation.status)) return <div className="mobile-analysis-loading" role="status"><Rings /><p>Looking at what actually happened…</p><p className="pw-fine">Your conversations stay saved while the comparison is prepared.</p></div>;
  if (state.evaluation?.status === 'failed') return <><p role="alert">The comparison could not be completed. Your conversations are saved.</p>{state.evaluation.retryable && <button className="pw-done" onClick={onRetry}>Retry comparison</button>}</>;
  if (state.comparison) return <ComparisonContent result={state.comparison} onSelectBranch={onSelectBranch} onClose={onClose} />;
  return <p>{state.error ?? 'Finish a completed exchange to evaluate the conversation.'}</p>;
}
export function ConversationView(props: ConversationProps) {
  const { state, onBack, onTalk, onEnd, onRewind, onSelectBranch, onEvaluate, onDismissSuggestion, onRetryEvaluation, onDismissError } = props;
  const [pickedId, setPickedId] = useState<string | null>(null), [menu, setMenu] = useState(false), [evaluating, setEvaluating] = useState(false), [hint, setHint] = useState<string | null>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const name = state.profile?.character.name ?? 'Alex', inSession = ['connecting', 'ready', 'closing'].includes(state.connection), ready = state.connection === 'ready';
  const operating = Boolean(state.operating), speaking = state.activity === 'speaking' || state.activity === 'thinking', userNodes = state.nodes.filter(n => n.role === 'user');
  const selected = state.nodes.find(n => n.id === pickedId), last = [...state.nodes].reverse().find(n => n.text), shown = selected ?? last;
  const selectedIndex = selected ? state.nodes.findIndex(node => node.id === selected.id) : -1;
  const precedingQuestion = selectedIndex > 0 && state.nodes[selectedIndex - 1].role === 'assistant' ? state.nodes[selectedIndex - 1] : null;
  const canCreateAlternative = (state.overview?.branches.length ?? 0) < 2, eligible = [...userNodes].reverse().find(n => n.rewindable);
  const selectedBranch = state.overview?.branches.find(branch => branch.id === state.branchId);
  const status = state.connection === 'connecting' ? 'Joining the table…' : ready ? state.activity === 'speaking' ? `${name} is talking` : state.activity === 'thinking' ? `${name} is thinking…` : state.mic ? 'Listening to you' : 'Mic is off' : state.connection === 'closed' ? 'Conversation paused' : 'Tap the mic to begin';
  const suggested = state.suggestion?.status === 'active' && state.suggestion.branchId === state.branchId && state.nodes.some(node => node.id === state.suggestion?.targetTurnId && node.role === 'user') && !speaking ? state.suggestion : null;
  const closeSheet = () => { setPickedId(null); setEvaluating(false); };
  useEffect(() => { timeline.current?.scrollTo?.({ left: timeline.current.scrollWidth, behavior: 'smooth' }); }, [userNodes.length]);
  useEffect(() => { setPickedId(null); setHint(null); }, [state.branchId]);
  function pick(node: TimelineNode) { setMenu(false); setHint(null); setPickedId(node.id); }
  function undo() {
    setMenu(false);
    if (speaking) { setHint('Let this reply finish before rewinding.'); return; }
    if (!canCreateAlternative) { setHint('Your two paths are saved. Revisit either path in the comparison.'); return; }
    if (eligible) pick(eligible); else setHint('Complete an exchange before rewinding.');
  }
  function evaluate() {
    setMenu(false);
    if (speaking) { setHint('Let this reply finish before evaluating.'); return; }
    setHint(null); setEvaluating(true); onEvaluate();
  }
  const micLabel = state.connection === 'connecting' ? 'Cancel connection' : ready ? state.mic ? 'Mute microphone' : 'Enable microphone' : `Talk with ${name}`;
  return <Frame dark><div className="pw-backdrop" aria-hidden="true"><img src={PHOTO} alt="" /></div><div className="pw-app"><header className="pw-top"><button className="pw-nav" aria-label="Back to Alex's profile" disabled={operating} onClick={onBack}><Icon name="back" /></button><div className="pw-title"><Rings /><strong>Parallel Worlds</strong><span className={`pw-pill ${ready ? 'is-live' : ''}`}><img src={PHOTO} alt="" />{name}<i aria-label={ready ? 'connected' : 'not connected'} /></span>{selectedBranch && <span className="mobile-path-label">{selectedBranch.parentBranchId ? 'Alternative' : 'Original'} path</span>}</div><button className="pw-nav" aria-label="Conversation options" aria-expanded={menu} disabled={operating} onClick={() => setMenu(!menu)}><Icon name="more" /></button>{menu && <div className="pw-menu" role="menu"><button role="menuitem" onClick={() => { setMenu(false); onBack(); }}>Back to Alex's profile</button>{inSession && <button role="menuitem" onClick={() => { setMenu(false); onEnd(); }}>Pause conversation</button>}{state.overview?.branches.slice(0, 2).map(branch => <button role="menuitem" key={branch.id} disabled={speaking || operating} onClick={() => { setMenu(false); onSelectBranch(branch.id); }}>{branch.parentBranchId ? 'Alternative path' : 'Original path'}{state.branchId === branch.id ? ' · viewing' : ''}</button>)}</div>}</header>
    <main className="pw-stage"><div className={`pw-caption ${selected ? 'is-past' : ''}`} aria-live="polite"><small>{selected ? 'You said, at this point' : shown?.role === 'user' ? 'You' : name}<em> · {selected ? 'Preview' : status}</em></small><p>{shown?.text || (state.loading ? 'Restoring your saved conversation…' : `${name} is waiting at the table. Tap the mic to say hello.`)}</p></div><div className="pw-timeline"><div className="pw-track" ref={timeline} role="group" aria-label="Conversation timeline">{userNodes.map((node, index) => <button key={node.id} data-turn-id={node.id} data-suggested={suggested?.targetTurnId === node.id || undefined} className={`pw-dot ${suggested?.targetTurnId === node.id ? 'is-suggested' : ''} ${pickedId === node.id ? 'is-picked' : ''}`} aria-label={`Preview your answer ${index + 1}: ${short(node.text ?? 'Transcription unavailable')}`} aria-pressed={pickedId === node.id} disabled={operating} onClick={() => pick(node)}>{suggested?.targetTurnId === node.id && <span className="mobile-orbital-marker" aria-label="Suggested moment" />}{pickedId === node.id && <Icon name="rewind" />}</button>)}<span className="pw-dot pw-now" aria-hidden="true" /></div>{!userNodes.length && <p className="pw-hint">Each completed exchange becomes a moment to revisit.</p>}</div></main>
    {suggested && <button className="mobile-suggestion-link" onClick={() => { const node = state.nodes.find(n => n.id === suggested.targetTurnId); if (node) pick(node); }}>{suggested.tentative ? 'A moment you could explore' : 'One moment worth exploring'} <span aria-hidden="true">↗</span></button>}
    {state.error && <div className="pw-note warn" role="alert">{state.error}<button className="mobile-inline-dismiss" aria-label="Dismiss error" onClick={onDismissError}>×</button></div>}
    {state.warning && <p className="pw-note" role="status">{state.warning}</p>}
    {hint && <p className="pw-note" role="status">{hint}</p>}
    {state.configured === false && <p className="pw-note" role="status">Voice is unavailable until the local Boson key is configured.</p>}
    {state.operating && <p className="pw-note" role="status">{state.operating}</p>}
    <footer className="pw-controls"><button className="pw-tool" disabled={operating || !userNodes.length || state.connection === 'closing'} onClick={undo}><span className="pw-round"><Icon name="undo" /></span><span>Undo</span></button><button className={`pw-mic ${state.mic ? 'on' : ''} ${state.activity === 'speaking' ? 'is-hearing' : ''}`} aria-label={micLabel} aria-pressed={state.mic} disabled={state.connection === 'closing' || !state.overview || state.loading || (operating && state.connection !== 'connecting') || state.configured !== true} style={{ '--level': String(Math.min(1, state.level * 3)) } as CSSProperties} onClick={onTalk}><Icon name="mic" className="pw-icon pw-icon-lg" /></button><button className="pw-tool" disabled={operating || !state.nodes.length || state.connection === 'connecting' || state.connection === 'closing'} onClick={evaluate}><span className="pw-round"><Icon name="bars" /></span><span>Evaluate</span></button></footer>
  </div>
  {selected && <Sheet title="A different answer" onClose={() => setPickedId(null)}>{precedingQuestion?.text && <div className="mobile-preview-question"><small>Alex said</small><p>“{precedingQuestion.text}”</p></div>}<p className="mobile-preview-quote">“{selected.text ?? 'Transcription unavailable'}”</p>{suggested?.targetTurnId === selected.id && <><p>{suggested.reason}</p><p className="pw-fine">{suggested.tentative ? 'Tentative suggestion. ' : ''}An optional exploration, not a prediction.</p><button className="mobile-subtle-button" onClick={onDismissSuggestion}>Dismiss suggestion</button></>}{!selected.rewindable && <p className="pw-fine">{selected.reason ?? 'This exchange must finish and synchronize before it can be restored.'}</p>}{!canCreateAlternative && <p className="pw-fine">Your original and alternative are saved. Revisit either path instead of creating another.</p>}{!state.qualification?.contextQualified && <p className="pw-fine">Rewind is unavailable for this saved context. Your original conversation is preserved.</p>}{state.error && <p role="alert">{state.error}</p>}<p className="pw-fine">Rewind to just before this answer. {precedingQuestion ? "Alex's preceding question and saved character state will be retained." : 'Begin again from the original character state.'}</p><button className="pw-done" disabled={!selected.rewindable || !canCreateAlternative || operating || speaking || !state.qualification?.contextQualified} onClick={() => { void onRewind(selected.id).then(() => setPickedId(null)).catch(() => {}); }}>Rewind to this moment</button></Sheet>}
  {evaluating && <Sheet title="Your parallel conversations" onClose={closeSheet} className="mobile-evaluation-sheet"><EvaluationContent state={state} onSelectBranch={onSelectBranch} onClose={closeSheet} onRetry={onRetryEvaluation} /><button className="pw-done" onClick={closeSheet}>Done</button></Sheet>}
  </Frame>;
}
