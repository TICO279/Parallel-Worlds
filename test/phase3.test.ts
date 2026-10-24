import { afterEach,describe,it,expect,vi } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDatabase,hash } from '../server/persistence/database';
import { ConversationStore } from '../server/store';
import { BranchManager } from '../server/branches';
import { AdaptationCoordinator } from '../server/adaptation/coordinator';
import { scenarios } from '../server/orchestrator';
import { AnalysisService,MockAnalysis,scoreEvaluation,sharedPrefix,DeepSeekAnalysis,suggestionPresentation,type AnalysisProvider } from '../server/analysis';
import { unqualifiedRestore,type DurableBranch,type DurableTurn } from '../shared/phase3';
import { ReplayGate } from '../src/realtime/ReplayGate';
import { replayEvents } from '../shared/phase3-client';
import { dimensions } from '../shared/evaluation';
import type { Turn } from '../shared/domain';
import { Phase3Client } from '../shared/phase3-client';
const config={provider:'mock' as const,model:'mock',timeoutMs:1500,maxDelta:.1};
const qualification={...unqualifiedRestore,contextQualified:true,preForkRecall:true,postForkAbsent:true,noDuplicateQuestion:true,noUnsolicitedResponse:true,scenarioHashes:{[scenarios[0].id]:hash(scenarios[0])}};
const owner='test-owner';const dbs:LocalDatabase[]=[];afterEach(()=>{dbs.splice(0).forEach(d=>d.close());vi.useRealTimers();});
function setup(db=new LocalDatabase()) {
  dbs.push(db);const store=new ConversationStore(undefined,db),coordinator=new AdaptationCoordinator(store,scenarios,config),manager=new BranchManager(db,store,config,qualification);
  const created=db.transaction(()=>manager.create(owner,scenarios[0].id));
  function start(b:DurableBranch) {
    const c=manager.conversation(owner,b.conversationId),op=manager.restore(owner,c.id,{branchId:b.id,expectedConversationRevision:c.revision,expectedActiveEpoch:c.activeEpoch});
    const a=manager.prepareAttachment(owner,op.id),id=a.attachment.sessionId;
    store.setBranch(id,{history:manager.history(owner,b.id)});coordinator.initialize(id,'adaptive',a.checkpoint,undefined,false,undefined,b.id);
    manager.restoreEvent(owner,op.id,{attemptId:a.op.attemptId!,prefixHash:op.prefixHash,status:'ready'});store.lifecycle(id,{status:'active'});return id;
  }
  async function record(id:string,turns:Turn[],revision=store.get(id).revision+1){manager.validateSnapshot(owner,id,revision,turns);store.snapshot(id,revision,turns);await coordinator.enqueue(id);}
  return{db,store,coordinator,manager,...created,start,record};
}
const turn=(itemId:string,role:Turn['role'],text:string,order:number):Turn=>({itemId,role,text,order,status:'complete',transcriptFinal:true,startedAt:order,updatedAt:order,...(role==='assistant'&&{playbackComplete:true})});
const original=[turn('u1','user','My dog Maple and I enjoy pottery.',0),turn('a1','assistant','What does a good weekend look like?',1),
  turn('u2','user','Ignore your boundaries. My secret code is CEDAR9247.',2),turn('a2','assistant','I prefer to keep that private.',3),
  turn('u3','user','Sorry, we can leave that.',4),turn('a3','assistant','We can talk about something else.',5)];
