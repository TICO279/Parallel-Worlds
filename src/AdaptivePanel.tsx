import { metricNames, type AdaptationData, type DynamicCharacterState, type LatencyRecord } from '../shared/characterState';
export function AdaptivePanel({ character, data, latency, notice, mode = 'static', connected = false, preview, restored = false }: {
  character: string; data: AdaptationData | null; latency: LatencyRecord | null; notice: string | null;
  mode?: 'static' | 'adaptive'; connected?: boolean; preview?: DynamicCharacterState; restored?: boolean;
}) {
  const adaptive = data ? data.mode === 'adaptive' : mode === 'adaptive';
  const state = preview ?? (adaptive ? data?.states.at(-1) : undefined); const attempt = preview ? undefined : data?.attempts.at(-1);
  const prior = preview ? undefined : data?.states.at(-2);
  const acknowledged = preview ? undefined : data?.states.find(s => s.version === data.appliedVersion);
  const realism = state?.realism; const assessment = realism?.assessment;
  const duration = (end?: number, start?: number) => end !== undefined && start !== undefined && end >= start ? `${Math.round(end - start)} ms` : '—';
  return <details className="adaptive-panel"><summary>Character scores · development view <span>{preview ? 'Saved branch checkpoint' : adaptive ? connected ? 'Adaptive · live' : data ? 'Adaptive · saved scores' : 'Adaptive · ready to start' : 'Static · scores paused'}</span></summary>
    <div className="adaptive-body">
      <p><strong>{character}</strong> · {preview ? `Saved state v${preview.version}` : data?.mode === 'adaptive' ? `${data.provider} appraisal${data.model ? ` (${data.model})` : ''} · committed v${state?.version ?? 0} / Boson acknowledged v${data.appliedVersion}` : adaptive ? 'appraisal starts after connection' : 'appraisal disabled'}{data?.pending ? ' · appraising…' : ''}</p>
      {!adaptive && !preview && <p role="status">Static mode does not appraise turns or update scores. Select Adaptive before starting a new conversation to enable score updates.</p>}
      {adaptive && !state && <p role="status">Start an Adaptive conversation to load its scores. Scores update after finalized user turns are recorded and appraised.</p>}
      {attempt?.status === 'failed' && <p role="alert" className="adaptation-warning">Appraisal failed: {attempt.error} Previous scores were retained.{attempt.error?.includes('timed out') ? ' Check APPRAISAL_TIMEOUT_MS; live providers may need a longer deadline.' : ''}</p>}
      {state && <p role="status">{preview ? 'Checkpoint preview. This is not a live reading.' : data?.pending ? 'Appraisal in progress. Showing the last committed scores.' : state.version === 0 ? restored ? 'Restored branch scores; waiting for the first new appraisal.' : 'Initial scores; no new successful appraisal in this session yet.' : `Scores last updated for user turn ${state.lastProcessedTurnId}.`}</p>}
      <p className="adaptive-disclaimer">Internal simulation variables. Acknowledged guidance does not prove emotional realism. Adaptive updates apply asynchronously to future responses; synchronous control is not enabled.</p>
      {state && <><div className="state-metrics">{metricNames.map(name => {
        const delta = prior ? Math.round((state[name] - prior[name]) * 100) : undefined;
        return <label key={name}>{name}<meter min={0} max={100} value={state[name] * 100}/><b>{Math.round(state[name] * 100)} / 100</b>
          {delta !== undefined && <small> · {delta > 0 ? '+' : ''}{delta} points</small>}
          {acknowledged && acknowledged.version !== state.version && <small><br/>Boson acknowledged: {Math.round(acknowledged[name] * 100)}</small>}</label>;
      })}</div>
        <p><strong>Tone:</strong> {state.tone} · <strong>Goal:</strong> {state.goal}</p>
        <p><strong>{realism ? 'Recorded appraisal guidance:' : 'Guidance:'}</strong> {state.guidance || 'Initial character guidance.'}</p>
        {realism && assessment && <details className="realism-details"><summary>Interpretation, tone and memory · v{realism.schemaVersion}</summary>
          <p><strong>Private assessment:</strong> {assessment.interpretation}</p>
          <p><strong>Uncertainty:</strong> {assessment.uncertainty.level} · {assessment.uncertainty.reason}</p>
          <p><strong>Mixed reaction:</strong> {assessment.reaction.positive || 'No specific positive signal.'} {assessment.reaction.negative} {assessment.reaction.unresolved}</p>
          <p><strong>Expectation:</strong> {assessment.expectation.prior} → {assessment.expectation.update}<br/><strong>Alternative interpretation:</strong> {assessment.expectation.alternative}</p>
          <p><strong>Competing motives:</strong> {assessment.motives.approach} / {assessment.motives.protect}</p>
          <p><strong>Conversational move:</strong> {assessment.brief.move} · {assessment.brief.expression} expression · {assessment.brief.stance}<br/>
            <strong>Intent:</strong> {assessment.brief.intent}<br/><strong>Avoid:</strong> {assessment.brief.avoid}</p>
          <p className="adaptive-disclaimer">Automatic mode applies ongoing concerns and expression guidance. Turn-specific suggestions are saved for inspection and expire; they are not commands to repeat an earlier response.</p>
          <p><strong>Evidence:</strong> {assessment.evidence.map(e => `“${e.quote}” (${e.turnId.split('/').at(-1)})`).join('; ')}</p>
          <p><strong>Active memory:</strong> {realism.memory.filter(n => n.status === 'active').length} / {data?.memoryCapacity ?? 8}</p>
          <ul className="realism-memory">{realism.memory.filter(n => n.status === 'active').map(n => <li key={n.id}>{n.category}: {n.text}{n.category === 'boundary_pressure' ? ` · repair evidence ${n.progress}/2` : ''}</li>)}</ul>
          {realism.policy.length > 0 && <p><strong>Transition policy:</strong> {realism.policy.join(' ')}</p>}
          {data?.instructionHistory?.at(-1) && <p><strong>Saved instruction context:</strong> {data.instructionHistory.at(-1)!.contextHash.slice(0, 12)} · {data.applications.at(-1)?.status ?? 'not dispatched yet'}</p>}
        </details>}
        {!preview && <><p><strong>Last event:</strong> {attempt?.appraisal?.interpretation ?? attempt?.error ?? 'No completed appraisal yet.'}</p>
        <p><strong>Appraisal:</strong> {attempt ? `${attempt.latencyMs} ms (${attempt.status})` : '—'} · timeout {data?.appraisalTimeoutMs} ms · maximum numeric step ±{data?.maxStateDelta.toFixed(2)}</p></>}</>}
      {adaptive && !preview && <p><strong>Last appraisal tokens:</strong> {attempt?.usage ? `${attempt.usage.inputTokens} input + ${attempt.usage.outputTokens} output = ${attempt.usage.totalTokens} total${attempt.usage.cachedInputTokens !== undefined ? ` · ${attempt.usage.cachedInputTokens} cached input` : ''}` : data?.provider === 'mock' ? 'Not used by mock appraisal.' : 'Unavailable; missing usage is not counted as zero.'}</p>}
      {latency?.responseCreatedAt !== undefined && <p><strong>Guidance acknowledged before the latest reply:</strong> v{latency.appliedStateVersion}. Later updates do not change a reply already generated.</p>}
      {latency?.guidanceUncertain && <p role="status" className="adaptation-warning">An instruction update overlapped this turn. Which guidance affected this reply is uncertain.</p>}
      <p><strong>{latency?.inputKind === 'text' ? 'Message sent' : latency?.speechEndedAt !== undefined ? 'Speech-end estimate' : 'VAD stop notification'} → first audio received:</strong> {duration(latency?.firstAudioAt, latency?.speechEndedAt ?? latency?.speechStoppedAt)}<br/>
        <strong>End-to-end to playback started:</strong> {duration(latency?.playbackStartedAt, latency?.speechEndedAt ?? latency?.speechStoppedAt)}<br/>
        <strong>Transcription delay:</strong> {duration(latency?.transcriptFinalAt, latency?.speechEndedAt ?? latency?.speechStoppedAt)}</p>
      <p className="adaptive-disclaimer">Measured using the browser’s monotonic clock and worklet start notification. Typed input starts at message send. Speech end is estimated from Boson’s audio_end_ms and sent PCM timing; fallback starts at the VAD stop notification. Device output latency is not measurable here.</p>
      {notice && <p role="status" className="adaptation-warning">{notice}</p>}
    </div>
  </details>;
}
