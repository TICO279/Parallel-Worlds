import dotenv from 'dotenv';
import { writeFile,readFile } from 'node:fs/promises';
import fixture from '../test/fixtures/phase3-conversations.json';
import { LocalDatabase,hash } from '../server/persistence/database';
import { ConversationStore } from '../server/store';
import { BranchManager } from '../server/branches';
import { AnalysisService,DeepSeekAnalysis } from '../server/analysis';
import { AdaptationCoordinator } from '../server/adaptation/coordinator';
import { scenarios } from '../server/orchestrator';
import { unqualifiedRestore,type DurableBranch } from '../shared/phase3';
import type { Turn } from '../shared/domain';
async function main(){
  if(!process.argv.includes('--live'))throw new Error('Use --live for three bounded DeepSeek calls.');
  const project=dotenv.config({quiet:true}).parsed??{};if(!project.DEEPSEEK_API_KEY)throw new Error('Project key missing.');
  const db=new LocalDatabase(),store=new ConversationStore(undefined,db),config={provider:'mock' as const,model:'mock',timeoutMs:1500,maxDelta:.1};
  const coordinator=new AdaptationCoordinator(store,scenarios,config),manager=new BranchManager(db,store,config,{...unqualifiedRestore,contextQualified:true,preForkRecall:true,postForkAbsent:true,noDuplicateQuestion:true,noUnsolicitedResponse:true,scenarioHashes:{[scenarios[0].id]:hash(scenarios[0])}}),owner='fictional-analysis-probe';
  const c=manager.create(owner,'alex-first-date');
  async function record(branch:DurableBranch,lines:string[][]){
    const conversation=manager.conversation(owner,c.conversation.id),op=manager.restore(owner,conversation.id,{branchId:branch.id,expectedConversationRevision:conversation.revision,expectedActiveEpoch:conversation.activeEpoch}),a=manager.prepareAttachment(owner,op.id),id=a.attachment.sessionId;
    store.setBranch(id,{history:manager.history(owner,branch.id)});coordinator.initialize(id,'adaptive',a.checkpoint,undefined,false,undefined,branch.id);
    manager.restoreEvent(owner,op.id,{attemptId:a.op.attemptId!,prefixHash:op.prefixHash,status:'ready'});store.lifecycle(id,{status:'active'});
    const turns:Turn[]=lines.map(([role,text],i)=>({itemId:`t${i}`,role:role as Turn['role'],text,order:i,status:'complete',transcriptFinal:true,playbackComplete:role==='assistant',startedAt:i,updatedAt:i}));
    manager.validateSnapshot(owner,id,1,turns);store.snapshot(id,1,turns);await coordinator.enqueue(id);store.lifecycle(id,{status:'closed'});return id;
  }
  const id=await record(c.branch,fixture.original),service=new AnalysisService(manager,new DeepSeekAnalysis(project.DEEPSEEK_API_KEY,project.PHASE3_ANALYSIS_MODEL||'deepseek-flash'),15000);
  const suggestion=process.argv.includes('--evaluation-only')?null:service.request(owner,c.conversation.id,'suggestion');await service.drain();
  if(process.argv.includes('--suggestion-only')){
    const previous=JSON.parse(await readFile('docs/phase3-analysis-results.json','utf8'));
    previous.suggestionFollowUps??=[];if(previous.followUpSuggestion)previous.suggestionFollowUps.push(previous.followUpSuggestion);
    previous.followUpSuggestion={testedAt:new Date().toISOString(),job:service.publicJob(owner,suggestion!.id)};
    await writeFile('docs/phase3-analysis-results.json',JSON.stringify(previous,null,2));console.log(JSON.stringify(previous.followUpSuggestion));db.close();return;
  }
  const source=manager.branch(owner,c.branch.id),child=manager.fork(owner,c.conversation.id,{sourceBranchId:source.id,targetUserTurnId:`${id}/t${fixture.forkUserIndex}`,expectedSourceRevision:source.revision});
  await record(child,fixture.alternative);const evaluation=service.request(owner,c.conversation.id,'evaluation');await service.drain();
  if(process.argv.includes('--evaluation-only')) {
    const previous=JSON.parse(await readFile('docs/phase3-analysis-results.json','utf8'));previous.evaluationFollowUps??=[];if(previous.followUpEvaluation)previous.evaluationFollowUps.push(previous.followUpEvaluation);
    previous.followUpEvaluation={testedAt:new Date().toISOString(),job:service.publicJob(owner,evaluation.id)};
    await writeFile('docs/phase3-analysis-results.json',JSON.stringify(previous,null,2));console.log(JSON.stringify({status:previous.followUpEvaluation.job.status,result:previous.followUpEvaluation.job.result,calls:previous.followUpEvaluation.job.calls}));db.close();return;
  }
  const result={testedAt:new Date().toISOString(),mode:'Live DeepSeek, fictional deterministic fixture, mock state appraisal; no Boson or microphone calls',
    suggestion:service.publicJob(owner,suggestion!.id),evaluation:service.publicJob(owner,evaluation.id)};
  await writeFile('docs/phase3-analysis-results.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({suggestion:result.suggestion.status,evaluation:result.evaluation.status,suggestionCalls:result.suggestion.calls,evaluationCalls:result.evaluation.calls}));
  db.close();if(result.suggestion.status!=='succeeded'||result.evaluation.status!=='succeeded')process.exitCode=1;
}
main().catch(()=>{console.error('Analysis probe failed; no credentials or raw provider errors logged.');process.exitCode=1;});
