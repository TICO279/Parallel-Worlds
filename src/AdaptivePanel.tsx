import { metricNames, type AdaptationData, type LatencyRecord } from '../shared/characterState';
export function AdaptivePanel({ character, data, latency, notice }: {
  character: string; data: AdaptationData | null; latency: LatencyRecord | null; notice: string | null;
}) {
  const state = data?.states.at(-1); const attempt = data?.attempts.at(-1);
  const duration = (end?: number, start?: number) => end !== undefined && start !== undefined && end >= start ? `${Math.round(end - start)} ms` : '—';
  return <details className="adaptive-panel"><summary>Character state · development view <span>{data?.mode === 'adaptive' ? 'Adaptive · future responses' : 'Static mode'}</span></summary>
    <div className="adaptive-body">
      <p><strong>{character}</strong> · {data?.mode === 'adaptive' ? `${data.provider} appraisal${data.model ? ` (${data.model})` : ''}` : 'appraisal disabled'} · committed v{state?.version ?? 0} / acknowledged v{data?.appliedVersion ?? 0}{data?.pending ? ' · appraising…' : ''}</p>
      <p className="adaptive-disclaimer">Internal simulation variables. Acknowledged guidance does not prove emotional realism. Adaptive updates apply asynchronously to future responses; synchronous control is not enabled.</p>
      {state && <><div className="state-metrics">{metricNames.map(name => <label key={name}>{name}<meter min={0} max={1} value={state[name]}/><b>{state[name].toFixed(2)}</b></label>)}</div>
        <p><strong>Tone:</strong> {state.tone} · <strong>Goal:</strong> {state.goal}</p>
        <p><strong>Guidance:</strong> {state.guidance || 'Initial character guidance.'}</p>
        <p><strong>Last event:</strong> {attempt?.appraisal?.interpretation ?? attempt?.error ?? 'No completed appraisal yet.'}</p>
        <p><strong>Appraisal:</strong> {attempt ? `${attempt.latencyMs} ms (${attempt.status})` : '—'} · timeout {data?.appraisalTimeoutMs} ms · maximum numeric step ±{data?.maxStateDelta.toFixed(2)}</p></>}
      <p><strong>Last appraisal tokens:</strong> {attempt?.usage ? `${attempt.usage.inputTokens} input + ${attempt.usage.outputTokens} output = ${attempt.usage.totalTokens} total${attempt.usage.cachedInputTokens !== undefined ? ` · ${attempt.usage.cachedInputTokens} cached input` : ''}` : data?.provider === 'mock' ? 'Not used by mock appraisal.' : 'Unavailable; missing usage is not counted as zero.'}</p>
      <p><strong>{latency?.speechEndedAt !== undefined ? 'Speech-end estimate' : 'VAD stop notification'} → first audio received:</strong> {duration(latency?.firstAudioAt, latency?.speechEndedAt ?? latency?.speechStoppedAt)}<br/>
        <strong>End-to-end to playback started:</strong> {duration(latency?.playbackStartedAt, latency?.speechEndedAt ?? latency?.speechStoppedAt)}<br/>
        <strong>Transcription delay:</strong> {duration(latency?.transcriptFinalAt, latency?.speechEndedAt ?? latency?.speechStoppedAt)}</p>
      <p className="adaptive-disclaimer">Measured using the browser’s monotonic clock, sent PCM timing and the worklet start notification. Speech end is estimated from Boson’s audio_end_ms; fallback starts at the VAD stop notification. Device output latency is not measurable here.</p>
      {notice && <p role="status" className="adaptation-warning">{notice}</p>}
    </div>
  </details>;
}
