import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Conversation, ConversationTree, ProtocolEvent, Scenario, SessionBootstrap, StoredSession, TreeNode } from '../shared/domain';
import { emptyConversation, orderedTurns, reduceTranscript } from '../shared/transcript';
import { childMap, emptyTree, isSeedEcho, pathTo, revertTo, seedEvents, syncSession } from '../shared/tree';
import { HiggsClient, type Activity, type ConnectionState } from './realtime/HiggsClient';
import { api, SessionRecorder } from './recording';
import { loadTrees, saveTrees } from './treeStorage';
import { TreeView } from './TreeView';
const lineText = (n: TreeNode) => n.text || (n.transcriptionFailed ? '[Transcription unavailable]'
  : n.role === 'user' && n.status !== 'incomplete' ? 'Transcribing…' : n.status === 'incomplete' ? '[Turn unfinished]' : '…');
export function App() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]); const [selected, setSelected] = useState('alex-first-date');
  const [connection, setConnection] = useState<ConnectionState>('idle'); const [activity, setActivity] = useState<Activity>('idle');
  const [mic, setMic] = useState(false); const [level, setLevel] = useState(0); const [micBusy, setMicBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [recording, setRecording] = useState<string | null>(null);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [trees, setTrees] = useState<Record<string, ConversationTree>>(loadTrees); const [selectedLine, setSelectedLine] = useState<string | null>(null);
  // The tree node that was HEAD when the current session started; its live turns hang under it.
  const live = useRef<{ scenarioId: string; baseId: string | null; sessionId?: string } | null>(null);
  const seeds = useRef<ProtocolEvent[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null); const [exporting, setExporting] = useState(false);
  const [draft, setDraft] = useState('');
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const client = useRef<HiggsClient | null>(null); const state = useRef<Conversation>(emptyConversation());
  const recorder = useRef<SessionRecorder | null>(null); const recorders = useRef<SessionRecorder[]>([]);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let mounted = true;
    void Promise.all([api<Scenario[]>('/api/scenarios'), api<{ credentialsConfigured: boolean }>('/api/health')])
      .then(([list, health]) => { if (mounted) { setScenarios(list); setConfigured(health.credentialsConfigured); } })
      .catch(() => { if (mounted) setError('Cannot reach the local server. Start the application with pnpm dev.'); });
    const c = new HiggsClient({
      bootstrap: signal => api<SessionBootstrap>('/api/sessions', { method: 'POST', signal, body: JSON.stringify({ scenarioId: selectedRef.current }) }),
      seed: () => seeds.current, autoMic: true,
      onBootstrap: data => {
        state.current = emptyConversation(); setSession(data.session);
        if (live.current) live.current.sessionId = data.session.id;
        const r = new SessionRecorder(data.session.id, message => { if (recorder.current === r && mounted) setRecording(message); });
        recorder.current = r; recorders.current.push(r);
      },
      onState: s => { if (mounted) { setConnection(s); if (s === 'closed') setMicBusy(false); } }, onActivity: a => { if (mounted) setActivity(a); },
      onError: m => { if (mounted) setError(m); }, onMic: b => { if (mounted) setMic(b); }, onLevel: n => { if (mounted) setLevel(n); },
      onEvent: (e: ProtocolEvent) => {
        if (isSeedEcho(e)) return;
        if (e.type === 'session.created' || e.type === 'session.updated') {
          const s = e.session as { id?: string } | undefined;
          recorder.current?.status('active', s?.id);
        }
        if (e.type === 'client.session_end' && mounted) setError(String(e.message));
        state.current = reduceTranscript(state.current, e, Date.now());
        const l = live.current;
        if (mounted && l?.sessionId) {
          const { scenarioId, baseId, sessionId } = l; const turns = orderedTurns(state.current);
          setTrees(t => ({ ...t, [scenarioId]: syncSession(t[scenarioId] ?? emptyTree(), baseId, sessionId, turns) }));
        }
        if (e.type.endsWith('.completed') || e.type.endsWith('.failed') || e.type.endsWith('.done') ||
          ['client.interrupted', 'client.closed', 'input_audio_buffer.committed'].includes(e.type))
          recorder.current?.snapshot(orderedTurns(state.current));
        if (e.type === 'client.closed') recorder.current?.status('closed');
      },
    });
    client.current = c;
    const leave = (event: BeforeUnloadEvent) => {
      if (c.connectionState === 'ready' || c.connectionState === 'connecting' || recorders.current.some(r => !r.synced)) event.preventDefault();
    };
    window.addEventListener('beforeunload', leave);
    return () => { mounted = false; window.removeEventListener('beforeunload', leave); void c.disconnect(); recorders.current.forEach(r => r.dispose()); };
  }, []);
  useEffect(() => { const timer = setTimeout(() => saveTrees(trees), 400); return () => clearTimeout(timer); }, [trees]);
  const tree = trees[selected] ?? emptyTree(); const path = pathTo(tree, tree.headId);
  useEffect(() => { if (path.length) transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [trees]);
  const scenario = scenarios.find(s => s.id === selected); const sessionScenario = scenarios.find(s => s.id === session?.scenarioId) ?? scenario;
  const busy = connection === 'connecting' || connection === 'ready' || connection === 'closing';
  // HEAD has children only after a revert: the next session starts a sibling branch.
  const atFork = !busy && (childMap(tree).get(tree.headId)?.length ?? 0) > 0;
  const startLabel = !Object.keys(tree.nodes).length ? 'Start conversation' : atFork ? 'Start new branch' : 'Continue conversation';
  function start() {
    setError(null); setRecording(null); setSelectedLine(null);
    live.current = { scenarioId: selected, baseId: tree.headId };
    seeds.current = seedEvents(path);
    void client.current?.connect();
  }
  function sendDraft(event: FormEvent) {
    event.preventDefault();
    if (client.current?.sendText(draft)) setDraft('');
  }
  function revert(id: string) { setTrees(t => ({ ...t, [selected]: revertTo(t[selected] ?? emptyTree(), id) })); setSelectedLine(null); }
  function clearTree() { setTrees(t => { const { [selected]: _removed, ...rest } = t; return rest; }); setSelectedLine(null); }
  async function exportConversation() {
    if (!session || !recorder.current) return;
    setExporting(true);
    try {
      const done = await recorder.current.flush();
      if (!done && !recorder.current.synced) throw new Error('Recording is still syncing. Please try exporting again in a moment.');
      const data = await api<StoredSession>(`/api/sessions/${session.id}/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `parallel-worlds-${session.id}.json`; link.click(); URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed.'); }
    finally { setExporting(false); }
  }
  const name = sessionScenario?.character.name ?? 'Alex';
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Parallel Worlds home"><span className="brand-symbol">◒</span><span>parallel<br/>worlds<span className="brand-period">.</span></span></a>
      <div className="sidebar-intro"><span className="eyebrow">THE CONVERSATION LAB</span><p>A different connection.<br/>A world of possibility.</p></div>
      <div className="scenario-label"><span className="eyebrow">CHOOSE YOUR SCENARIO</span><span>01 — 02</span></div>
      <nav aria-label="Scenarios" className="scenario-list">{scenarios.map((s, i) => <button key={s.id} disabled={busy} aria-pressed={selected === s.id}
        className={`scenario-option ${selected === s.id ? 'selected' : ''}`} onClick={() => { setSelected(s.id); setSelectedLine(null); }}>
        <span className="scenario-number">0{i + 1}</span><span><strong>{s.title}</strong><small>{i === 0 ? 'Connection & curiosity' : 'Clarity & confidence'}</small></span><span className="option-arrow">↗</span>
      </button>)}</nav>
      <div className="sidebar-note"><span className="small-orbit">✳</span><p>Every conversation starts<br/>with being present.</p></div>
      <footer className="sidebar-footer"><span className="status-dot"/> PHASE 01 <span>VOICE FOUNDATION</span></footer>
    </aside>
    <main>
      <header className="topbar"><span>EXPERIENCE / <b>LIVE CONVERSATION</b></span><span className={`connection-pill ${connection === 'ready' ? 'connected' : ''}`}><span className="status-dot"/>{connection === 'ready' ? 'Connected' : connection === 'connecting' ? 'Connecting…' : 'Not connected'}</span></header>
      <div className="workspace">
        <div className="page-heading"><div><span className="eyebrow">ONE CONVERSATION. ENDLESS POSSIBILITY.</span><h1>See where it goes<span>.</span></h1><p>Step into a scenario. Be yourself. Let the conversation unfold.</p></div><span className="edition">PW / 001<br/><b>REALTIME EXPLORATIONS</b></span></div>
        {configured === false && <div className="notice">Ready when you are. Add <code>BOSON_API_KEY</code> to your local <code>.env</code> and restart the backend to enable live sessions.</div>}
        {error && <div role="alert" className="notice error"><span>{error}</span><button className="text-button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
        <div className="conversation-grid">
          <section className="character-card" aria-labelledby="character-title">
            <div className="card-top"><span className="eyebrow">{selected === 'alex-first-date' ? 'A CHANCE TO CONNECT' : 'A CHANCE TO GROW'}</span><span className="card-index">{selected === 'alex-first-date' ? '01' : '02'}</span></div>
            <div className={`character-art ${activity === 'speaking' ? 'speaking' : ''}`} aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="character-monogram">{scenario?.character.name[0] ?? 'A'}<span>✳</span></div><span className="art-caption">A VOICE. A PERSPECTIVE. A POSSIBILITY.</span></div>
            <div className="character-copy"><span className="eyebrow">MEET YOUR CONVERSATION PARTNER</span><h2 id="character-title">{scenario?.character.name ?? 'Alex'}</h2><p>{scenario?.character.description ?? 'Loading scenarios…'}</p><div className="traits">{scenario?.character.traits.slice(0, 3).map(t => <span key={t}>{t}</span>)}</div></div>
            <div className="setting"><span>THE SETTING</span><p>{scenario?.setting}</p></div>
            <div className="session-controls">
              <button className="primary-button" disabled={!scenario || connection === 'closing'} onClick={() => { if (busy) void client.current?.disconnect(); else start(); }}>
                <span>{busy ? '■' : atFork ? '⑂' : '↗'}</span>{connection === 'closing' ? 'Ending conversation…' : connection === 'connecting' ? 'Cancel connection' : connection === 'ready' ? 'End conversation' : startLabel}
              </button>
              <div className="mic-row"><button className={`mic-button ${mic ? 'mic-on' : ''}`} disabled={connection !== 'ready' || micBusy} aria-pressed={mic} onClick={async () => { setMicBusy(true); await client.current?.toggleMic(); setMicBusy(false); }}>{mic ? '● Microphone on · Mute' : connection === 'ready' ? '○ Microphone off · Unmute' : '○ Microphone starts automatically'}</button><meter aria-label="Microphone level" min={0} max={1} value={Math.min(1, level * 4)}/></div>
              <p className="control-note">{connection === 'ready' ? path.length ? `${name} remembers the conversation so far. Speak or type to carry on.` : 'Say hello, or type a message below. You can interrupt naturally.'
                : atFork ? `${name} remembers everything up to the branch point. Say something different this time.`
                : path.length ? 'Click one of your own lines to revert to that point.' : 'A live voice conversation, at your own pace.'}</p>
            </div>
          </section>
          <section className={`transcript-card ${Object.keys(tree.nodes).length ? 'has-tree' : ''}`} aria-labelledby="transcript-title">
            <div className="transcript-header"><div><span className="eyebrow">IN THE MOMENT</span><h2 id="transcript-title">Your conversation</h2></div><button className="export-button" disabled={!session || exporting} onClick={() => void exportConversation()}>{exporting ? 'Saving…' : '↓ Export JSON'}</button></div>
            <div className="live-indicator"><span className={`status-dot ${connection === 'ready' ? 'live' : ''}`}/>{connection === 'ready' ? activity === 'speaking' ? `${scenario?.character.name} is speaking` : activity === 'thinking' ? 'Considering your response' : mic ? 'Listening to you' : 'Microphone is off' : 'Your space to explore'}<span>{path.length ? `${path.length} lines` : 'USER SPEAKS FIRST'}</span></div>
            <div className="transcript-scroll" role="log" aria-label="Conversation transcript" aria-live="polite" aria-relevant="additions text">
              {!path.length && !atFork ? <div className="empty-transcript"><div className="sound-bars" aria-hidden="true">{[12, 24, 38, 57, 32, 65, 44, 26, 40, 19, 10].map((h,i) => <i key={i} style={{ height: h }}/>)}</div><h3>Good conversations<br/>begin with a little curiosity.</h3><p>Start your session, then speak or type,<br/>and see what a simple hello can become.</p><span className="empty-line"/></div>
                : <>{path.map(t => {
                  // Only your own lines can be reverted, and only once the conversation has ended.
                  const revertable = t.role === 'user' && Boolean(t.text) && !busy; const open = selectedLine === t.id;
                  return <article className={`turn ${t.role} ${open ? 'selected' : ''}`} key={t.id}><div className="turn-heading"><strong>{t.role === 'user' ? 'YOU' : name.toUpperCase()}</strong><time>{new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
                    {revertable ? <button className="turn-text" aria-expanded={open} title="Revert to this point" onClick={() => setSelectedLine(open ? null : t.id)}>{lineText(t)}</button> : <p>{lineText(t)}</p>}
                    {open && <div className="revert-row"><button className="revert-button" onClick={() => revert(t.id)}>⟲ Revert to this point</button><small>{name}'s line before this stays. You say something new from there.</small></div>}
                    {t.status === 'interrupted' && <small className="turn-note">Interrupted · {(t.playedMs ?? 0).toFixed(0)} ms played · Generated text may include unheard words.</small>}{t.status === 'incomplete' && <small className="turn-note">{t.transcriptionFailed ? 'Speech occurred, but its transcript failed.' : 'Session ended before this turn was finalized.'}</small>}</article>;
                })}{atFork && <div className="branch-marker">⑂ Branch point. Click <b>Start new branch</b> and say something different. The earlier branch is kept in the tree below.</div>}</>}<div ref={transcriptEnd}/>
            </div>
            {Object.keys(tree.nodes).length > 0 && <TreeView tree={tree} characterName={scenario?.character.name ?? 'Alex'} selectedId={selectedLine} disabled={busy}
              onSelect={setSelectedLine} onRevert={revert} onClear={clearTree}/>}
            <form className="composer" onSubmit={sendDraft}>
              <input aria-label="Type a message" placeholder={connection === 'ready' ? `Type a message to ${name}…` : 'Start the conversation to type a message'}
                value={draft} disabled={connection !== 'ready'} onChange={e => setDraft(e.target.value)}/>
              <button type="submit" disabled={connection !== 'ready' || !draft.trim()}>Send ↗</button>
            </form>
            <div className="transcript-footer"><span>{recording ?? (session ? 'Recorded in local server memory' : 'Transcripts appear here as you talk')}</span><span>◌</span></div>
          </section>
        </div>
        <footer className="workspace-footer"><span>Stay curious. There is no script.</span><span>POWERED BY BOSON HIGGS REALTIME</span></footer>
      </div>
    </main>
  </div>;
}
