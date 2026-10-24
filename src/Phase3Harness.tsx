import { useEffect,useRef,useState } from 'react';
import { Phase3Client,Phase3ApiError,replayEvents,type Overview,type AnalysisStatus,type Suggestion } from '../shared/phase3-client';
import type { DurableBootstrap,TimelineNode,RestoreQualification } from '../shared/phase3';
import type { ComparisonResult } from '../shared/evaluation';
import { dimensions } from '../shared/evaluation';
import { emptyConversation,reduceTranscript,orderedTurns } from '../shared/transcript';
import { HiggsClient,type ConnectionState,type Activity } from './realtime/HiggsClient';
import { api,SessionRecorder } from './recording';
import { pollAdaptation } from './adaptationPolling';
import type { ProtocolEvent } from '../shared/domain';
import './phase3.css';

/** Deliberately small backend test harness. The separately developed product UI consumes the same SDK. */
export function Phase3Harness(){
  const sdk=useRef(new Phase3Client()).current;
  const [overview,setOverview]=useState<Overview|null>(null),overviewRef=useRef<Overview|null>(null);
  const [selected,setSelected]=useState(''),selectedRef=useRef('');
  const [nodes,setNodes]=useState<TimelineNode[]>([]),[preview,setPreview]=useState<TimelineNode|null>(null);
  const [connection,setConnection]=useState<ConnectionState>('idle'),[activity,setActivity]=useState<Activity>('idle');
  const [mic,setMic]=useState(false),[level,setLevel]=useState(0),[error,setError]=useState(''),[warning,setWarning]=useState('');
  const [pending,setPending]=useState(false),[qualification,setQualification]=useState<RestoreQualification|null>(null);
  const [suggestion,setSuggestion]=useState<Suggestion|null>(null),[job,setJob]=useState<AnalysisStatus|null>(null),[bootId,setBootId]=useState('');
  const client=useRef<HiggsClient|null>(null),boot=useRef<DurableBootstrap|null>(null),recorder=useRef<SessionRecorder|null>(null);
  const transcript=useRef(emptyConversation()),mounted=useRef(true);
  function select(id:string){selectedRef.current=id;setSelected(id);setPreview(null);setSuggestion(null);}
  async function refresh(id=overviewRef.current?.conversation.id,branchId=selectedRef.current){
    if(!id)return;const data=await sdk.get(id);if(!mounted.current||overviewRef.current?.conversation.id!==id)return;
    overviewRef.current=data;setOverview(data);const branch=branchId||data.conversation.activeBranchId;
    const page=await sdk.timeline(branch);if(!mounted.current||selectedRef.current!==branch)return;setNodes(page.nodes);
    const s=await sdk.suggestion(branch);if(mounted.current&&selectedRef.current===branch)setSuggestion(s.suggestion);
  }
  async function create(){
    const data=await sdk.create('alex-first-date'),next={schemaVersion:1 as const,conversation:data.conversation,branches:[data.branch]};
    overviewRef.current=next;setOverview(next);select(data.branch.id);setNodes([]);setJob(null);return next;
  }
  useEffect(()=>{
    mounted.current=true;
    void(async()=>{try{
      const info=await sdk.bootstrap();if(!mounted.current)return;setQualification(info.qualification);
      const list=await sdk.list(),last=list.conversations.filter(c=>c.scenarioId==='alex-first-date').at(-1);
      if(last&&mounted.current){const data=await sdk.get(last.id);overviewRef.current=data;setOverview(data);select(data.conversation.activeBranchId);await refresh(last.id,data.conversation.activeBranchId);}
    }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Backend unavailable.');}})();
    const c=new HiggsClient({
      bootstrap:async signal=>{
        if(recorder.current)await recorder.current.waitForSync(signal);
        const data=overviewRef.current??await create(),fresh=await sdk.get(data.conversation.id),branch=selectedRef.current||fresh.conversation.activeBranchId;
        const op=await sdk.restore(fresh.conversation,branch,undefined,signal);return sdk.connectRestore(op.id,undefined,signal);
      },
      onBootstrap:data=>{
        const durable=data as DurableBootstrap;boot.current=durable;setBootId(data.session.id);transcript.current=emptyConversation();
        const transport:typeof api=async(url,options)=>{
          try{return await sdk.transport(url,options);}catch(error){
            if(error instanceof Phase3ApiError&&['STALE_SESSION','IMMUTABLE_TURN','INVALID_ORDER'].includes(error.code)&&recorder.current===r){
              recorder.current=null;r.dispose();setWarning('Recording was rejected as stale. The saved path is intact; unsaved local dialogue is not part of it. Reconnect from server history.');void c.disconnect();
            }throw error;
          }
        };
        const r=new SessionRecorder(data.session.id,message=>{if(mounted.current&&recorder.current===r)setWarning(message??'');},transport,`/api/v1/sessions/${data.session.id}/conversation`);recorder.current=r;
        setNodes(durable.history.map(h=>({id:h.nodeId,role:h.role,text:h.text,status:'complete',rewindable:false})));
      },
      seed:()=>replayEvents(boot.current?.history??[]),
      confirmReady:async signal=>{const current=boot.current;if(!current)throw new Error('No restoration.');current.restoration=await sdk.confirm(current.restoration,'ready',undefined,signal);},
      onState:s=>{if(mounted.current)setConnection(s);},onActivity:a=>{if(mounted.current)setActivity(a);},onMic:v=>{if(mounted.current)setMic(v);},onLevel:v=>{if(mounted.current)setLevel(v);},
      onError:message=>{if(mounted.current)setError(message);if(c.connectionState==='connecting'&&boot.current)void sdk.confirm(boot.current.restoration,'failed').catch(()=>{});},
      onApplication:(version,status)=>{const id=boot.current?.session.id;if(id)void api(`/api/sessions/${id}/adaptation/application`,{method:'POST',body:JSON.stringify({version,status})}).catch(()=>{if(mounted.current)setWarning('Guidance receipt could not be saved.');});},
      onLatency:metric=>{const id=boot.current?.session.id;if(id)void api(`/api/sessions/${id}/latencies`,{method:'POST',body:JSON.stringify(metric)}).catch(()=>{});},
      onEvent:(e:ProtocolEvent)=>{
        if(e.type==='conversation.item.added'&&String((e.item as {id?:string})?.id??'').startsWith('pwseed_'))return;
        if(e.type==='session.created')recorder.current?.status('active',(e.session as {id?:string})?.id);
        transcript.current=reduceTranscript(transcript.current,e,Date.now());
        const current=boot.current;if(!current)return;
        if(mounted.current)setNodes([...current.history.map(h=>({id:h.nodeId,role:h.role,text:h.text,status:'complete' as const,rewindable:false})),
          ...orderedTurns(transcript.current).map(t=>({id:`${current.session.id}/${t.itemId}`,role:t.role,text:t.text,status:t.status,rewindable:false}))]);
        if(e.type.endsWith('.done')||e.type.endsWith('.completed')||e.type.endsWith('.failed')||['conversation.item.added','client.interrupted','client.playback_complete','client.closed','input_audio_buffer.committed'].includes(e.type))
          recorder.current?.snapshot(orderedTurns(transcript.current));
        if(e.type==='client.closed')recorder.current?.status('closed');
      },
    });client.current=c;
    const leave=(event:BeforeUnloadEvent)=>{if(c.connectionState==='ready'||c.connectionState==='connecting'||recorder.current&&!recorder.current.synced)event.preventDefault();};
    window.addEventListener('beforeunload',leave);
    return()=>{mounted.current=false;window.removeEventListener('beforeunload',leave);void c.disconnect().finally(()=>recorder.current?.dispose());};
  },[]);
  useEffect(()=>{
    if(!bootId||connection!=='ready')return;
    return pollAdaptation({load:signal=>api(`/api/sessions/${bootId}/adaptation`,{signal}),onData:data=>client.current?.queueInstructions(data.prepared.version,data.prepared.instructions,{persistentInstructions:data.prepared.persistentInstructions??data.prepared.instructions,triggerTurnId:data.prepared.triggerTurnId}),onError:()=>setWarning('Appraisal updates are unavailable; audio continues.'),keepPolling:()=>true});
  },[bootId,connection]);
  useEffect(()=>{
    if(!overview)return;let active=true;
    const timer=setInterval(()=>{if(active&&(client.current?.connectionState==='closed'||client.current?.connectionState==='idle'))void refresh().catch(()=>{});
      else if(active)void sdk.suggestion(selectedRef.current).then(s=>{if(active)setSuggestion(s.suggestion);}).catch(()=>{});},1500);
    return()=>{active=false;clearInterval(timer);};
  },[overview?.conversation.id,selected]);
  useEffect(()=>{
    if(!job||!['queued','running'].includes(job.status))return;let active=true;
    const timer=setInterval(()=>void sdk.analysis(job.id).then(j=>{if(active)setJob(j);}).catch(()=>{if(active)setError('Analysis status unavailable; retry polling after reconnecting.');}),1000);
    return()=>{active=false;clearInterval(timer);};
  },[job?.id,job?.status]);
  const busy=['connecting','ready','closing'].includes(connection);
  async function action(fn:()=>Promise<unknown>){setPending(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Operation failed.');}finally{setPending(false);}}
  async function end(){await client.current?.disconnect();if(recorder.current)await recorder.current.waitForSync(new AbortController().signal);await refresh();}
  async function rewind(){if(!preview||!overview)return;const fresh=await sdk.get(overview.conversation.id),source=fresh.branches.find(b=>b.id===selected)!;
    const child=await sdk.fork(fresh.conversation.id,source.id,preview.id,source.revision);select(child.id);await refresh(fresh.conversation.id,child.id);}
  const result=job?.status==='succeeded'&&job.kind==='evaluation'?job.result as ComparisonResult:null;
  return <main className="phase3-harness">
    <header><a href="/lab">← Existing conversation lab</a><span>PHASE 3 · INTEGRATION HARNESS</span></header>
    <h1>One choice. Two paths.</h1><p>Alex · backend-owned history. The product frontend is developed separately.</p>
    {error&&<p role="alert" className="notice error">{error}</p>}{warning&&<p role="status" className="notice">{warning}</p>}
    <p className="notice">Context gate: {qualification?.contextQualified?'live text checks passed':'not qualified; saved-path reconnection is blocked'}. Physical microphone rewind: {qualification?.physicalMicrophoneTested?'tested':'not verified'}.</p>
    <div className="phase3-controls"><button disabled={busy||pending} onClick={()=>void action(create)}>New demo</button>
      <label>Path <select aria-label="Conversation path" disabled={busy||pending} value={selected} onChange={e=>{select(e.target.value);void refresh(overview!.conversation.id,e.target.value);}}>
        {overview?.branches.map(b=><option key={b.id} value={b.id}>{b.parentBranchId?'Alternative':'Original'}</option>)}</select></label>
      <button disabled={busy||pending} onClick={()=>void action(async()=>{setPreview(null);boot.current=null;await client.current?.connect();})}>{overview?'Connect / resume':'Start conversation'}</button>
      <button disabled={!busy||pending} onClick={()=>void action(end)}>End conversation</button>
      <button disabled={busy||pending||overview?.branches.length!==1||!nodes.some(n=>n.rewindable)} onClick={()=>setPreview([...nodes].reverse().find(n=>n.rewindable)??null)}>Undo last exchange</button>
      <button disabled={connection!=='ready'||pending} aria-pressed={mic} onClick={()=>void client.current?.toggleMic()}>{mic?'Mute microphone':'Enable microphone'}</button>
      <button disabled={busy||pending||!overview||!nodes.length} onClick={()=>void action(async()=>{await refresh();setJob(await sdk.analyze(overview!.conversation.id,'evaluation'));})}>Evaluate</button>
      <button disabled={busy||pending||!overview} onClick={()=>void action(async()=>{const data=await sdk.export(overview!.conversation.id),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='parallel-worlds-phase3.json';link.click();URL.revokeObjectURL(url);})}>Export JSON</button>
    </div>
    <p role="status">{connection} · {activity}{mic?` · microphone ${Math.round(level*100)}%`:''}. End the conversation before rewinding or evaluating.</p>
    <section aria-label="Active conversation timeline" className="phase3-timeline"><h2>Active timeline</h2>
      {!nodes.length&&<p>Enable the microphone after connecting. You speak first.</p>}
      {nodes.map(n=><article key={n.id} id={`evidence-${n.id}`} className={suggestion?.status==='active'&&suggestion.targetTurnId===n.id&&activity!=='speaking'?'suggested':''}><strong>{n.role==='user'?'You':'Alex'}</strong><p>{n.text??'Transcribing…'}</p>
        <small>{n.status}</small>{n.role==='user'&&<button disabled={busy||pending||!n.rewindable||overview?.branches.length!==1} title={n.reason} onClick={()=>setPreview(n)}>Preview rewind</button>}</article>)}
      {suggestion?.status==='active'&&activity!=='speaking'&&<aside className="notice"><strong>{suggestion.tentative?'Tentative moment to explore':'One moment to explore'}</strong><p>{suggestion.reason}</p><small>Model confidence: {Math.round(suggestion.confidence*100)}% · an optional experiment, not a prediction.</small>
        <button disabled={busy||pending||overview?.branches.length!==1} onClick={()=>setPreview(nodes.find(n=>n.id===suggestion.targetTurnId)??null)}>Preview suggested rewind</button>
        <button onClick={()=>void action(async()=>{await sdk.dismiss(selected);setSuggestion(null);})}>Dismiss</button></aside>}
      {preview&&<aside className="notice"><p>Replace your answer: “{preview.text}”. The preceding question and saved character checkpoint will be retained.</p>
        <button disabled={busy||pending||!qualification?.contextQualified} onClick={()=>void action(rewind)}>Create alternative</button><button onClick={()=>setPreview(null)}>Cancel</button></aside>}
    </section>
    {job&&<section aria-label="Evaluation"><h2>Communication comparison</h2><p role="status">{job.status}{job.error?` · ${job.error}`:''}</p>
      {job.status==='failed'&&job.retryable&&<button onClick={()=>void action(async()=>setJob(await sdk.retry(job.id)))}>Retry analysis once</button>}
      {result&&<ComparisonPanel result={result}/>}
    </section>}
  </main>;
}

/** Presentation only: all scores, evidence and branch relationships arrive from the API. */
export function ComparisonPanel({result}:{result:ComparisonResult}) {
  return <><svg viewBox="0 0 600 180" role="img" aria-label={result.paths.length>1?'Shared history divides into the recorded original and alternative paths':'One recorded original path'}>
        {result.paths.length>1?<><path d="M25 90H200" stroke="#7c886c" strokeWidth="4" fill="none"/><path d="M200 90Q260 45 330 45H570" stroke="#b48238" strokeWidth="4" fill="none"/><path d="M200 90Q260 135 330 135H570" stroke="#397ba3" strokeWidth="4" fill="none"/><text x="25" y="115">{result.sharedTurnIds.length?'Shared past':'Beginning'}</text><text x="330" y="32">Original</text><text x="330" y="163">Alternative</text></>:<><path d="M25 90H570" stroke="#b48238" strokeWidth="4"/><text x="25" y="65">Original</text></>}</svg>
        <div className="phase3-scores">{result.paths.map((p,i)=><article key={p.branchId}><h3>{i?'Alternative':'Original'}</h3><strong>{p.overall??'Unavailable'}{p.overall!==null?' / 100':''}</strong><p>{p.provisional?'Provisional · insufficient evidence in some categories':'All four categories assessed'} · coverage {Math.round(p.coverage*100)}%</p>
          <details><summary>Evidence and rubric details</summary>{dimensions.map(d=><div key={d}><h4>{d} · {p.categories[d].score??'Unavailable'}</h4><p>{p.categories[d].explanation}</p>{p.categories[d].unavailableReason&&<p>{p.categories[d].unavailableReason}</p>}{p.categories[d].evidence.map((e,j)=><blockquote key={j}>Turn {e.turnId}: “{e.quote}”</blockquote>)}</div>)}</details></article>)}</div>
        <p>{result.insight}</p><p>{result.comparisonCaution}</p><small>Simulated communication assessment. Scores do not measure attraction, compatibility or human worth. The diagram uses fixed layout, not emotional measurements.</small></>;
}