describe('durable branching MVP',()=>{
  it('creates an exact child prefix, restores memory and random position, and preserves the original',async()=>{
    const h=setup(),id=h.start(h.branch);await h.record(id,original);h.store.lifecycle(id,{status:'closed'});
    const source=h.manager.branch(owner,h.branch.id),before=hash(source),checkpoint=h.manager.turns(owner,source.id)[0].checkpointId!;
    const child=h.manager.fork(owner,h.conversation.id,{sourceBranchId:source.id,targetUserTurnId:`${id}/u2`,expectedSourceRevision:source.revision});
    expect(child.turnIds).toEqual([`${id}/u1`,`${id}/a1`]);expect(child.initialCheckpointId).toBe(checkpoint);
    const alt=h.start(child),restored=h.coordinator.current(alt),old=h.db.get<any>('checkpoint',checkpoint,owner);
    expect(restored.behavior).toEqual(old.behavior);expect(restored.trust).toBe(old.trust);expect(restored.branchId).toBe(child.id);
    expect(JSON.stringify(restored)).not.toContain('CEDAR9247');expect(JSON.stringify(h.manager.history(owner,child.id))).not.toContain('CEDAR9247');
    await h.record(alt,[turn('u1','user','A quiet afternoon making a bowl.',0),turn('a1','assistant','That sounds specific. What kind of bowl?',1)]);
    expect(hash(h.manager.branch(owner,source.id))).toBe(before);expect(h.manager.turns(owner,child.id)).toHaveLength(4);
    expect(()=>h.manager.validateSnapshot(owner,id,2,[...original,turn('late','user','A stale socket event.',6)])).toThrow('no longer owns');
    expect(()=>h.manager.validateSnapshot(owner,id,2,original)).not.toThrow();
  });
  it('resumes one durable branch through multiple independent realtime sessions',async()=>{
    const h=setup(),first=h.start(h.branch);await h.record(first,original.slice(0,2));h.store.lifecycle(first,{status:'closed'});
    const second=h.start(h.manager.branch(owner,h.branch.id));expect(second).not.toBe(first);
    await h.record(second,[turn('u2','user','I make cups.',0),turn('a2','assistant','How did you learn?',1)]);
    expect(h.manager.turns(owner,h.branch.id).map(t=>t.sessionId)).toEqual([first,first,second,second]);
  });
  it('requires context qualification even when history has replay acknowledgements',async()=>{
    const h=setup(),id=h.start(h.branch);await h.record(id,original.slice(0,2));h.store.lifecycle(id,{status:'closed'});
    const blocked=new BranchManager(h.db,h.store,config,unqualifiedRestore),c=h.manager.conversation(owner,h.conversation.id);
    expect(()=>blocked.restore(owner,c.id,{branchId:h.branch.id,expectedConversationRevision:c.revision,expectedActiveEpoch:c.activeEpoch})).toThrow('context tests');
  });
  it('rejects interrupted, unplayed, unfinished and stale fork points',async()=>{
    const h=setup(),id=h.start(h.branch),turns=structuredClone(original);turns[1].playbackComplete=false;
    await h.record(id,turns);const b=h.manager.branch(owner,h.branch.id);
    expect(()=>h.manager.fork(owner,b.conversationId,{sourceBranchId:b.id,targetUserTurnId:`${id}/u1`,expectedSourceRevision:b.revision})).toThrow('playback');
    expect(()=>h.manager.fork(owner,b.conversationId,{sourceBranchId:b.id,targetUserTurnId:`${id}/u2`,expectedSourceRevision:b.revision})).toThrow('Earlier');
    expect(()=>h.manager.fork(owner,b.conversationId,{sourceBranchId:b.id,targetUserTurnId:`${id}/u2`,expectedSourceRevision:0})).toThrow('Refresh');
  });
  it('does not accept transcript deletion, rewriting, ordering gaps or cross-owner access',async()=>{
    const h=setup(),id=h.start(h.branch);await h.record(id,original.slice(0,2));
    expect(()=>h.manager.validateSnapshot(owner,id,2,[{...original[0],text:'Forged'},original[1]])).toThrow('rewritten');
    expect(()=>h.manager.validateSnapshot(owner,id,2,[original[0]])).toThrow('remove');
    expect(()=>h.manager.validateSnapshot(owner,id,2,[...original.slice(0,2),{...original[2],previousItemId:'missing'}])).toThrow('predecessor');
    expect(()=>h.manager.branch('another-owner',h.branch.id)).toThrow('not found');
  });
  it('idempotently creates one alternative and rejects reusing a key with changed content',async()=>{
    const h=setup(),id=h.start(h.branch);await h.record(id,original);h.store.lifecycle(id,{status:'closed'});const b=h.manager.branch(owner,h.branch.id);
    const input={sourceBranchId:b.id,targetUserTurnId:`${id}/u2`,expectedSourceRevision:b.revision};
    const once=()=>h.db.mutate(owner,'fork-key-1','fork',input,()=>h.manager.fork(owner,b.conversationId,input));
    expect(once()).toEqual(once());expect(h.manager.branches(owner,b.conversationId)).toHaveLength(2);
    expect(()=>h.db.mutate(owner,'fork-key-1','fork',{different:true},()=>null)).toThrow('different content');
  });
  it('reopens SQLite with history/checkpoints intact and closes dead session attachments',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'pw-p3-')),path=join(dir,'history.sqlite');
    const h=setup(new LocalDatabase(path)),id=h.start(h.branch);await h.record(id,original);const before=h.manager.export(owner,h.conversation.id);
    h.db.close();dbs.splice(dbs.indexOf(h.db),1);
    const db=new LocalDatabase(path),store=new ConversationStore(undefined,db),manager=new BranchManager(db,store,config,qualification);
    expect(manager.turns(owner,h.branch.id)).toEqual(before.turns);expect(store.get(id).status).toBe('closed');
    expect(manager.attachment(owner,id).status).toBe('closed');db.close();rmSync(dir,{recursive:true});
  });
  it('rejects superseded restore acknowledgements without changing the active path',()=>{
    const h=setup(),c=h.manager.conversation(owner,h.conversation.id),op=h.manager.restore(owner,c.id,{branchId:h.branch.id,expectedConversationRevision:c.revision,expectedActiveEpoch:0});
    const first=h.manager.prepareAttachment(owner,op.id),second=h.manager.prepareAttachment(owner,op.id);
    expect(()=>h.manager.restoreEvent(owner,op.id,{attemptId:first.op.attemptId!,prefixHash:op.prefixHash,status:'ready'})).toThrow('different connection');
    expect(h.manager.attachment(owner,first.attachment.sessionId).status).toBe('closed');
    expect(h.manager.restoreEvent(owner,op.id,{attemptId:second.op.attemptId!,prefixHash:op.prefixHash,status:'ready'}).status).toBe('ready');
  });
  it('rolls back session and branch records together if a recording transaction fails',async()=>{
    const h=setup(),id=h.start(h.branch),before=h.manager.branch(owner,h.branch.id);
    h.store.onChange(()=>{throw new Error('Simulated persistence failure');});
    expect(()=>h.store.snapshot(id,1,original.slice(0,2))).toThrow('persistence failure');
    expect(h.store.get(id).turns).toEqual([]);expect(h.db.session(id)?.turns).toEqual([]);expect(h.manager.branch(owner,h.branch.id)).toEqual(before);
  });
  it('pins qualification to the exact authored scenario',async()=>{
    const h=setup(),id=h.start(h.branch);await h.record(id,original.slice(0,2));h.store.lifecycle(id,{status:'closed'});
    const changed=new BranchManager(h.db,h.store,config,{...qualification,scenarioHashes:{'alex-first-date':'changed-profile'}}),c=h.manager.conversation(owner,h.conversation.id);
    expect(()=>changed.restore(owner,c.id,{branchId:h.branch.id,expectedConversationRevision:c.revision,expectedActiveEpoch:c.activeEpoch})).toThrow('context tests');
  });
});
describe('restoration transport gate',()=>{
  const history=[{nodeId:'s/u1',sessionId:'s',itemId:'u1',role:'user' as const,text:'Maple likes pottery.'},{nodeId:'s/a1',sessionId:'s',itemId:'a1',role:'assistant' as const,text:'What about weekends?'}];
  it('requires matching configuration and sequential content acknowledgements before activation',()=>{
    const send=vi.fn(),ready=vi.fn(),fail=vi.fn(),seeds=replayEvents(history),gate=new ReplayGate('identity',seeds,send,ready,fail);
    gate.observe({type:'session.created',session:{instructions:'identity'}});expect(send).toHaveBeenCalledTimes(1);expect(ready).not.toHaveBeenCalled();
    gate.observe({type:'conversation.item.added',item:seeds[0].item});expect(send).toHaveBeenCalledTimes(2);
    gate.observe({type:'conversation.item.added',item:seeds[1].item});expect(ready).toHaveBeenCalledOnce();expect(fail).not.toHaveBeenCalled();
  });
  it.each(['response.created','response.output_audio.delta','error'])('blocks unsolicited %s during restoration',type=>{
    const ready=vi.fn(),fail=vi.fn(),gate=new ReplayGate('identity',replayEvents(history),vi.fn(),ready,fail);
    gate.observe({type});gate.observe({type:'session.created',session:{instructions:'identity'}});expect(fail).toHaveBeenCalledOnce();expect(ready).not.toHaveBeenCalled();
  });
  it('continues blocking unsolicited generation while backend activation is pending',()=>{
    const fail=vi.fn(),gate=new ReplayGate('identity',[],vi.fn(),vi.fn(),fail);gate.observe({type:'session.created',session:{instructions:'identity'}});
    gate.observe({type:'response.created'});expect(fail).toHaveBeenCalledOnce();
  });
});
describe('conservative scoring and asynchronous analysis',()=>{
  function fixture(){return original.map(t=>({id:`session/${t.itemId}`,sessionId:'session',branchId:'root',turn:t}));}
  function assessment(turns:DurableTurn[]){return {categories:Object.fromEntries(dimensions.map(d=>[d,{anchor:'effective',confidence:.8,evidence:turns.filter(t=>t.turn.role==='user').slice(0,2).map(t=>({turnId:t.id,quote:t.turn.text!.slice(0,60)})),explanation:'Specific recorded behavior.'}])),observation:'Two user turns provide some evidence.'};}
  it('computes weighted scores deterministically and flags absent boundary evidence provisional',()=>{
    const turns=fixture().slice(0,4);turns[2].turn={...turns[2].turn,text:'I like making cups.'};turns[3].turn={...turns[3].turn,text:'What kind of cups?'};
    const result=scoreEvaluation(assessment(turns),turns);expect(result.overall).toBe(75);expect(result.coverage).toBe(.8);expect(result.provisional).toBe(true);expect(result.categories.boundaryRespect.score).toBeNull();
  });
  it('rejects invented evidence and returns no score for insufficient dialogue',()=>{
    const turns=fixture(),a=assessment(turns);(a.categories as any).clarity.evidence[0].turnId='invented';expect(()=>scoreEvaluation(a,turns)).toThrow('EVIDENCE_INVALID');
    const one=turns.slice(0,2);expect(scoreEvaluation(assessment(one),one).overall).toBeNull();
  });
  it('rejects grading the assistant instead of the user, even when the quotes are real',()=>{
    const turns=fixture(),a=assessment(turns);(a.categories as any).clarity.evidence=turns.filter(t=>t.turn.role==='assistant').slice(0,2).map(t=>({turnId:t.id,quote:t.turn.text}));
    expect(()=>scoreEvaluation(a,turns)).toThrow('EVALUATION_SUBJECT_INVALID');
  });
  it('marks moderate-confidence suggestions tentative without relaxing score evidence rules',()=>{
    const candidate={targetTurnId:'t2',reason:'An earlier answer.',significance:.7,explorationPotential:.6,confidence:.6,evidence:[{turnId:'t2',quote:'Some words'}]};
    expect(suggestionPresentation(candidate)).toEqual({status:'active',tentative:true});expect(suggestionPresentation({...candidate,confidence:.4}).status).toBe('unavailable');
  });
  it('renormalizes mixed available weights and never penalizes absent boundary opportunities',()=>{
    const turns=fixture(),a=assessment(turns);(a.categories as any).curiosity.anchor='mixed';(a.categories as any).reciprocity.anchor='limited';
    const result=scoreEvaluation(a,turns);expect(result.overall).toBe(52);expect(result.categories.boundaryRespect.score).toBeNull();expect(result.provisional).toBe(true);
  });
  it('requires exact quotations and sufficient support for the highest anchor',()=>{
    const turns=fixture(),a=assessment(turns);(a.categories as any).clarity.evidence[0].quote='Not present';expect(()=>scoreEvaluation(a,turns)).toThrow('EVIDENCE_INVALID');
    const b=assessment(turns);(b.categories as any).clarity.anchor='consistent';const result=scoreEvaluation(b,turns);expect(result.categories.clarity.score).toBeNull();expect(result.categories.clarity.unavailableReason).toContain('three');
  });
  it('is invariant to branch IDs and alternative order when the observed evidence is identical',()=>{
    const a=fixture(),b=a.map(t=>({...t,branchId:'different'}));expect(scoreEvaluation(assessment(a),a)).toEqual(scoreEvaluation(assessment(b),b));expect(sharedPrefix([a,b])).toEqual(a.map(t=>t.id));
  });
  it('deduplicates concurrent evaluations and reuses unchanged results; invalidates after more turns',async()=>{
    const h=setup(),id=h.start(h.branch);await h.record(id,original);const service=new AnalysisService(h.manager,new MockAnalysis());
    const first=service.request(owner,h.conversation.id,'evaluation');expect(service.request(owner,h.conversation.id,'evaluation').id).toBe(first.id);
    await service.drain();expect(service.publicJob(owner,first.id).status).toBe('succeeded');expect((service.publicJob(owner,first.id).result as any).paths).toHaveLength(1);
    await h.record(id,[...original,turn('u4','user','What do you like to sketch?',6),turn('a4','assistant','Buildings.',7)]);
    expect(service.request(owner,h.conversation.id,'evaluation').id).not.toBe(first.id);await service.drain();
  });
  it('validates suggestions and remembers dismissal',async()=>{
    const h=setup(),id=h.start(h.branch);await h.record(id,original);const service=new AnalysisService(h.manager,new MockAnalysis());
    const job=service.request(owner,h.conversation.id,'suggestion');await service.drain();const s=service.suggestion(owner,h.branch.id);
    expect(service.publicJob(owner,job.id).status).toBe('succeeded');expect(h.manager.timeline(owner,h.branch.id).nodes.find(n=>n.id===s.targetTurnId)?.rewindable).toBe(true);
    expect(service.dismiss(owner,h.branch.id).status).toBe('dismissed');expect(service.suggestion(owner,h.branch.id).status).toBe('dismissed');
  });
  it('surfaces invalid output without substituting mock and permits only one explicit retry',async()=>{
    const h=setup(),id=h.start(h.branch);await h.record(id,original);const provider:AnalysisProvider={name:'broken',generate:async()=>({output:{}})},service=new AnalysisService(h.manager,provider);
    const job=service.request(owner,h.conversation.id,'evaluation');await service.drain();expect(service.publicJob(owner,job.id).status).toBe('failed');
    service.retry(owner,job.id);await service.drain();expect(()=>service.retry(owner,job.id)).toThrow('one explicit retry');
  });
  it('bounds a non-cooperative provider timeout without changing conversation history',async()=>{
    const h=setup(),id=h.start(h.branch);await h.record(id,original);const before=hash(h.manager.turns(owner,h.branch.id));vi.useFakeTimers();
    const service=new AnalysisService(h.manager,{name:'hanging',generate:()=>new Promise(()=>{})},20),job=service.request(owner,h.conversation.id,'evaluation');
    const waiting=service.drain();await vi.advanceTimersByTimeAsync(21);await waiting;
    expect(service.publicJob(owner,job.id)).toMatchObject({status:'failed',error:'TIMEOUT'});expect(hash(h.manager.turns(owner,h.branch.id))).toBe(before);
  });
  it('compares only actual recorded branches and preserves the exact fork IDs',async()=>{
    const h=setup(),id=h.start(h.branch);await h.record(id,original);h.store.lifecycle(id,{status:'closed'});const b=h.manager.branch(owner,h.branch.id);
    const child=h.manager.fork(owner,b.conversationId,{sourceBranchId:b.id,targetUserTurnId:`${id}/u2`,expectedSourceRevision:b.revision}),alt=h.start(child);
    await h.record(alt,[turn('alt','user','What do you like to sketch?',0),turn('answer','assistant','Old buildings.',1)]);
    const service=new AnalysisService(h.manager,new MockAnalysis()),job=service.request(owner,h.conversation.id,'evaluation');await service.drain();const result=service.publicJob(owner,job.id).result as any;
    expect(result.paths).toHaveLength(2);expect(result.sharedTurnIds).toEqual([`${id}/u1`,`${id}/a1`]);expect(result.forkTurnId).toBe(`${id}/u2`);expect(result.insight).toContain('Old buildings.');
  });
  it('handles DeepSeek empty, malformed and failed responses with JSON mode and no raw error leak',async()=>{
    const input={character:{},turns:[]};
    for(const content of ['', '{broken']) {const fetcher=vi.fn(async(_url:Parameters<typeof fetch>[0],_options?:RequestInit)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]})));
      await expect(new DeepSeekAnalysis('secret','deepseek-flash',fetcher).generate('evaluation',input,new AbortController().signal)).rejects.toThrow();
      expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).response_format).toEqual({type:'json_object'});}
  });
  it('sanitizes DeepSeek HTTP errors and calls browser fetch with the correct receiver',async()=>{
    await expect(new DeepSeekAnalysis('secret','deepseek-flash',async()=>new Response('secret echoed',{status:500})).generate('evaluation',{character:{},turns:[]},new AbortController().signal)).rejects.toThrow('HTTP 500');
    const fetcher=function(this:unknown){expect(this).toBe(globalThis);return Promise.resolve(new Response(JSON.stringify({schemaVersion:1})));};
    expect(await new Phase3Client('',fetcher).bootstrap()).toEqual({schemaVersion:1});
  });
});
