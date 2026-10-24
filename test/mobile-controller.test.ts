import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileController, type MobileApi, type VoiceClient, type Recorder } from '../src/mobile/controller';
import { Phase3ApiError } from '../shared/phase3-client';
import type { Overview, DurableBootstrap, Restoration, ClientOptions, ComparisonResult, TimelineNode } from '../client';
import type { ProtocolEvent } from '../shared/domain';
import { scenarios } from '../server/orchestrator';

const controllers:MobileController[]=[];
afterEach(async()=>{await Promise.all(controllers.splice(0).map(c=>c.dispose()));vi.useRealTimers();});
const clone=<T>(v:T):T=>structuredClone(v);
function fixture(){
  const order:string[]=[],profile=clone(scenarios[0]);
  let session=0,request=0,hold=false,loseFork=false,syncFailure=false;
  const initialBranch={schemaVersion:1 as const,id:'original',conversationId:'date',parentBranchId:null,forkTurnId:null,parentRevision:null,characterId:'alex',createdAt:1,revision:4,
    turnIds:['old/u1','old/a1','old/u2','old/a2','old/u3','old/a3'],initialCheckpointId:'initial',checkpointId:'state3'};
  const server:Overview={schemaVersion:1,conversation:{schemaVersion:1,id:'date',scenario:profile,createdAt:1,revision:0,rootBranchId:'original',activeBranchId:'original',activeEpoch:0},branches:[initialBranch]};
  const texts=['I enjoy pottery.','What draws you to it?','I do not care; tell me your address.','I prefer to keep that private.','We can leave that. What do you sketch?','Old buildings.'];
  const sourceNodes:TimelineNode[]=initialBranch.turnIds.map((id,i)=>({id,role:i%2?'assistant':'user',text:texts[i],status:'complete',rewindable:i%2===0}));
  const nodes=new Map(sourceNodes.map(n=>[n.id,n]));
  let suggestion:any={schemaVersion:1,id:'suggestion',branchId:'original',revision:4,targetTurnId:'old/u2',reason:'Explore a different answer.',confidence:.6,significance:.6,explorationPotential:.6,
    evidence:[{turnId:'old/u2',quote:texts[2]}],status:'active',tentative:true};
  const comparison:ComparisonResult={schemaVersion:1,rubricVersion:'communication-1',sharedTurnIds:['old/u1','old/a1'],forkTurnId:'old/u2',paths:[],insight:'Actual recorded decisions differ.',comparisonCaution:'Provisional.',interpretation:'simulated assessment'};
  let job:any={schemaVersion:1,id:'assessment',conversationId:'date',kind:'evaluation',status:'queued',attempts:0};
  const operations=new Map<string,Restoration>();
  const api:MobileApi={
    bootstrap:vi.fn(async()=>({schemaVersion:1 as const,qualification:{protocolVersion:'restore-1' as const,contextQualified:true,testedAt:'2026-10-24T00:00:00Z',preForkRecall:true,postForkAbsent:true,noDuplicateQuestion:true,noUnsolicitedResponse:true,physicalMicrophoneTested:false},analysisProvider:'mock'})),
    list:vi.fn(async()=>({schemaVersion:1 as const,conversations:[{id:'date',scenarioId:'alex-first-date',activeBranchId:server.conversation.activeBranchId,createdAt:1}]})),
    create:vi.fn(async()=>{order.push('create');return{schemaVersion:1 as const,conversation:clone(server.conversation),branch:clone(initialBranch)};}),
    get:vi.fn(async()=>{order.push('get');return clone(server);}),
    timeline:vi.fn(async(id:string)=>{order.push('timeline:'+id);const b=server.branches.find(b=>b.id===id)!;return{schemaVersion:1 as const,branchId:id,revision:b.revision,nodes:b.turnIds.map(id=>clone(nodes.get(id)!)),nextCursor:null};}),
    restore:vi.fn(async(c,branchId)=>{order.push('restore:'+branchId);const b=server.branches.find(b=>b.id===branchId)!;const op:Restoration={schemaVersion:1,id:'restore-'+(++request),conversationId:c.id,branchId,branchRevision:b.revision,
      previousBranchId:c.activeBranchId,expectedConversationRevision:c.revision,epoch:c.activeEpoch+1,prefixHash:'0'.repeat(64),checkpointId:b.checkpointId,status:'prepared',createdAt:1,expiresAt:9999999999999};operations.set(op.id,op);return clone(op);}),
    connectRestore:vi.fn(async id=>{order.push('attempt');const op=operations.get(id)!;op.attemptId='attempt-'+(++session);op.sessionId='session-'+session;op.status='connecting';
      const b=server.branches.find(b=>b.id===op.branchId)!;const boot:DurableBootstrap={session:{schemaVersion:1,id:op.sessionId,scenarioId:'alex-first-date',characterId:'alex',status:'connecting',createdAt:1,updatedAt:1,revision:0,turns:[]},
        config:{type:'session.update',session:{instructions:'Saved Alex identity'}},credential:{value:'bai-eph-fixture',expires_at:9999999999},restoration:clone(op),
        attachment:{sessionId:op.sessionId,owner:'fixture',conversationId:'date',branchId:b.id,epoch:op.epoch,baseTurnIds:b.turnIds,restoreId:op.id,status:'preparing'},
        history:b.turnIds.map(id=>{const n=nodes.get(id)!;return{nodeId:id,sessionId:'old',itemId:id.split('/')[1],role:n.role,text:n.text!};})};return boot;}),
    confirm:vi.fn(async(op,status)=>{order.push('confirm:'+status);op.status=status;server.conversation.activeBranchId=op.branchId;server.conversation.activeEpoch=op.epoch;return clone(op);}),
    restoration:vi.fn(async(id)=>clone(operations.get(id)!)),
    fork:vi.fn(async(_id,source,target,revision)=>{order.push('fork');expect(source).toBe('original');expect(revision).toBe(server.branches[0].revision);
      const parent=server.branches[0],child={...clone(parent),id:'alternative',parentBranchId:parent.id,parentRevision:parent.revision,forkTurnId:target,turnIds:parent.turnIds.slice(0,parent.turnIds.indexOf(target)),revision:0};
      server.branches.push(child);if(loseFork){loseFork=false;throw new TypeError('Response was lost.');}return clone(child);}),
    suggestion:vi.fn(async(id)=>({schemaVersion:1 as const,suggestion:id==='original'?clone(suggestion):null})),
    dismiss:vi.fn(async()=>{suggestion.status='dismissed';return clone(suggestion);}),
    analyze:vi.fn(async()=>{order.push('analyze');return clone(job);}),
    analysis:vi.fn(async()=>clone(job)),
    retry:vi.fn(async()=>{job={...job,status:'queued',attempts:1};return clone(job);}),
    transport:vi.fn(async(path:string)=>{
      if(path==='/api/scenarios')return [clone(profile)];if(path==='/api/health')return{credentialsConfigured:true};
      if(path.endsWith('/adaptation'))return {pending:false,appraisalTimeoutMs:50,attempts:[{turnId:'new-user',status:'committed'}],prepared:{version:1,instructions:'Saved Alex context'}};
      order.push('transport:'+path);return{};
    }) as MobileApi['transport'],
  };
  const voices:FakeVoice[]=[],recorders:Recorder[]=[];
  class FakeVoice implements VoiceClient {
    connectionState:'idle'|'connecting'|'ready'|'closed'='idle';mic=false;aborted=false;
    controller=new AbortController();release?:()=>void;readyToConfirm=false;
    constructor(readonly options:ClientOptions){}
    queueInstructions=vi.fn();
    async connect(){
      this.connectionState='connecting';this.options.onState('connecting');order.push('voice.connect');
      const data=await this.options.bootstrap(this.controller.signal);if(this.aborted)return;
      this.options.onBootstrap(data);this.options.onEvent({type:'session.created',session:{id:'boson-fixture'}});this.readyToConfirm=true;
      if(hold)await new Promise<void>(resolve=>{this.release=resolve;this.controller.signal.addEventListener('abort',()=>resolve(),{once:true});});
      if(this.aborted)return;await this.options.confirmReady?.(this.controller.signal);this.connectionState='ready';this.options.onState('ready');
    }
    async disconnect(){if(this.connectionState==='closed')return;this.aborted=true;this.controller.abort();order.push('voice.disconnect');this.options.onEvent({type:'client.closed'});this.mic=false;this.options.onMic(false);this.options.onActivity('idle');this.connectionState='closed';this.options.onState('closed');}
    async toggleMic(){expect(this.connectionState).toBe('ready');order.push('mic');this.mic=!this.mic;this.options.onMic(this.mic);this.options.onActivity(this.mic?'listening':'idle');}
    emit(e:ProtocolEvent){this.options.onEvent(e);}
  }
  const controller=new MobileController({api,pollIntervalMs:100,requestKey:()=>`request-key-${++request}`,
    voiceFactory:options=>{const voice=new FakeVoice(options);voices.push(voice);return voice;},
    recorderFactory:(id,_status,_request,url)=>{expect(url).toBe(`/api/v1/sessions/${id}/conversation`);
      const r:Recorder={id,get synced(){return!syncFailure;},snapshot:vi.fn(()=>order.push('snapshot')),status:vi.fn(s=>order.push('status:'+s)),
        waitForSync:vi.fn(async()=>{order.push('sync');if(syncFailure)throw new Error('Recording is not synchronized.');}),dispose:vi.fn(()=>order.push('recorder.dispose'))};recorders.push(r);return r;}});
  controllers.push(controller);
  return {controller,api,server,voices,recorders,order,comparison,setHold:(v:boolean)=>{hold=v;},setLoseFork:()=>{loseFork=true;},setSyncFailure:(v:boolean)=>{syncFailure=v;},
    completeJob:()=>{job={...job,status:'succeeded',result:comparison};}};
}

