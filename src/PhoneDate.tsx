import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import type { Conversation, ConversationTree, ProtocolEvent, SessionBootstrap, TreeNode } from '../shared/domain';
import { EMBER_DATE, scenarioFromPartner, type PartnerBrief } from '../shared/partner';
import { emptyConversation, orderedTurns, reduceTranscript } from '../shared/transcript';
import { branchHistory, emptyTree, isSeedEcho, pathTo, revertTo, seedEvents, syncSession } from '../shared/tree';
import { HiggsClient, type Activity, type ConnectionState } from './realtime/HiggsClient';
import { api, SessionRecorder } from './recording';
import { pollAdaptation, type AdaptationView } from './adaptationPolling';
import { relationshipNames } from '../shared/characterState';
import { turnPipeline } from './turnPipeline';
import { DatingReview } from './DatingReview';
import { loadTrees, saveTrees } from './treeStorage';
import { forgetIfRestarted } from './freshStart';

/** Phone trees are kept apart from the lab's, so two open tabs never overwrite each other. */
const PHONE_TREES = 'parallel-worlds.phone-trees.v1';
const PHONE_STARS = 'parallel-worlds.phone-stars.v1';
/** Written by Ember's My profile tab (dating/app.js). */
const ME_KEY = 'ember.me.v1';
const LIVE: ConnectionState[] = ['connecting', 'ready', 'closing'];

