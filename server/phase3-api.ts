import { Router, type RequestHandler } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { conversationInput, forkInput, restoreInput, restoreEvent, unqualifiedRestore, type RestoreQualification, type Attachment } from '../shared/phase3';
import { LocalDatabase,DomainError,hash } from './persistence/database';
import { BranchManager } from './branches';
import { AnalysisService,DeepSeekAnalysis,MockAnalysis,type AnalysisProvider } from './analysis';
import { buildHiggsConfig,mintCredential } from './higgs';
import type { ConversationStore } from './store';
import type { AdaptationCoordinator } from './adaptation/coordinator';
import type { AdaptationConfig } from './adaptation/config';
import { scenarios } from './orchestrator';
export interface Phase3Options {db?:LocalDatabase;qualification?:RestoreQualification;analysisProvider?:AnalysisProvider;analysisTimeoutMs?:number;}
const cookieName='pw_device';
export const ownerForCookie=(token:string)=>createHash('sha256').update(token).digest('hex');
export function createPhase3(options:Phase3Options,store:ConversationStore,coordinator:AdaptationCoordinator,config:AdaptationConfig,apiKey?:string,fetcher?:typeof fetch) {
  const db=options.db??new LocalDatabase(),manager=new BranchManager(db,store,config,options.qualification??unqualifiedRestore);
  const provider:AnalysisProvider=options.analysisProvider??(config.provider==='deepseek'?new DeepSeekAnalysis(config.deepSeekKey!,config.model):new MockAnalysis());
  const analysis=new AnalysisService(manager,provider,options.analysisTimeoutMs??15000),router=Router();
  const readCookie=(header:string|undefined)=>header?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  const authorize:RequestHandler=(req,res,next)=>{
    let token=readCookie(req.get('cookie'));
    if(!token||!/^[a-f0-9]{64}$/.test(token)||!db.maybe('device',ownerForCookie(token))) {
      token=randomBytes(32).toString('hex');const id=ownerForCookie(token);db.put('device',id,id,{createdAt:Date.now()});
      res.cookie(cookieName,token,{httpOnly:true,sameSite:'strict',maxAge:31536000000,path:'/'});
    }
    res.locals.owner=ownerForCookie(token);next();
  };
  router.use(authorize);
  router.get('/bootstrap',(_req,res)=>res.json({schemaVersion:1,qualification:manager.qualification,analysisProvider:provider.name,analysisModel:provider.model}));
  router.get('/conversations',(_req,res)=>res.json({schemaVersion:1,conversations:db.all<any>('conversation',res.locals.owner).map(c=>({id:c.id,scenarioId:c.scenario.id,createdAt:c.createdAt,activeBranchId:c.activeBranchId}))}));
  router.post('/conversations',(req,res)=>{
    const input=conversationInput.parse(req.body);res.status(201).json(db.mutate(res.locals.owner,req.get('idempotency-key'),'create-conversation',input,()=>manager.create(res.locals.owner,input.scenarioId)));
  });
  router.get('/conversations/:id',(req,res)=>res.json({schemaVersion:1,conversation:manager.conversation(res.locals.owner,String(req.params.id)),branches:manager.branches(res.locals.owner,String(req.params.id))}));
  router.get('/conversations/:id/branches',(req,res)=>res.json({schemaVersion:1,branches:manager.branches(res.locals.owner,String(req.params.id))}));
  router.get('/branches/:id/timeline',(req,res)=>{
    const cursor=z.coerce.number().int().nonnegative().max(2000).parse(req.query.cursor??0);res.json(manager.timeline(res.locals.owner,String(req.params.id),cursor));
  });
  router.post('/conversations/:id/branches',(req,res)=>{
    const input=forkInput.parse(req.body);res.status(201).json(db.mutate(res.locals.owner,req.get('idempotency-key'),`fork:${req.params.id}`,input,()=>manager.fork(res.locals.owner,String(req.params.id),input)));
  });
  router.post('/conversations/:id/restorations',(req,res)=>{
    const input=restoreInput.parse(req.body);res.status(201).json(db.mutate(res.locals.owner,req.get('idempotency-key'),`restore:${req.params.id}`,input,()=>manager.restore(res.locals.owner,String(req.params.id),input)));
  });
  router.get('/restorations/:id',(req,res)=>res.json(db.get('restore',String(req.params.id),res.locals.owner)));
  router.post('/restorations/:id/connection-attempts',async(req,res)=>{
    // Network work stays outside the SQLite transaction. Never put a credential in the idempotency cache.
    const credential=await mintCredential(apiKey,fetcher);let executed=false;
    const result=db.mutate(res.locals.owner,req.get('idempotency-key'),`attempt:${req.params.id}`,{},()=>{
      executed=true;const result=manager.prepareAttachment(res.locals.owner,String(req.params.id));
      if(hash(result.scenario)!==hash(scenarios.find(s=>s.id===result.scenario.id)))throw new DomainError(409,'PROFILE_CHANGED','The authored profile changed. Keep this history for inspection and start a new conversation.');
      const history=manager.history(res.locals.owner,result.op.branchId);
      store.setBranch(result.attachment.sessionId,{history,restoredFrom:{sessionId:result.checkpoint.sessionId,turnId:result.checkpoint.lastProcessedTurnId??'initial',stateVersion:result.checkpoint.version}});
      coordinator.initialize(result.attachment.sessionId,'adaptive',result.checkpoint,undefined,false,undefined,result.op.branchId);
      return {sessionId:result.attachment.sessionId};
    });
    if(!executed)throw new DomainError(409,'CONNECTION_RETRY_REQUIRED','This attempt was already issued. Use a new connection-attempt key to replace an uncertain socket.');
    const attachment=manager.attachment(res.locals.owner,result.sessionId),restoration=db.get<any>('restore',String(req.params.id),res.locals.owner);
    res.status(201).json({session:store.get(result.sessionId),config:buildHiggsConfig({instructions:coordinator.instructions(result.sessionId).instructions,voice:'default',language:'en'}),
      credential,attachment,restoration,history:manager.history(res.locals.owner,attachment.branchId)});
  });
  router.post('/restorations/:id/events',(req,res)=>{
    const input=restoreEvent.parse(req.body);res.json(db.mutate(res.locals.owner,req.get('idempotency-key'),`restore-event:${req.params.id}`,input,()=>manager.restoreEvent(res.locals.owner,String(req.params.id),input)));
  });
  router.put('/sessions/:id/conversation',(req,res)=>{
    const input=z.strictObject({revision:z.number().int().positive(),turns:z.unknown()}).parse(req.body),id=String(req.params.id);
    manager.validateSnapshot(res.locals.owner,id,input.revision,input.turns);res.json(store.snapshot(id,input.revision,input.turns));
  });
  router.get('/branches/:id/suggestion',(req,res)=>res.json({schemaVersion:1,suggestion:analysis.suggestion(res.locals.owner,String(req.params.id))}));
  router.post('/branches/:id/suggestion-dismissals',(req,res)=>res.json(db.mutate(res.locals.owner,req.get('idempotency-key'),`dismiss:${req.params.id}`,{},()=>analysis.dismiss(res.locals.owner,String(req.params.id)))));
  router.post('/conversations/:id/analyses',(req,res)=>{
    const input=z.strictObject({kind:z.enum(['suggestion','evaluation'])}).parse(req.body);
    const job=db.mutate(res.locals.owner,req.get('idempotency-key'),`analysis:${req.params.id}`,input,()=>({id:analysis.request(res.locals.owner,String(req.params.id),input.kind).id}));
    res.status(202).json(analysis.publicJob(res.locals.owner,job.id));
  });
  router.get('/analyses/:id',(req,res)=>res.json(analysis.publicJob(res.locals.owner,String(req.params.id))));
  router.post('/analyses/:id/retries',(req,res)=>res.json(db.mutate(res.locals.owner,req.get('idempotency-key'),`analysis-retry:${req.params.id}`,{},()=>analysis.retry(res.locals.owner,String(req.params.id)))));
  router.get('/conversations/:id/export',(req,res)=>res.attachment('parallel-worlds-branches.json').json({...manager.export(res.locals.owner,String(req.params.id)),
    analyses:db.all<any>('analysis-job',res.locals.owner).filter(j=>j.conversationId===req.params.id).map(({branches:_,...j})=>j)}));
  // Automatic detection after the third completed exchange. One recommendation is enough for the demo.
  store.onChange(session=>{
    const a=db.maybe<Attachment>('attachment',session.id);if(!a||a.status!=='active')return;
    const b=manager.branch(a.owner,a.branchId),turns=manager.turns(a.owner,b.id);
    if(turns.length<6||!manager.prefixValid(turns)||db.maybe('suggestion-cadence',b.id,a.owner))return;
    try{analysis.request(a.owner,b.conversationId,'suggestion');db.put('suggestion-cadence',b.id,a.owner,{requested:true});}catch{/* no analysis may break recording */}
  });
  // Legacy session APIs must not bypass ownership or the durable recording checks.
  const guard:RequestHandler=(req,res,next)=>{
    const id=req.params.id as string|undefined, a=id?db.maybe<Attachment>('attachment',id):undefined;
    if(!a)return next();
    const token=readCookie(req.get('cookie'));
    if(!token||ownerForCookie(token)!==a.owner) return next(new DomainError(404,'NOT_FOUND','Session not found.'));
    if(req.method==='PUT')return next(new DomainError(409,'DURABLE_RECORDING_REQUIRED','Use the versioned recording route for this branch.'));
    next();
  };
  const checkHistory=(header:string|undefined,raw:unknown)=>{
    if(!Array.isArray(raw))return;const token=readCookie(header),owner=token?ownerForCookie(token):undefined;
    for(const entry of raw){const a=db.maybe<Attachment>('attachment',String(entry?.sessionId));if(a&&a.owner!==owner)throw new DomainError(404,'NOT_FOUND','Source session not found.');}
  };
  return {router,manager,analysis,guard,checkHistory};
}
