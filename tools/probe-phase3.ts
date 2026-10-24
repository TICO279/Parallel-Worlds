/** Bounded end-to-end semantic restoration qualification; no human/microphone claims. */
import dotenv from 'dotenv';
import { writeFile,mkdir,readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { LocalDatabase,hash } from '../server/persistence/database';
import { ConversationStore } from '../server/store';
import { Phase3Client,Phase3ApiError,replayEvents } from '../shared/phase3-client';
import { unqualifiedRestore,type DurableBootstrap } from '../shared/phase3';
import { ReplayGate } from '../src/realtime/ReplayGate';
import { Probe } from './probe-adaptation';
import { emptyConversation,reduceTranscript,orderedTurns } from '../shared/transcript';
import { scenarios } from '../server/orchestrator';
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function main(){
  if(!process.argv.includes('--live'))throw new Error('Use --live to authorize the bounded Boson probe.');
  const project=dotenv.config({quiet:true}).parsed??{};const db=new LocalDatabase(),store=new ConversationStore(undefined,db);
  const scenarioHashes={[scenarios[0].id]:hash(scenarios[0])};
  const app=createApp({apiKey:project.BOSON_API_KEY,store,phase3:{db,qualification:{...unqualifiedRestore,contextQualified:true,preForkRecall:true,postForkAbsent:true,noDuplicateQuestion:true,noUnsolicitedResponse:true,scenarioHashes}},dist:'__no_dist__'});
  const server=await new Promise<Server>(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));}),base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  let cookie='';const sdk=new Phase3Client(base,async(input,init)=>{const response=await fetch(input,{...init,headers:{...init?.headers,...(cookie&&{cookie})}});cookie=response.headers.get('set-cookie')?.split(';')[0]??cookie;return response;});
  const patch=(id:string,body:unknown)=>fetch(`${base}/api/sessions/${id}`,{method:'PATCH',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const rows:any[]=[],probes:Probe[]=[];const started=Date.now(),deadline=setTimeout(()=>{for(const p of probes)p.close();},180000);
  try{
    await sdk.bootstrap();
    const audioOutput=process.argv.includes('--audio-output'),trialCount=audioOutput?2:3;
    for(let trial=0;trial<trialCount;trial++){
      const created=await sdk.create('alex-first-date');let revision=0;
      async function connect(branchId:string){
        const c=(await sdk.get(created.conversation.id)).conversation,op=await sdk.restore(c,branchId),data=await sdk.connectRestore(op.id),p=new Probe();probes.push(p);
        const config={...data.config,session:{...(data.config.session as object),output_modalities:[audioOutput?'audio':'text']}};
        await p.connect(config,data.credential);let ready=false,failed=false,index=0;
        const gate=new ReplayGate(String((config.session as any).instructions),replayEvents(data.history),e=>p.send(e),()=>{ready=true;},()=>{failed=true;});
        const until=Date.now()+15000;while(!ready&&!failed&&Date.now()<until){while(index<p.events.length)gate.observe(p.events[index++].event);await pause(10);}
        if(!ready||failed)throw new Error('ACK_GATE_FAILED');
        const quietFrom=p.events.length;await pause(1000);
        if(p.events.slice(quietFrom).some(e=>e.event.type.startsWith('response.')))throw new Error('UNSOLICITED_RESPONSE');
        await sdk.confirm(data.restoration,'ready');await patch(data.session.id,{status:'active',bosonSessionId:(p.events.find(e=>e.event.type==='session.created')?.event.session.id)});
        return{data,p};
      }
      const source=await connect(created.branch.id),state={value:emptyConversation()};
      async function say(current:{data:DurableBootstrap;p:Probe},text:string,turnState:typeof state){
        const from=current.p.events.length,reply=await current.p.text(text);
        for(const {event} of current.p.events.slice(from))turnState.value=reduceTranscript(turnState.value,event.type==='response.output_text.done'?{...event,type:'response.output_audio_transcript.done',item_id:event.item_id??orderedTurns(turnState.value).filter(t=>t.role==='assistant').at(-1)?.itemId,transcript:event.text}:event,Date.now());
        const turns=orderedTurns(turnState.value).map(t=>t.role==='assistant'?{...t,playbackComplete:true}:t);
        // Diagnostic delivery, not physical playback verification.
        await sdk.record(current.data.session.id,++revision,turns);
        await fetch(`${base}/api/sessions/${current.data.session.id}/appraisals`,{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({turnId:turns.filter(t=>t.role==='user').at(-1)!.itemId})});
        return reply;
      }
      const first=await say(source,`I'm Jordan. My dog's name is Maple${trial}, and my hobby is pottery. What do you enjoy doing on weekends?`,state);
      const second=await say(source,`My secret code is CEDAR924${trial}. I lived in Peru. I like crowded clubs. What sort of place would you pick?`,state);
      const timeline=await sdk.timeline(created.branch.id),target=timeline.nodes.filter(n=>n.role==='user')[1];
      if(!target?.rewindable){rows.push({diagnostic:'text-fixture-recording',nodes:timeline.nodes,eventTypes:[...new Set(source.p.events.map(e=>e.event.type))]});throw new Error('INVALID_PROBE_PREFIX');}
      source.p.close();await patch(source.data.session.id,{status:'closed'});
      const originalBefore=await sdk.get(created.conversation.id),originalHash=hash(originalBefore.branches[0]);
      const child=await sdk.fork(created.conversation.id,created.branch.id,target.id,timeline.revision),alt=await connect(child.id);revision=0;
      const reply=await say(alt,`Instead I'd like a quiet afternoon. Remind me of my dog's name and my hobby. Have I told you a secret code or where I lived? If not, please say you don't know.`,{value:emptyConversation()});
      const normalized=reply.toLowerCase(),preForkRecall=normalized.includes(`maple${trial}`)&&normalized.includes('pottery');
      const postForkAbsent=!normalized.includes(`cedar924${trial}`)&&!normalized.includes('peru')&&/don't know|do not know|haven.t|not (?:told|shared|mentioned|provided)|no (?:secret|code)|didn.t/.test(normalized);
      const noDuplicateQuestion=first.trim()!==reply.trim()&&!reply.includes(first.trim()),noUnsolicitedResponse=true;
      const originalUnchanged=hash((await sdk.get(created.conversation.id)).branches.find(b=>b.id===created.branch.id))===originalHash;
      const audioReceived=!audioOutput||alt.p.events.some(e=>e.event.type==='response.output_audio.delta');
      rows.push({trial,modality:audioOutput?'generated audio':'text',audioReceived,firstQuestion:first,originalReply:second,alternativeReply:reply,preForkRecall,postForkAbsent,noDuplicateQuestion,noUnsolicitedResponse,originalUnchanged,
        prefixContainsPostFork:JSON.stringify(alt.data.history).includes(`CEDAR924${trial}`)});
      alt.p.close();await patch(alt.data.session.id,{status:'closed'});console.log(JSON.stringify({trial,preForkRecall,postForkAbsent,noDuplicateQuestion,originalUnchanged}));
    }
  }catch(error){rows.push({error:error instanceof Phase3ApiError?error.code:error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'LIVE_TRIAL_FAILED'});}
  finally{clearTimeout(deadline);for(const p of probes)p.close();await new Promise<void>(r=>server.close(()=>r()));db.close();}
  const passed=rows.length===(process.argv.includes('--audio-output')?2:3)&&rows.every(r=>r.preForkRecall&&r.postForkAbsent&&r.noDuplicateQuestion&&r.noUnsolicitedResponse&&r.originalUnchanged&&r.audioReceived&&!r.prefixContainsPostFork);
  const qualification={...unqualifiedRestore,testedAt:new Date().toISOString(),contextQualified:passed,preForkRecall:passed,postForkAbsent:passed,noDuplicateQuestion:passed,noUnsolicitedResponse:passed,scenarioHashes};
  let prior:any;try{prior=JSON.parse(await readFile('docs/phase3-restoration-results.json','utf8'));}catch{}
  const previousAttempts=prior?[...(prior.previousAttempts??[]),{testedAt:prior.qualification.testedAt,durationMs:prior.durationMs,rows:prior.rows}]:[];
  await mkdir('docs',{recursive:true});await writeFile('docs/phase3-restoration-results.json',JSON.stringify({qualification,mode:`live Boson ${process.argv.includes('--audio-output')?'generated audio':'text'}, mock appraisal; no physical microphone`,durationMs:Date.now()-started,timeBoxSeconds:180,previousAttempts,rows},null,2));
  console.log(`Restored-context qualification: ${passed?'PASS':'FAIL; restoration remains gated'}. Physical microphone untested.`);if(!passed)process.exitCode=1;
}
main().catch(()=>{console.error('Phase 3 probe failed; credentials and raw provider errors were not logged.');process.exitCode=1;});