function myProfile(): unknown {
  try { return JSON.parse(localStorage.getItem(ME_KEY) ?? 'null'); } catch { return null; }
}
function loadStars(): string[] {
  try { const raw = JSON.parse(localStorage.getItem(PHONE_STARS) ?? '[]'); return Array.isArray(raw) ? raw.filter(id => typeof id === 'string') : []; } catch { return []; }
}
function safePhoto(url?: string) {
  if (!url) return '';
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/photos/') ? parsed.pathname : '';
  } catch { return ''; }
}
const short = (text: string, max = 64) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function Icon({ d, className = 'pw-icon' }: { d: string; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
}
const ICONS = {
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  undo: 'M4 12a8 8 0 1 0 2.3-5.6L4 8M4 4v4.5h4.5',
  back: 'M15 5l-7 7 7 7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  bars: 'M5 20V12M10 20V6M15 20v-9M20 20v-4',
  rewind: 'M11 7l-6 5 6 5zM19 7l-6 5 6 5z',
  send: 'M5 12h14M13 6l6 6-6 6',
  star: 'M12 3.5l2.6 5.3 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z',
};

/** The first date with someone you matched with on Ember. Every line you say is a breakpoint you can go back to. */
export function PhoneDate({ brief }: { brief: PartnerBrief }) {
  const scenario = scenarioFromPartner(brief)!;
  const scenarioId = scenario.id; const name = scenario.character.name;
  const photo = safePhoto(brief.photo);
  const from = new URLSearchParams(window.location.search).get('from');
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [activity, setActivity] = useState<Activity>('idle');
  const [mic, setMic] = useState(false); const [level, setLevel] = useState(0); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [configured, setConfigured] = useState<boolean | null>(null);
  const [trees, setTrees] = useState<Record<string, ConversationTree>>(() => loadTrees(PHONE_TREES));
  const [stars, setStars] = useState<string[]>(loadStars);
  const [picked, setPicked] = useState<string | null>(null); const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState('');
  // A line typed before the date has joined; sent as soon as it is ready.
  const pendingText = useRef<string | null>(null);
  const [liveSession, setLiveSession] = useState<string | null>(null);
  const [reviewGeneration, setReviewGeneration] = useState(0);
  const [scores, setScores] = useState<AdaptationView | null>(null); const [evaluating, setEvaluating] = useState(false);
  const treesRef = useRef(trees); treesRef.current = trees;
  const client = useRef<HiggsClient | null>(null); const state = useRef<Conversation>(emptyConversation());
  const recorder = useRef<SessionRecorder | null>(null); const recorders = useRef<SessionRecorder[]>([]);
  const sessionId = useRef<string | null>(null); const armMic = useRef(false);
  // The breakpoint the current session continues from; its live lines hang under it in the tree.
  const live = useRef<{ baseId: string | null; sessionId?: string } | null>(null);
  const seeds = useRef<ProtocolEvent[]>([]);
  const replayHistory = useRef<ReturnType<typeof branchHistory>>([]);
  const [pulse, setPulse] = useState(0);
  const timeline = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!evaluating) return;
    const previous = document.activeElement as HTMLElement | null;
    sheet.current?.focus();
    return () => previous?.focus();
  }, [evaluating]);

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]'); const previous = meta?.getAttribute('content');
    meta?.setAttribute('content', '#0b0e14');
    return () => { if (previous) meta?.setAttribute('content', previous); };
  }, []);

  useEffect(() => {
    let mounted = true;
    void api<{ credentialsConfigured: boolean; bootId?: string }>('/api/health')
      .then(health => {
        if (!mounted) return;
        setConfigured(health.credentialsConfigured);
        // The app was restarted since this phone last saw it: start this date from scratch.
        if (forgetIfRestarted(health.bootId)) { treesRef.current = {}; setTrees({}); setStars([]); }
      })
      .catch(() => { if (mounted) setError('The date lab is not running. Start Parallel Worlds, then try again.'); });
    const c = new HiggsClient({
      bootstrap: async signal => {
        const previous = recorder.current;
        if (previous) {
          const deadline = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
          while (!previous.synced) {
            deadline.throwIfAborted(); await previous.flush();
            if (!previous.synced) await new Promise<void>((resolve, reject) => {
              const stop = () => { clearTimeout(timer); reject(deadline.reason); };
              const timer = setTimeout(() => { deadline.removeEventListener('abort', stop); resolve(); }, 100);
              deadline.addEventListener('abort', stop, { once: true });
              if (deadline.aborted) stop();
            });
          }
        }
        return api<SessionBootstrap>('/api/sessions', { method: 'POST', signal, body: JSON.stringify({
          scenarioId: EMBER_DATE, partner: brief, user: myProfile(), mode: 'adaptive',
          history: replayHistory.current }) });
      },
      seed: () => seeds.current,
      // An outgoing date opens, but only when nothing has been said yet on this path.
      opens: () => brief.opens === '1' && !seeds.current.length && !pendingText.current,
      pipeline: turnPipeline(() => ({ id: sessionId.current, recorder: recorder.current })),
      onBootstrap: data => {
        state.current = emptyConversation(); sessionId.current = data.session.id; setLiveSession(data.session.id);
        if (live.current) live.current.sessionId = data.session.id;
        const next = new SessionRecorder(data.session.id, () => {});
        recorder.current = next; recorders.current.push(next);
      },
      onState: next => {
        if (!mounted) return;
        setConnection(next);
        if (next === 'closed' || next === 'closing') { armMic.current = false; setBusy(false); }
        if (next === 'ready' && armMic.current) {
          armMic.current = false; setBusy(true);
          void c.toggleMic().finally(() => { if (mounted) setBusy(false); });
        }
        if (next === 'ready' && pendingText.current) { c.sendText(pendingText.current); pendingText.current = null; }
        if (next === 'closed') pendingText.current = null;
      },
      onActivity: next => { if (mounted) setActivity(next); },
      onError: message => { if (mounted) { armMic.current = false; setError(message); } },
      onMic: active => { if (mounted) setMic(active); },
      onLevel: value => { if (mounted) setLevel(value); },
      onApplication: (version, status) => {
        const id = sessionId.current;
        if (id) void api(`/api/sessions/${id}/adaptation/application`, { method: 'POST', body: JSON.stringify({ version, status }) }).catch(() => {});
      },
      onLatency: metric => {
        const id = sessionId.current;
        if (id) void api(`/api/sessions/${id}/latencies`, { method: 'POST', body: JSON.stringify(metric) }).catch(() => {});
      },
      onEvent: (event: ProtocolEvent) => {
        if (isSeedEcho(event)) return;
        if (event.type === 'session.created' || event.type === 'session.updated') recorder.current?.status('active', (event.session as { id?: string } | undefined)?.id);
        if (event.type === 'client.session_end' && mounted) setError(String(event.message));
        state.current = reduceTranscript(state.current, event, Date.now());
        const l = live.current;
        if (mounted && l?.sessionId) {
          const { baseId, sessionId: id } = l; const turns = orderedTurns(state.current);
          setTrees(t => ({ ...t, [scenarioId]: syncSession(t[scenarioId] ?? emptyTree(), baseId, id, turns) }));
        }
        if (event.type.endsWith('.completed') || event.type.endsWith('.failed') || event.type.endsWith('.done') ||
          ['client.interrupted', 'client.closed', 'client.discarded', 'client.reply', 'input_audio_buffer.committed', 'conversation.item.added'].includes(event.type))
          recorder.current?.snapshot(orderedTurns(state.current));
        if (event.type === 'client.closed') recorder.current?.status('closed');
      },
    });
    client.current = c;
    return () => { mounted = false; void c.disconnect(); recorders.current.forEach(item => item.dispose()); };
  }, [brief]);

  // Pick up her updated state between turns, and star the lines that shifted how she feels.
  useEffect(() => {
    if (!liveSession || connection !== 'ready') return;
    return pollAdaptation({
      load: signal => api(`/api/sessions/${liveSession}/adaptation`, { signal }),
      onData: data => {
        setScores(data);
        client.current?.queueInstructions(data.prepared.version, data.prepared.instructions,
          { persistentInstructions: data.prepared.persistentInstructions ?? data.prepared.instructions, triggerTurnId: data.prepared.triggerTurnId });
        const major = (data.judgments ?? []).filter(j => j.major).map(j => `${liveSession}/${j.turnId}`);
        if (major.length) setStars(s => major.every(id => s.includes(id)) ? s : [...new Set([...s, ...major])]);
      },
      onError: () => {},
      keepPolling: () => true,
    });
  }, [liveSession, connection]);

  useEffect(() => { const timer = setTimeout(() => saveTrees(trees, PHONE_TREES), 300); return () => clearTimeout(timer); }, [trees]);
  useEffect(() => { try { localStorage.setItem(PHONE_STARS, JSON.stringify(stars.slice(-500))); } catch { /* memory only */ } }, [stars]);

  const tree = trees[scenarioId] ?? emptyTree(); const path = pathTo(tree, tree.headId);
  const breakpoints = path.filter(n => n.role === 'user' && n.text);
  useEffect(() => { timeline.current?.scrollTo({ left: timeline.current.scrollWidth, behavior: 'smooth' }); }, [breakpoints.length]);

  const inSession = LIVE.includes(connection);
  const ready = connection === 'ready';
  const pickedNode = picked ? tree.nodes[picked] : undefined;
  const last = [...path].reverse().find(n => n.text) as TreeNode | undefined;
  const shown = pickedNode ?? last;
  const speaker = shown ? (shown.role === 'user' ? 'You' : name) : name;
  const status = !ready ? (connection === 'connecting' ? 'Joining the table…' : '')
    : activity === 'speaking' ? `${name} is talking` : activity === 'thinking' ? `${name} is thinking…` : mic ? 'Listening to you' : 'Mic is off';
  const caption = pickedNode ? pickedNode.text
    : shown?.text ?? (brief.opens === '1' ? `${name} is waiting at the table. Tap the mic and she'll say hi, or type below to go first.` : `${name} is waiting at the table. Tap the mic or type below to say hi.`);

  /** Joins (or rejoins) the date from the current breakpoint, replaying what was said so far. */
  function join(withMic: boolean) {
    const current = treesRef.current[scenarioId] ?? emptyTree();
    setError(null); armMic.current = withMic;
    const path = pathTo(current, current.headId);
    live.current = { baseId: current.headId }; seeds.current = seedEvents(path); replayHistory.current = branchHistory(path);
    void client.current?.connect();
  }
  async function onMic() {
    setMenu(false);
    // Speaking with a point picked means "from there": go back first, then listen.
    if (picked) { await rewindTo(picked, { mic: true }); return; }
    if (connection === 'closing') return;
    if (connection === 'connecting') { armMic.current = false; await client.current?.disconnect(); return; }
    if (!ready) { join(true); return; }
    setBusy(true); await client.current?.toggleMic(); setBusy(false);
  }
  /** Typing works at any time: it joins the date if needed and mutes the mic, since a typed line needs it off. */
  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim(); if (!text || connection === 'closing') return;
    setMenu(false);
    // Typing with a point picked means "say this instead, from there".
    if (picked) { await rewindTo(picked, { text }); return; }
    if (!ready) {
      pendingText.current = text; setDraft('');
      if (connection !== 'connecting') join(false);
      return;
    }
    if (mic) { setBusy(true); await client.current?.toggleMic(); setBusy(false); }
    if (client.current?.sendText(text)) setDraft('');
  }
  /**
   * Go back to just before you said this line, then carry on in a fresh session from there.
   * `then`: what you do next from that point: start the mic, say a typed line, or rejoin to practice it
   * (from the feedback sheet); otherwise rejoin as you were.
   */
  async function rewindTo(nodeId: string, then?: { mic?: boolean; text?: string; practice?: boolean }) {
    if (treesRef.current[scenarioId]?.nodes[nodeId]?.role !== 'user') return;
    const wasLive = LIVE.includes(client.current?.connectionState ?? 'idle'); const hadMic = mic;
    setPicked(null); setMenu(false); setDraft('');
    if (wasLive) await client.current?.disconnect();
    live.current = null; // late events of the old session must not move the tree back
    const head = revertTo(treesRef.current[scenarioId] ?? emptyTree(), nodeId).headId;
    setTrees(t => ({ ...t, [scenarioId]: { ...(t[scenarioId] ?? emptyTree()), headId: head } }));
    treesRef.current = { ...treesRef.current, [scenarioId]: { ...(treesRef.current[scenarioId] ?? emptyTree()), headId: head } };
    if (then?.text) { pendingText.current = then.text; join(false); }
    else if (then?.mic) join(true);
    else if (then?.practice) join(false);
    else if (wasLive) join(hadMic);
  }
  function undo() { const lastLine = breakpoints.at(-1); if (lastLine) void rewindTo(lastLine.id); }
  async function startOver() {
    setMenu(false); setPicked(null); setEvaluating(false);
    pendingText.current = null; armMic.current = false;
    if (LIVE.includes(client.current?.connectionState ?? 'idle')) await client.current?.disconnect();
    live.current = null; seeds.current = []; replayHistory.current = [];
    sessionId.current = null; setLiveSession(null); setScores(null);
    // Remounting also aborts any review still arriving for the previous date.
    setReviewGeneration(value => value + 1);
    const previous = treesRef.current[scenarioId];
    setStars(values => values.filter(id => !previous?.nodes[id]));
    const { [scenarioId]: _removed, ...rest } = treesRef.current;
    treesRef.current = rest; setTrees(rest);
  }
  async function leave() {
    armMic.current = false; await client.current?.disconnect(); await recorder.current?.flush();
    window.location.assign(from && /^[a-z]+$/.test(from) ? `/#profile=${from}` : '/');
  }
  function pick(id: string) {
    setMenu(false);
    if (picked === id) { void rewindTo(id); return; }
    setPicked(id);
  }

  async function pauseReview() {
    pendingText.current = null; armMic.current = false;
    await client.current?.disconnect();
    await recorder.current?.flush();
  }
  function viewReviewTurn(id: string, headId: string) {
    const current = treesRef.current[scenarioId];
    if (!current?.nodes[id] || !pathTo(current, headId).some(n => n.id === id)) return;
    const next = { ...current, headId };
    treesRef.current = { ...treesRef.current, [scenarioId]: next };
    setTrees(treesRef.current); setEvaluating(false); setPicked(id); setPulse(n => n + 1);
    requestAnimationFrame(() => document.getElementById(`turn-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }));
  }
  function onSheetKey(event: KeyboardEvent) {
    if (event.key === 'Escape') setEvaluating(false);
    if (event.key !== 'Tab') return;
    const controls = [...(sheet.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary, [tabindex="0"]') ?? [])]
      .filter(el => el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet.current)) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  function evaluate() {
    setMenu(false); setPicked(null); setEvaluating(true);
    if (liveSession && !ready) {
      const id = liveSession;
      void api<AdaptationView>(`/api/sessions/${id}/adaptation`)
        .then(data => { if (sessionId.current === id) setScores(data); }).catch(() => {});
    }
  }

  const relationship = scores?.states.at(-1)?.relationship;
  const mood = relationship && [relationship.tension > 0.5 ? 'tense' : relationship.tension > 0.2 ? 'a little tense' : 'relaxed',
    relationship.warmth > 0.15 ? 'warm' : relationship.warmth < -0.15 ? 'cool' : 'neutral'].join(' and ');
  const micLabel = connection === 'connecting' ? 'Cancel' : ready ? (mic ? 'Mute microphone' : 'Unmute microphone') : `Talk with ${name}`;
  return (
    <div className="ember-stage">
      <div className="ember-phone">
        <span className="ember-btn ember-silent" aria-hidden="true" />
        <span className="ember-btn ember-vol" aria-hidden="true" />
        <span className="ember-btn ember-power" aria-hidden="true" />
        <div className="ember-screen pw-screen">
          <div className="ember-status" aria-hidden="true">
            <span>9:41</span>
            <span className="ember-status-icons">
              <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor"><rect x="0" y="7" width="3" height="5" rx="0.6"/><rect x="4.5" y="5" width="3" height="7" rx="0.6"/><rect x="9" y="2.5" width="3" height="9.5" rx="0.6"/><rect x="13.5" y="0" width="3" height="12" rx="0.6"/></svg>
              <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M1.5 4.2C3.8 2 6.6 1 8 1s4.2 1 6.5 3.2"/><path d="M3.6 6.4C5 5.1 6.6 4.4 8 4.4s3 .7 4.4 2"/></svg>
              <svg width="25" height="12" viewBox="0 0 25 12"><rect x="0.6" y="0.6" width="21" height="10.8" rx="2.4" stroke="currentColor" fill="none" strokeWidth="1.2"/><rect x="2" y="2" width="16" height="8" rx="1.2" fill="currentColor"/></svg>
            </span>
          </div>
          <div className="ember-island" aria-hidden="true" />

          <div className="pw-backdrop" aria-hidden="true">
            {photo ? <img src={photo} alt="" /> : <div className="pw-fallback">{name[0]}</div>}
          </div>

          <div className="pw-app" inert={evaluating}>
            <header className="pw-top">
              <button type="button" className="pw-nav" aria-label={`Back to ${name}'s profile`} onClick={() => { void leave(); }}><Icon d={ICONS.back} /></button>
              <div className="pw-title">
                <svg className="pw-rings" viewBox="0 0 40 26" aria-hidden="true"><circle cx="14" cy="13" r="9.5" /><circle cx="26" cy="13" r="9.5" /></svg>
                <strong>Parallel Worlds</strong>
                <span className={`pw-pill ${ready ? 'is-live' : ''}`}>
                  {photo ? <img src={photo} alt="" /> : <b>{name[0]}</b>}{name}<i aria-label={ready ? 'connected' : 'not connected'} />
                </span>
              </div>
              <button type="button" className="pw-nav" aria-label="More" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(m => !m)}><Icon d={ICONS.more} className="pw-icon pw-dots" /></button>
              {menu && (
                <div className="pw-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => { void leave(); }}>Back to {name}'s profile</button>
                  <button type="button" role="menuitem" className="danger" disabled={!Object.keys(tree.nodes).length && !inSession} onClick={() => { void startOver(); }}>Start the date over</button>
                </div>
              )}
            </header>

            <main className="pw-stage" onClick={() => { setPicked(null); setMenu(false); }}>
              <div key={pulse} className={`pw-caption ${picked ? 'pw-pulse' : ''} ${pickedNode ? 'is-past' : ''}`} aria-live="polite">
                <small>{pickedNode ? 'Go back to before you said this: tap the dot again, speak, or type' : speaker}{!pickedNode && status && <em> · {status}</em>}</small>
                <p>{caption}</p>
              </div>

              <div className="pw-timeline" onClick={event => event.stopPropagation()}>
                <div className="pw-track" ref={timeline}>
                  {breakpoints.map((node, index) => {
                    const starred = stars.includes(node.id); const on = picked === node.id;
                    return (
                      <button type="button" key={node.id} id={`turn-${node.id}`} className={`pw-dot ${starred ? 'is-star' : ''} ${on ? 'is-picked' : ''}`}
                        aria-label={`${on ? 'Rewind to before' : 'Show'} line ${index + 1}: ${short(node.text)}`} disabled={busy} onClick={() => pick(node.id)}>
                        {on && <span className="pw-tip">{starred ? 'Worth exploring' : `Line ${index + 1}`}</span>}
                        {on ? <Icon d={ICONS.rewind} className="pw-icon pw-rewind" /> : starred ? <Icon d={ICONS.star} className="pw-icon pw-star" /> : null}
                        {on && <span className="pw-tap">Rewind here</span>}
                      </button>
                    );
                  })}
                  <span className="pw-dot pw-now" aria-hidden="true" />
                </div>
                {!breakpoints.length && <p className="pw-hint">Each thing you say becomes a point you can rewind to.</p>}
              </div>
            </main>

            {(configured === false || error) && (
              <p className={`pw-note ${error ? 'warn' : ''}`} role={error ? 'alert' : undefined}>
                {error || 'Live voice turns on after the local Boson key is set.'}
              </p>
            )}

            <form className="pw-compose" onSubmit={event => { void send(event); }}>
              <input value={draft} maxLength={500} onChange={event => setDraft(event.target.value)}
                placeholder={connection === 'connecting' ? 'Joining the table…' : `Or type to ${name}…`} aria-label={`Message ${name}`} />
              <button type="submit" disabled={!draft.trim() || connection === 'closing' || busy} aria-label="Send"><Icon d={ICONS.send} /></button>
            </form>

            <footer className="pw-controls">
              <button type="button" className="pw-tool" disabled={!breakpoints.length || busy || connection === 'closing'} onClick={undo}>
                <span className="pw-round"><Icon d={ICONS.undo} /></span><span>Undo</span>
              </button>
              <button type="button" className={`pw-mic ${mic ? 'on' : ''} ${activity === 'speaking' ? 'is-hearing' : ''}`} aria-label={micLabel} aria-pressed={mic}
                disabled={connection === 'closing' || busy} style={{ '--level': String(Math.min(1, level * 3)) } as CSSProperties} onClick={() => { void onMic(); }}>
                <Icon d={ICONS.mic} className="pw-icon pw-icon-lg" />
              </button>
              <button type="button" className="pw-tool" onClick={evaluate}>
                <span className="pw-round"><Icon d={ICONS.bars} /></span><span>Evaluate</span>
              </button>
            </footer>
          </div>

          {(
            <div className="pw-sheet-root" style={{ display: evaluating ? undefined : 'none' }} onKeyDown={onSheetKey} onClick={() => setEvaluating(false)}>
              <div ref={sheet} tabIndex={-1} className="pw-sheet" role="dialog" aria-modal="true" aria-labelledby="pw-eval-title" onClick={event => event.stopPropagation()}>
                <div className="pw-grab" />
                <h2 id="pw-eval-title">Your date with {name}</h2>
                <DatingReview key={reviewGeneration} path={path} busy={inSession} scenarioId={scenarioId} partner={brief}
                  onPause={() => void pauseReview()} onView={viewReviewTurn}
                  onPractice={id => { setEvaluating(false); void rewindTo(id, { practice: true }); }} />
                <details className="pw-feelings"><summary>How {name} feels so far</summary>
                {relationship ? <>
                  {relationshipNames.map(key => (
                    <div className="pw-meter" key={key}>
                      <span>{key}</span><i><b style={{ width: `${Math.round(relationship[key] * 100)}%` }} /></i><em>{Math.round(relationship[key] * 100)}</em>
                    </div>
                  ))}
                  <p>Right now she seems <strong>{mood}</strong>.{relationship.lastShift && <> The last thing that moved her: {relationship.lastShift.event.replace(/_/g, ' ')}{relationship.lastShift.major ? ' (a big shift)' : ''}.</>}</p>
                  {stars.some(id => breakpoints.some(b => b.id === id)) && <p>★ on the timeline marks the lines that shifted her most. They are worth rewinding to.</p>}
                </> : <p>Talk with {name} first. Her feelings update after each thing you say.</p>}
                <p className="pw-fine">Simulation scores from 0 to 100, not real emotions.</p></details>
                <button type="button" className="pw-done" onClick={() => setEvaluating(false)}>Done</button>
              </div>
            </div>
          )}
          <div className="ember-home" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
