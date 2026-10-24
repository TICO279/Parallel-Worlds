import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Conversation, ProtocolEvent, Scenario, SessionBootstrap, StoredSession } from '../shared/domain';
import { emptyConversation, orderedTurns, reduceTranscript } from '../shared/transcript';
import { HiggsClient, type Activity, type ConnectionState } from './realtime/HiggsClient';
import { api, SessionRecorder } from './recording';
import { AdaptivePanel } from './AdaptivePanel';
import type { AdaptationData, LatencyRecord } from '../shared/characterState';
export function App() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]); const [selected, setSelected] = useState('alex-first-date');
  const [connection, setConnection] = useState<ConnectionState>('idle'); const [activity, setActivity] = useState<Activity>('idle');
  const [mic, setMic] = useState(false); const [level, setLevel] = useState(0); const [micBusy, setMicBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [recording, setRecording] = useState<string | null>(null);
  const [conversation, setConversation] = useState(emptyConversation); const [session, setSession] = useState<StoredSession | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null); const [exporting, setExporting] = useState(false);
  const [draft, setDraft] = useState('');
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const [mode, setMode] = useState<'static' | 'adaptive'>('static'); const modeRef = useRef(mode); modeRef.current = mode;
  const [adaptation, setAdaptation] = useState<AdaptationData | null>(null);
  const [latency, setLatency] = useState<LatencyRecord | null>(null); const [adaptationNotice, setAdaptationNotice] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const client = useRef<HiggsClient | null>(null); const state = useRef<Conversation>(emptyConversation());
  const recorder = useRef<SessionRecorder | null>(null); const recorders = useRef<SessionRecorder[]>([]);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let mounted = true;
    void Promise.all([api<Scenario[]>('/api/scenarios'), api<{ credentialsConfigured: boolean }>('/api/health')])
      .then(([list, health]) => { if (mounted) { setScenarios(list); setConfigured(health.credentialsConfigured); } })
      .catch(() => { if (mounted) setError('Cannot reach the local server. Start the application with pnpm dev.'); });
    const c = new HiggsClient({
      bootstrap: signal => api<SessionBootstrap>('/api/sessions', { method: 'POST', signal, body: JSON.stringify({ scenarioId: selectedRef.current, mode: modeRef.current }) }),
      onBootstrap: data => {
        state.current = emptyConversation(); setConversation(state.current); setSession(data.session);
        sessionIdRef.current = data.session.id; setAdaptation(data.session.adaptation ?? null); setLatency(null); setAdaptationNotice(null);
        const r = new SessionRecorder(data.session.id, message => { if (recorder.current === r && mounted) setRecording(message); });
        recorder.current = r; recorders.current.push(r);
      },
      onState: s => { if (mounted) { setConnection(s); if (s === 'closed') setMicBusy(false); } }, onActivity: a => { if (mounted) setActivity(a); },
      onError: m => { if (mounted) setError(m); }, onMic: b => { if (mounted) setMic(b); }, onLevel: n => { if (mounted) setLevel(n); },
      onApplication: (version, status) => {
        const id = sessionIdRef.current; if (!id) return;
        if (status === 'failed' && mounted) setAdaptationNotice('Guidance update was not acknowledged. State remains recorded; live updates are paused for this session.');
        void api(`/api/sessions/${id}/adaptation/application`, { method: 'POST', body: JSON.stringify({ version, status }) })
          .catch(() => { if (mounted) setAdaptationNotice('Could not record the guidance acknowledgement.'); });
      },
      onLatency: metric => {
        if (mounted) setLatency(metric);
        const id = sessionIdRef.current; if (!id) return;
        void api(`/api/sessions/${id}/latencies`, { method: 'POST', body: JSON.stringify(metric) })
          .catch(() => { if (mounted) setAdaptationNotice('Could not record a latency measurement.'); });
      },
      onEvent: (e: ProtocolEvent) => {
        if (e.type === 'session.created' || e.type === 'session.updated') {
          const s = e.session as { id?: string } | undefined;
          recorder.current?.status('active', s?.id);
        }
        if (e.type === 'client.session_end' && mounted) setError(String(e.message));
        state.current = reduceTranscript(state.current, e, Date.now());
        if (mounted) setConversation(state.current);
        if (e.type.endsWith('.completed') || e.type.endsWith('.failed') || e.type.endsWith('.done') ||
          ['client.interrupted', 'client.closed', 'input_audio_buffer.committed', 'conversation.item.added'].includes(e.type))
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
  useEffect(() => {
    if (!session || connection !== 'ready' || session.adaptation?.mode !== 'adaptive') return;
    let cancelled = false; let running = false; const controller = new AbortController();
    const poll = async () => {
      if (running || cancelled) return; running = true;
      try {
        const data = await api<AdaptationData & { prepared: { version: number; instructions: string } }>(`/api/sessions/${session.id}/adaptation`, { signal: controller.signal });
        if (!cancelled) { setAdaptation(data); client.current?.queueInstructions(data.prepared.version, data.prepared.instructions); }
      } catch { if (!cancelled) setAdaptationNotice('Adaptive state is temporarily unavailable. The voice conversation can continue.'); }
      finally { running = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 500);
    return () => { cancelled = true; controller.abort(); clearInterval(timer); };
  }, [session?.id, connection]);
  useEffect(() => { if (conversation.order.length) transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [conversation]);
  const scenario = scenarios.find(s => s.id === selected); const sessionScenario = scenarios.find(s => s.id === session?.scenarioId) ?? scenario;
  const busy = connection === 'connecting' || connection === 'ready' || connection === 'closing';
  function sendDraft(event: FormEvent) {
    event.preventDefault();
    if (client.current?.sendText(draft)) setDraft('');
  }
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
  const turns = orderedTurns(conversation);
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Parallel Worlds home"><span className="brand-symbol">◒</span><span>parallel<br/>worlds<span className="brand-period">.</span></span></a>
      <div className="sidebar-intro"><span className="eyebrow">THE CONVERSATION LAB</span><p>A different connection.<br/>A world of possibility.</p></div>
      <div className="scenario-label"><span className="eyebrow">CHOOSE YOUR SCENARIO</span><span>01 — 02</span></div>
      <label className="mode-selector">Conversation mode<select value={mode} disabled={busy} onChange={e => setMode(e.target.value as 'static' | 'adaptive')}><option value="static">Static · original behavior</option><option value="adaptive">Adaptive · future responses</option></select></label>
      <nav aria-label="Scenarios" className="scenario-list">{scenarios.map((s, i) => <button key={s.id} disabled={busy} aria-pressed={selected === s.id}
        className={`scenario-option ${selected === s.id ? 'selected' : ''}`} onClick={() => setSelected(s.id)}>
        <span className="scenario-number">0{i + 1}</span><span><strong>{s.title}</strong><small>{i === 0 ? 'Connection & curiosity' : 'Clarity & confidence'}</small></span><span className="option-arrow">↗</span>
      </button>)}</nav>
      <div className="sidebar-note"><span className="small-orbit">✳</span><p>Every conversation starts<br/>with being present.</p></div>
      <footer className="sidebar-footer"><span className="status-dot"/> PHASE 02 <span>ADAPTIVE CHARACTERS</span></footer>
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
              <button className="primary-button" disabled={!scenario || connection === 'closing'} onClick={() => { if (busy) void client.current?.disconnect(); else { setError(null); setRecording(null); void client.current?.connect(); } }}>
                <span>{busy ? '■' : '↗'}</span>{connection === 'closing' ? 'Ending conversation…' : connection === 'connecting' ? 'Cancel connection' : connection === 'ready' ? 'End conversation' : 'Start conversation'}
              </button>
              <div className="mic-row"><button className={`mic-button ${mic ? 'mic-on' : ''}`} disabled={connection !== 'ready' || micBusy} aria-pressed={mic} onClick={async () => { setMicBusy(true); await client.current?.toggleMic(); setMicBusy(false); }}>{mic ? '● Microphone on' : '○ Enable microphone'}</button><meter aria-label="Microphone level" min={0} max={1} value={Math.min(1, level * 4)}/></div>
              <p className="control-note">{connection === 'ready' ? mic ? 'Speak naturally. Turn the microphone off to type instead.' : 'Type a message, or enable your microphone and say hello.' : 'A live voice conversation, at your own pace.'}</p>
            </div>
          </section>
          <section className="transcript-card" aria-labelledby="transcript-title">
            <div className="transcript-header"><div><span className="eyebrow">IN THE MOMENT</span><h2 id="transcript-title">Your conversation</h2></div><button className="export-button" disabled={!session || exporting} onClick={() => void exportConversation()}>{exporting ? 'Saving…' : '↓ Export JSON'}</button></div>
            <div className="live-indicator"><span className={`status-dot ${connection === 'ready' ? 'live' : ''}`}/>{connection === 'ready' ? activity === 'speaking' ? `${scenario?.character.name} is speaking` : activity === 'thinking' ? 'Considering your response' : mic ? 'Listening to you' : 'Microphone is off' : 'Your space to explore'}<span>{turns.length ? `${turns.length} turns` : 'USER SPEAKS FIRST'}</span></div>
            <div className="transcript-scroll" role="log" aria-label="Conversation transcript" aria-live="polite" aria-relevant="additions text">
              {!turns.length ? <div className="empty-transcript"><div className="sound-bars" aria-hidden="true">{[12, 24, 38, 57, 32, 65, 44, 26, 40, 19, 10].map((h,i) => <i key={i} style={{ height: h }}/>)}</div><h3>Good conversations<br/>begin with a little curiosity.</h3><p>Start your session, then type or turn on your microphone,<br/>and see what a simple hello can become.</p><span className="empty-line"/></div>
                : turns.map(t => <article className={`turn ${t.role}`} key={t.itemId}><div className="turn-heading"><strong>{t.role === 'user' ? 'YOU' : sessionScenario?.character.name.toUpperCase()}</strong><time>{new Date(t.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>{t.text || (t.transcriptionFailed ? '[Transcription unavailable]' : t.role === 'user' && t.status !== 'incomplete' ? 'Transcribing…' : t.status === 'incomplete' ? '[Turn unfinished]' : '…')}</p>{t.status === 'interrupted' && <small className="turn-note">Interrupted · {(t.playedMs ?? 0).toFixed(0)} ms played · Generated text may include unheard words.</small>}{t.status === 'incomplete' && <small className="turn-note">{t.transcriptionFailed ? 'Speech occurred, but its transcript failed.' : 'Session ended before this turn was finalized.'}</small>}</article>)}<div ref={transcriptEnd}/>
            </div>
            <form className="composer" onSubmit={sendDraft}>
              <input aria-label="Type a message" value={draft} disabled={connection !== 'ready' || mic} onChange={e => setDraft(e.target.value)}
                placeholder={connection !== 'ready' ? 'Start the conversation to type a message' : mic ? 'Microphone is on. Turn it off to type.' : `Type a message to ${sessionScenario?.character.name ?? 'Alex'}…`}/>
              <button type="submit" disabled={connection !== 'ready' || mic || !draft.trim()}>Send ↗</button>
            </form>
            <div className="transcript-footer"><span>{recording ?? (session ? 'Recorded in local server memory' : 'Transcripts appear here as you talk')}</span><span>◌</span></div>
          </section>
        </div>
        <AdaptivePanel character={sessionScenario?.character.name ?? 'Alex'} data={adaptation} latency={latency} notice={adaptationNotice}/>
        <footer className="workspace-footer"><span>Stay curious. There is no script.</span><span>POWERED BY BOSON HIGGS REALTIME</span></footer>
      </div>
    </main>
  </div>;
}
