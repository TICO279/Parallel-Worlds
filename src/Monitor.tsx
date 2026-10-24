import { useEffect, useRef, useState } from 'react';
import type { TreeNode } from '../shared/domain';
import { emptyTree, pathTo, treeFromSessions } from '../shared/tree';
import { APP_VERSION } from './version';
import { api } from './recording';
import { AdaptivePanel } from './AdaptivePanel';
import { TreeView } from './TreeView';
import { isLive, lastActivity, latestSession, majorTurns, newestFirst, type EmberDate } from './monitorData';
const lineText = (n: TreeNode) => n.text || (n.transcriptionFailed ? '[Transcription unavailable]'
  : n.role === 'user' && n.status !== 'incomplete' ? 'Transcribing…' : n.status === 'incomplete' ? '[Turn unfinished]' : '…');
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function ago(at: number) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : time(at);
}

/** The web page watches the phone: every first date, live, with its branches and how your date feels. Read-only. */
export function Monitor() {
  const [dates, setDates] = useState<EmberDate[]>([]); const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A partner you picked in the sidebar; null follows whoever the phone is dating now.
  const [pinned, setPinned] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        setDates(await api<EmberDate[]>('/api/ember/dates', { signal: controller.signal })); setError(null);
      } catch { if (!controller.signal.aborted) setError('Cannot reach the local server. Start the application with pnpm dev.'); }
      if (!controller.signal.aborted) { setLoaded(true); timer = setTimeout(() => void poll(), 1000); }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  const ordered = newestFirst(dates);
  const date = (pinned ? ordered.find(d => d.scenario.id === pinned) : undefined) ?? ordered[0];
  const session = date && latestSession(date); const live = isLive(session);
  const tree = date ? treeFromSessions(date.sessions) : emptyTree(); const path = pathTo(tree, tree.headId);
  const stars = date ? majorTurns(date.sessions) : new Set<string>();
  const name = date?.scenario.character.name ?? 'your date';
  const following = pinned === null || pinned === ordered[0]?.scenario.id;
  useEffect(() => { transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [path.length, date?.scenario.id]);

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Open the phone version"><span className="brand-symbol">◒</span><span>parallel<br/>worlds<span className="brand-period">.</span></span></a>
      <div className="sidebar-intro"><span className="eyebrow">THE DATE MONITOR</span><p>Watching the phone,<br/>live.</p></div>
      <div className="scenario-label"><span className="eyebrow">DATES FROM THE PHONE</span><span>{String(ordered.length).padStart(2, '0')}</span></div>
      <nav aria-label="Dates" className="scenario-list">{ordered.map((d, i) => {
        const latest = latestSession(d); const on = d.scenario.id === date?.scenario.id;
        return <button key={d.scenario.id} aria-pressed={on} className={`scenario-option ${on ? 'selected' : ''}`}
          onClick={() => { setPinned(i === 0 ? null : d.scenario.id); setSelectedLine(null); }}>
          <span className="scenario-number">0{i + 1}</span>
          <span><strong>{d.scenario.title}</strong><small>{isLive(latest) ? '● Live on the phone' : `Last seen ${ago(lastActivity(d))}`}</small></span>
          <span className="option-arrow">↗</span>
        </button>;
      })}</nav>
      {!following && <button className="follow-button" onClick={() => setPinned(null)}>↻ Follow the phone</button>}
      <div className="sidebar-note"><span className="small-orbit">✳</span><p>The phone talks.<br/>This page listens.</p></div>
      <footer className="sidebar-footer"><span className="status-dot"/> <span className="app-version">{APP_VERSION}</span> <span>MONITOR</span></footer>
    </aside>
    <main>
      <header className="topbar"><span>EMBER / <b>FIRST DATE MONITOR</b></span>
        <span className={`connection-pill ${live ? 'connected' : ''}`}><span className="status-dot"/>{live ? 'Live on the phone' : session ? `Phone idle · ${ago(session.updatedAt)}` : 'Waiting for the phone'}</span></header>
      <div className="workspace">
        <div className="page-heading"><div><span className="eyebrow">RUNNING IN PARALLEL WITH THE PHONE</span>
          <h1>{date ? <>{date.scenario.title}<span>.</span></> : <>Nothing to watch yet<span>.</span></>}</h1>
          <p>{date ? `Every line from the phone appears here as it happens, with each branch and how ${name} feels.` : 'Open the phone version, tap the Parallel Worlds button on a profile, and the date shows up here live.'}</p></div>
          <span className="edition">PW / MONITOR<br/><b>READ ONLY</b></span></div>
        {error && <div role="alert" className="notice error"><span>{error}</span></div>}
        {loaded && !date && !error && <div className="notice">Phone version: <code>{window.location.origin}/</code>. Dates you start there are listed on the left.</div>}
        {date && <>
          <div className="conversation-grid">
            <section className="character-card" aria-labelledby="character-title">
              <div className="card-top"><span className="eyebrow">{live ? 'ON A DATE NOW' : 'MET ON EMBER'}</span><span className="card-index">{String(date.sessions.length).padStart(2, '0')} SESSIONS</span></div>
              <div className={`character-art ${live && session?.status === 'active' ? 'speaking' : ''}`} aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/>
                {date.scenario.image ? <img className="character-photo" src={date.scenario.image} alt="" /> : <div className="character-monogram">{name[0]}<span>✳</span></div>}
                <span className="art-caption">WHAT THEY KNOW COMES FROM BOTH PROFILES.</span></div>
              <div className="character-copy"><span className="eyebrow">YOUR DATE</span><h2 id="character-title">{name}</h2><p>{date.scenario.character.description}</p>
                <div className="traits">{date.scenario.character.traits.slice(0, 4).map(t => <span key={t}>{t}</span>)}</div></div>
              <div className="setting"><span>THE SETTING</span><p>{date.scenario.setting}</p></div>
              <div className="session-controls">
                <p className="control-note">{live ? `The phone is connected. ${name}'s replies and your lines arrive here within a second.`
                  : 'The phone is not connected. Rewinds and new branches appear here when the phone starts again.'}</p>
                {session && <a className="restart-button monitor-export" href={`/api/sessions/${session.id}/export`} download>↓ Export the latest session (JSON)</a>}
              </div>
            </section>
            <section className="transcript-card has-tree" aria-labelledby="transcript-title">
              <div className="transcript-header"><div><span className="eyebrow">AS IT HAPPENS</span><h2 id="transcript-title">The current branch</h2></div></div>
              <div className="live-indicator"><span className={`status-dot ${live ? 'live' : ''}`}/>{live ? 'Following the phone' : 'Saved conversation'}<span>{path.length} LINES</span></div>
              <div className="transcript-scroll" role="log" aria-label="Conversation transcript" aria-live="polite" aria-relevant="additions text">
                {!path.length ? <div className="empty-transcript"><h3>Nobody has spoken yet.</h3><p>{live ? `${name} may open, or say hi from the phone.` : 'Start the date on the phone.'}</p><span className="empty-line"/></div>
                  : path.map(t => <article className={`turn ${t.role}`} key={t.id}>
                    <div className="turn-heading"><strong>{t.role === 'user' ? 'YOU' : name.toUpperCase()}</strong>
                      {stars.has(t.id) && <span className="star-note">★ shifted how they feel</span>}<time>{time(t.createdAt)}</time></div>
                    <p>{lineText(t)}</p>
                    {t.status === 'interrupted' && <small className="turn-note">Interrupted · {(t.playedMs ?? 0).toFixed(0)} ms played · not replayed after a rewind.</small>}
                  </article>)}
                <div ref={transcriptEnd}/>
              </div>
              {Object.keys(tree.nodes).length > 0 && <TreeView tree={tree} characterName={name} selectedId={selectedLine} disabled={false} readOnly
                onSelect={setSelectedLine} onRevert={() => {}} onContinue={() => {}} onClear={() => {}}/>}
            </section>
          </div>
          <AdaptivePanel character={name} data={session?.adaptation ?? null} latency={session?.adaptation?.latencies.at(-1) ?? null}
            connected={live} restored={Boolean(session?.branch?.restoredFrom)} notice={session?.branch?.notice ?? null}/>
        </>}
        <footer className="workspace-footer"><span>The phone talks. This page listens.</span><span>POWERED BY BOSON HIGGS REALTIME</span></footer>
      </div>
    </main>
  </div>;
}