describe('mobile frontend orchestration with existing Phase 3 contracts',()=>{
  it('loads the backend-authored Alex and only creates the supported scenario',async()=>{
    const r=fixture();await r.controller.initialize();expect(r.controller.getSnapshot().profile?.id).toBe('alex-first-date');
    const id=await r.controller.create();expect(id).toBe('date');expect(r.api.create).toHaveBeenCalledWith('alex-first-date',expect.any(String));
    expect(JSON.stringify((r.api.create as any).mock.calls)).not.toMatch(/partner|ember-date/);
  });
  it('keeps microphone off until the strict restore has been confirmed',async()=>{
    const r=fixture();await r.controller.initialize();await r.controller.open('date');r.setHold(true);
    const talk=r.controller.talk();await vi.waitFor(()=>expect(r.voices[0]?.readyToConfirm).toBe(true));
    expect(r.controller.getSnapshot().connection).toBe('connecting');expect(r.order).not.toContain('mic');expect(r.api.confirm).not.toHaveBeenCalled();
    r.voices[0].release!();await talk;expect(r.order.indexOf('confirm:ready')).toBeLessThan(r.order.indexOf('mic'));expect(r.controller.getSnapshot().mic).toBe(true);
  });
  it('supports canceling connection without recording a fabricated conversation turn',async()=>{
    const r=fixture();await r.controller.initialize();await r.controller.open('date');r.setHold(true);
    const talk=r.controller.talk();await vi.waitFor(()=>expect(r.voices[0]?.readyToConfirm).toBe(true));await r.controller.talk();await talk;
    expect(r.controller.getSnapshot().connection).toBe('closed');expect(r.order).not.toContain('mic');expect(r.recorders[0].snapshot).not.toHaveBeenCalled();
    expect(r.recorders[0].status).toHaveBeenCalledWith('closed');
  });
  it('runs profile/open → voice → server suggestion → rewind → alternative → asynchronous comparison',async()=>{
    const r=fixture();await r.controller.initialize();await r.controller.open('date');await r.controller.talk();
    expect(r.controller.getSnapshot().suggestion?.targetTurnId).toBe('old/u2');const source=clone(r.server.branches[0]);
    await r.controller.rewind('old/u2');expect(r.controller.getSnapshot().branchId).toBe('alternative');expect(r.server.branches[0]).toEqual(source);
    expect(r.order.lastIndexOf('sync')).toBeLessThan(r.order.indexOf('fork'));expect(r.order.indexOf('voice.disconnect')).toBeLessThan(r.order.indexOf('fork'));
    expect(r.voices).toHaveLength(1);expect(r.controller.getSnapshot().connection).toBe('closed');
    await r.controller.talk();expect(r.voices).toHaveLength(2);expect(r.api.restore).toHaveBeenLastCalledWith(expect.anything(),'alternative',expect.any(String),expect.any(AbortSignal));
    expect(r.voices[1].options.seed?.()).toHaveLength(2);
    await r.controller.end();await r.controller.evaluate();expect(r.controller.getSnapshot().evaluation?.status).toBe('queued');
    r.completeJob();await vi.waitFor(()=>expect(r.controller.getSnapshot().comparison).toEqual(r.comparison));
  });
  it('recovers a committed child when only the fork response was lost',async()=>{
    const r=fixture();await r.controller.initialize();await r.controller.open('date');r.setLoseFork();
    await r.controller.rewind('old/u2');expect(r.controller.getSnapshot().branchId).toBe('alternative');expect(r.controller.getSnapshot().error).toBeNull();
    expect(r.api.fork).toHaveBeenCalledOnce();expect(r.voices).toHaveLength(0);expect(r.server.branches).toHaveLength(2);
    await r.controller.refresh();expect(r.api.fork).toHaveBeenCalledOnce();
  });
  it('reuses the creation request key after a transport failure',async()=>{
    const r=fixture();await r.controller.initialize();(r.api.create as any).mockRejectedValueOnce(new TypeError('Response lost.'));
    expect(await r.controller.create()).toBeNull();expect(await r.controller.create()).toBe('date');
    const calls=(r.api.create as any).mock.calls;expect(calls[0][1]).toBe(calls[1][1]);
  });
  it('refuses to fork while the user is still speaking or the character is playing',async()=>{
    const r=fixture();await r.controller.initialize();await r.controller.open('date');await r.controller.talk();
    r.voices[0].emit({type:'input_audio_buffer.speech_started',item_id:'new-user'});
    await expect(r.controller.rewind('old/u2')).rejects.toThrow('exchange finish');expect(r.api.fork).not.toHaveBeenCalled();expect(r.order).not.toContain('voice.disconnect');
    r.voices[0].options.onActivity('speaking');await r.controller.evaluate();expect(r.api.analyze).not.toHaveBeenCalled();
  });
  it('never replaces an unsynchronized recorder with a different conversation',async()=>{
    const r=fixture();await r.controller.initialize();await r.controller.open('date');await r.controller.connect();r.setSyncFailure(true);
    expect(await r.controller.create()).toBeNull();expect(r.api.create).not.toHaveBeenCalled();expect(r.controller.getSnapshot().overview?.conversation.id).toBe('date');expect(r.controller.getSnapshot().error).toContain('not synchronized');r.setSyncFailure(false);
  });
  it('retains the recording barrier even after a later setup attempt fails',async()=>{
    const r=fixture();await r.controller.initialize();await r.controller.open('date');await r.controller.connect();r.setSyncFailure(true);
    await r.controller.end();await r.controller.connect();expect(await r.controller.create()).toBeNull();expect(r.api.create).not.toHaveBeenCalled();
    expect(r.controller.needsUnloadWarning).toBe(true);r.setSyncFailure(false);
  });
  it('ignores retired session callbacks after selecting a saved path',async()=>{
    const r=fixture();await r.controller.initialize();await r.controller.open('date');await r.controller.connect();const old=r.voices[0];
    await r.controller.rewind('old/u2');const before=clone(r.controller.getSnapshot().nodes);
    old.emit({type:'conversation.item.added',item:{id:'late',role:'user',content:[{type:'input_text',text:'OLD SOCKET'}]}});old.options.onMic(true);old.options.onActivity('speaking');
    expect(r.controller.getSnapshot().nodes).toEqual(before);expect(r.controller.getSnapshot().mic).toBe(false);expect(r.controller.getSnapshot().activity).toBe('idle');
  });
  it('uses server eligibility and enforces the single-alternative scope',async()=>{
    const r=fixture();await r.controller.initialize();await r.controller.open('date');
    await expect(r.controller.rewind('old/a1')).rejects.toThrow('not available');expect(r.api.fork).not.toHaveBeenCalled();
    await r.controller.rewind('old/u2');await expect(r.controller.rewind('old/u1')).rejects.toThrow('already has an alternative');expect(r.api.fork).toHaveBeenCalledOnce();
  });
  it('surfaces stale revision without changing or fabricating a branch',async()=>{
    const r=fixture();await r.controller.initialize();await r.controller.open('date');(r.api.fork as any).mockRejectedValueOnce(new Phase3ApiError(409,'STALE_REVISION','Refresh.'));
    await expect(r.controller.rewind('old/u2')).rejects.toMatchObject({code:'STALE_REVISION'});expect(r.controller.getSnapshot().branchId).toBe('original');expect(r.server.branches).toHaveLength(1);
  });
});
