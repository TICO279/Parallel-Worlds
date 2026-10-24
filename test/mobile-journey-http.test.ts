import {describe,it,expect} from 'vitest';
import type {Server} from 'node:http';
import {createApp} from '../server/app';
import {LocalDatabase,hash} from '../server/persistence/database';
import {ConversationStore} from '../server/store';
import {scenarios} from '../server/orchestrator';
import {unqualifiedRestore,type DurableBootstrap} from '../shared/phase3';
import {Phase3Client,type ClientOptions,type ConnectionState,type ProtocolEvent} from '../client';
import {MobileController,type VoiceClient} from '../src/mobile/controller';
import fixture from './fixtures/phase3-conversations.json';

const waitFor=async(check:()=>boolean|Promise<boolean>)=>{
  const until=Date.now()+6000;
  while(!await check()){if(Date.now()>until)throw new Error('Journey did not reach the expected server state.');await new Promise(r=>setTimeout(r,10));}
};
/** Synthetic adapter events; this test exercises the REAL SDK, HTTP API, reducer, recorder and SQLite. */
class FixtureVoice implements VoiceClient {
  connectionState:ConnectionState='idle';mic=false;boot?:DurableBootstrap;private controller=new AbortController();private previous:string|null=null;
  constructor(readonly options:ClientOptions){}
  async connect(){
    this.connectionState='connecting';this.options.onState('connecting');
    const boot=await this.options.bootstrap(this.controller.signal) as DurableBootstrap;this.boot=boot;
    this.options.onBootstrap(boot);this.previous=boot.history.length?`pwseed_${boot.history.length-1}`:null;
    this.options.onEvent({type:'session.created',session:{id:`boson-fixture-${boot.session.id}`}});
    await this.options.confirmReady?.(this.controller.signal);
    this.connectionState='ready';this.options.onState('ready');
  }
  async toggleMic(){expect(this.connectionState).toBe('ready');this.mic=!this.mic;this.options.onMic(this.mic);this.options.onActivity(this.mic?'listening':'idle');}
  async disconnect(){
    if(this.connectionState==='closed')return;this.controller.abort();this.connectionState='closing';this.options.onState('closing');
    this.mic=false;this.options.onMic(false);this.options.onActivity('idle');this.options.onEvent({type:'client.closed'});
    this.connectionState='closed';this.options.onState('closed');
  }
  queueInstructions(){}
  user(itemId:string,text:string){
    this.options.onActivity('listening');this.options.onEvent({type:'input_audio_buffer.speech_started',item_id:itemId,previous_item_id:this.previous});
    this.options.onEvent({type:'conversation.item.input_audio_transcription.completed',item_id:itemId,transcript:text});this.previous=itemId;
    this.options.onActivity('thinking');
  }
  assistant(itemId:string,text:string){
    const responseId=`response-${itemId}`;this.options.onActivity('speaking');
    const events:ProtocolEvent[]=[{type:'response.created',response:{id:responseId}},
      {type:'response.output_item.added',response_id:responseId,previous_item_id:this.previous,item:{id:itemId,type:'message',role:'assistant'}},
      {type:'response.output_audio_transcript.done',item_id:itemId,response_id:responseId,transcript:text},
      {type:'response.done',response:{id:responseId,status:'completed'}},{type:'client.playback_complete',item_id:itemId}];
    events.forEach(e=>this.options.onEvent(e));this.previous=itemId;this.options.onActivity(this.mic?'listening':'idle');
  }
}
describe('mobile journey against the preserved Phase 3 backend',()=>{
  it('retries rejected-recording closure, displays server history and can evaluate or reconnect to its saved prefix',async()=>{
    const db=new LocalDatabase(),store=new ConversationStore(undefined,db);
    const app=createApp({store,apiKey:'fixture-project-secret',fetcher:async()=>new Response(JSON.stringify({value:'bai-eph-fixture',expires_at:9999999999})),
      phase3:{db,qualification:{...unqualifiedRestore,contextQualified:true,preForkRecall:true,postForkAbsent:true,noDuplicateQuestion:true,noUnsolicitedResponse:true,scenarioHashes:{'alex-first-date':hash(scenarios[0])}}},dist:'__missing_dist__'});
    const server=await new Promise<Server>(done=>{const s=app.listen(0,'127.0.0.1',()=>done(s));});
    const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;let cookie='',failClose=false;
    const sdk=new Phase3Client(base,async(url,options)=>{
      if(failClose&&options?.method==='PATCH'&&JSON.parse(String(options.body)).status==='closed')throw new TypeError('Temporarily offline.');
      const r=await fetch(url,{...options,headers:{...options?.headers,...(cookie&&{cookie})}});cookie=r.headers.get('set-cookie')?.split(';')[0]??cookie;return r;
    });
    const voices:FixtureVoice[]=[];const controller=new MobileController({api:sdk,pollIntervalMs:20,voiceFactory:options=>{const v=new FixtureVoice(options);voices.push(v);return v;}});
    try{
      await controller.initialize();await controller.create();await controller.connect();const voice=voices[0],id=voice.boot!.session.id;
      voice.user('u1','I enjoy browsing bookshops.');voice.assistant('a1','What sorts of books do you read?');
      await waitFor(()=>store.get(id).turns.at(-1)?.playbackComplete===true);
      failClose=true;
      voice.options.onEvent({type:'conversation.item.input_audio_transcription.completed',item_id:'u1',transcript:'A conflicting late final.'});
      await waitFor(()=>controller.getSnapshot().warning?.includes('could not be closed')===true);
      expect(store.get(id).status).toBe('active');expect(controller.needsUnloadWarning).toBe(true);
      failClose=false;await controller.end();
      await waitFor(()=>store.get(id).status==='closed'&&controller.getSnapshot().nodes[0]?.text==='I enjoy browsing bookshops.');
      expect(controller.getSnapshot().warning).toContain('IMMUTABLE_TURN');expect(controller.needsUnloadWarning).toBe(false);
      expect(store.get(id).turns[0].text).toBe('I enjoy browsing bookshops.');
      await controller.evaluate();await waitFor(()=>controller.getSnapshot().comparison!==null);expect(controller.getSnapshot().error).toBeNull();
      await controller.connect();expect(controller.getSnapshot().connection).toBe('ready');expect(voices[1].boot?.history).toHaveLength(2);
    }finally{await controller.dispose();await new Promise<void>(done=>server.close(()=>done()));db.close();}
  });
  it('waits for missing predecessors before recording delayed restored-path events',async()=>{
    const db=new LocalDatabase(),store=new ConversationStore(undefined,db);
    const app=createApp({store,apiKey:'fixture-project-secret',fetcher:async()=>new Response(JSON.stringify({value:'bai-eph-fixture',expires_at:9999999999})),
      phase3:{db,qualification:{...unqualifiedRestore,contextQualified:true,preForkRecall:true,postForkAbsent:true,noDuplicateQuestion:true,noUnsolicitedResponse:true,scenarioHashes:{'alex-first-date':hash(scenarios[0])}}},dist:'__missing_dist__'});
    const server=await new Promise<Server>(done=>{const s=app.listen(0,'127.0.0.1',()=>done(s));});
    const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;let cookie='';
    const sdk=new Phase3Client(base,async(url,options)=>{const r=await fetch(url,{...options,headers:{...options?.headers,...(cookie&&{cookie})}});cookie=r.headers.get('set-cookie')?.split(';')[0]??cookie;return r;});
    let voice!:FixtureVoice;const controller=new MobileController({api:sdk,pollIntervalMs:20,voiceFactory:options=>voice=new FixtureVoice(options)});
    try{
      await controller.initialize();await controller.create();await controller.connect();
      voice.user('intro','I enjoy a quiet weekend.');
      await waitFor(()=>store.get(voice.boot!.session.id).adaptation?.attempts.some(a=>a.turnId==='intro')===true);
      voice.assistant('intro-reply','How do you spend it?');
      await waitFor(()=>store.get(voice.boot!.session.id).turns.at(-1)?.playbackComplete===true);
      await controller.end();await controller.connect();expect(voice.boot!.history).toHaveLength(2);
      // The assistant item/final text can arrive before its user predecessor.
      voice.options.onEvent({type:'conversation.item.added',previous_item_id:'late-user',item:{id:'reply',role:'assistant',content:[]}});
      voice.options.onEvent({type:'response.output_audio_transcript.done',item_id:'reply',transcript:'What sort of books do you like?'});
      voice.options.onEvent({type:'client.playback_complete',item_id:'reply'});
      await new Promise(done=>setTimeout(done,60));expect(controller.getSnapshot().connection).toBe('ready');
      expect(store.get(voice.boot!.session.id).turns).toEqual([]);
      voice.options.onEvent({type:'input_audio_buffer.committed',item_id:'late-user',previous_item_id:'pwseed_1'});
      voice.options.onEvent({type:'conversation.item.input_audio_transcription.completed',item_id:'late-user',transcript:'I enjoy browsing bookshops.'});
      await waitFor(()=>store.get(voice.boot!.session.id).turns.length===2);
      expect(store.get(voice.boot!.session.id).turns.map(t=>t.itemId)).toEqual(['late-user','reply']);
      await controller.end();await controller.evaluate();await waitFor(()=>controller.getSnapshot().comparison!==null);
      expect(controller.getSnapshot().error).toBeNull();expect(controller.getSnapshot().comparison?.paths).toHaveLength(1);
    }finally{await controller.dispose();await new Promise<void>(done=>server.close(()=>done()));db.close();}
  });
  it('creates, records, suggests, rewinds, compares and recovers without a browser tree',async()=>{
    const db=new LocalDatabase(),store=new ConversationStore(undefined,db);
    const app=createApp({store,apiKey:'fixture-project-secret',fetcher:async()=>new Response(JSON.stringify({value:'bai-eph-fixture',expires_at:9999999999})),
      phase3:{db,qualification:{...unqualifiedRestore,contextQualified:true,preForkRecall:true,postForkAbsent:true,noDuplicateQuestion:true,noUnsolicitedResponse:true,scenarioHashes:{'alex-first-date':hash(scenarios[0])}}},dist:'__missing_dist__'});
    const server=await new Promise<Server>(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
    const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;let cookie='';
    const sdk=new Phase3Client(base,async(url,options)=>{const response=await fetch(url,{...options,headers:{...options?.headers,...(cookie&&{cookie})}});cookie=response.headers.get('set-cookie')?.split(';')[0]??cookie;return response;});
    const voices:FixtureVoice[]=[];
    const makeController=()=>new MobileController({api:sdk,pollIntervalMs:20,voiceFactory:options=>{const v=new FixtureVoice(options);voices.push(v);return v;}});
    let controller=makeController();
    try{
      await controller.initialize();expect(controller.getSnapshot().profile?.id).toBe('alex-first-date');
      const id=await controller.create();expect(id).toBeTruthy();await controller.talk();const originalVoice=voices[0];
      expect(controller.getSnapshot().connection).toBe('ready');expect(originalVoice.mic).toBe(true);
      async function exchange(voice:FixtureVoice,index:number,lines:string[][]){
        const userId=`u${index}`,assistantId=`a${index}`;voice.user(userId,lines[index*2][1]);
        // Let the real backend commit the user checkpoint before finishing synthetic playback.
        await waitFor(async()=>store.get(voice.boot!.session.id).adaptation?.attempts.some(a=>a.turnId===userId)===true);
        voice.assistant(assistantId,lines[index*2+1][1]);
        await waitFor(async()=>store.get(voice.boot!.session.id).turns.some(t=>t.itemId===assistantId&&t.playbackComplete)===true);
      }
      for(let i=0;i<3;i++)await exchange(originalVoice,i,fixture.original);
      await waitFor(async()=>{await controller.refresh();return controller.getSnapshot().suggestion?.status==='active';});
      const suggestion=controller.getSnapshot().suggestion!;expect(controller.getSnapshot().nodes.find(n=>n.id===suggestion.targetTurnId)?.rewindable).toBe(true);
      const source=(await sdk.get(id!)).branches[0],sourceTurns=source.turnIds.slice();
      await controller.rewind(suggestion.targetTurnId!);expect(controller.getSnapshot().overview?.branches).toHaveLength(2);
      expect(controller.getSnapshot().connection).toBe('closed');expect(voices).toHaveLength(1);
      const childId=controller.getSnapshot().branchId;await controller.talk();const alternativeVoice=voices[1];
      expect(alternativeVoice.boot?.history.map(h=>h.nodeId)).toEqual(sourceTurns.slice(0,2));
      for(let i=0;i<2;i++)await exchange(alternativeVoice,i,fixture.alternative);
      await controller.evaluate();await waitFor(()=>controller.getSnapshot().comparison!==null);
      const result=controller.getSnapshot().comparison!;expect(result.paths).toHaveLength(2);expect(result.sharedTurnIds).toEqual(sourceTurns.slice(0,2));
      expect(result.forkTurnId).toBe(suggestion.targetTurnId);expect(result.paths.every(p=>p.overall!==null)).toBe(true);
      expect((await sdk.get(id!)).branches.find(b=>b.id===source.id)?.turnIds).toEqual(sourceTurns);
      await controller.dispose();controller=makeController();await controller.initialize();await controller.open(id!);
      expect(controller.getSnapshot().branchId).toBe(childId);expect(controller.getSnapshot().nodes).toHaveLength(6);
      await controller.evaluate();expect(controller.getSnapshot().comparison?.paths.map(p=>p.contentHash)).toEqual(result.paths.map(p=>p.contentHash));
    }finally{await controller.dispose();await new Promise<void>(r=>server.close(()=>r()));db.close();}
  });
});
