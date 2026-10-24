import { randomBytes, randomUUID } from 'node:crypto';
import type { Attachment, DurableBranch, DurableConversation, DurableTurn, Restoration, RestoreQualification, Timeline } from '../shared/phase3';
import type { BranchHistoryItem, StoredSession, Turn } from '../shared/domain';
import type { DynamicCharacterState } from '../shared/characterState';
import { LocalDatabase, DomainError, hash } from './persistence/database';
import { initialState } from './adaptation/engine';
import { initialBehavior } from './adaptation/policy';
import type { AdaptationConfig } from './adaptation/config';
import { scenarios } from './orchestrator';
import { ConversationStore, parseTurns } from './store';

const conflict = (code: string, message: string): never => { throw new DomainError(409, code, message); };
const complete = (t: Turn) => t.status === 'complete' && t.transcriptFinal && !t.transcriptionFailed && Boolean(t.text?.trim()) && (t.role === 'user' || t.playbackComplete === true);
const signature = (t: Turn) => ({ itemId:t.itemId,role:t.role,text:t.text,status:t.status,final:t.transcriptFinal,
  failed:!!t.transcriptionFailed,heard:!!t.playbackComplete,previous:t.previousItemId ?? null,response:t.responseId ?? null });
export class BranchManager {
  constructor(readonly db: LocalDatabase, readonly store: ConversationStore, readonly config: AdaptationConfig, readonly qualification: RestoreQualification) {
    store.onChange(session => this.observe(session));
  }
  conversation(owner: string, id: string) { return this.db.get<DurableConversation>('conversation', id, owner); }
  branch(owner: string, id: string) { return this.db.get<DurableBranch>('branch', id, owner); }
  turns(owner: string, id: string) { return this.branch(owner,id).turnIds.map(t => this.db.get<DurableTurn>('turn', t, owner)); }
  branches(owner: string, id: string) { this.conversation(owner,id); return this.db.all<DurableBranch>('branch',owner).filter(b => b.conversationId === id); }
  create(owner: string, scenarioId: string) {
    const scenario = scenarios.find(s=>s.id===scenarioId); if (!scenario) throw new DomainError(400,'INVALID_SCENARIO','Choose a valid scenario.');
    const id=randomUUID(), branchId=randomUUID(), now=Date.now();
    const state=initialState(scenario.character,`initial-${id}`,now); state.branchId=branchId;state.id=`${state.sessionId}:${branchId}:0`;
    state.behavior=initialBehavior(scenario.character,this.config.behaviorSeed??randomBytes(16).toString('hex'),this.config.behaviorVariation??0);
    const conversation:DurableConversation={schemaVersion:1,id,scenario,createdAt:now,revision:0,rootBranchId:branchId,activeBranchId:branchId,activeEpoch:0};
    const branch:DurableBranch={schemaVersion:1,id:branchId,conversationId:id,parentBranchId:null,forkTurnId:null,parentRevision:null,
      characterId:scenario.character.id,createdAt:now,revision:0,turnIds:[],initialCheckpointId:state.id,checkpointId:state.id};
    this.db.immutable('checkpoint',state.id,owner,state); this.db.put('conversation',id,owner,conversation); this.db.put('branch',branchId,owner,branch);
    return {schemaVersion:1 as const,conversation,branch};
  }
  history(owner:string,id:string):BranchHistoryItem[] {
    return this.turns(owner,id).map(n=>({nodeId:n.id,sessionId:n.sessionId,itemId:n.turn.itemId,role:n.turn.role,text:n.turn.text!}));
  }
  checkpoint(owner:string,branch:DurableBranch,prefix:DurableTurn[]) {
    let id=branch.initialCheckpointId;
    for(const n of prefix) if(n.turn.role==='user') {
      if(n.checkpointId) id=n.checkpointId;
      else {
        const attempt=this.store.get(n.sessionId).adaptation?.attempts.find(a=>a.turnId===n.turn.itemId);
        if(attempt?.status!=='failed') conflict('CHECKPOINT_UNAVAILABLE','Wait for the saved character checkpoint before restoring this moment.');
      }
    }
    return this.db.get<DynamicCharacterState>('checkpoint',id,owner);
  }
  prefixValid(turns:DurableTurn[]) {
    if(turns.length%2) return false;
    return turns.every((n,i)=>complete(n.turn)&&n.turn.role===(i%2?'assistant':'user'));
  }
  forkReason(owner:string,branch:DurableBranch,turns:DurableTurn[],index:number):string|undefined {
    if(index<0||turns[index]?.turn.role!=='user'||!complete(turns[index].turn)||!turns[index+1]||!complete(turns[index+1].turn)||turns[index+1].turn.role!=='assistant') return 'This exchange has not finished with a complete transcript and playback.';
    if(!this.prefixValid(turns.slice(0,index))) return 'Earlier interrupted or incomplete dialogue cannot be restored exactly.';
    try { this.checkpoint(owner,branch,turns.slice(0,index)); } catch { return 'The saved character checkpoint is not ready.'; }
  }
  timeline(owner:string,id:string,cursor=0):Timeline {
    const b=this.branch(owner,id), turns=this.turns(owner,id), end=Math.min(turns.length,cursor+80);
    return {schemaVersion:1,branchId:id,revision:b.revision,nodes:turns.slice(cursor,end).map((n,j)=>{
      const reason=this.forkReason(owner,b,turns,cursor+j);
      return {id:n.id,role:n.turn.role,text:n.turn.text,status:n.turn.status,rewindable:!reason,...(reason&&{reason})};
    }),nextCursor:end<turns.length?end:null};
  }
  fork(owner:string,conversationId:string,input:{sourceBranchId:string;targetUserTurnId:string;expectedSourceRevision:number}) {
    const c=this.conversation(owner,conversationId), source=this.branch(owner,input.sourceBranchId);
    if(source.conversationId!==c.id) conflict('WRONG_CONVERSATION','Choose a branch from this conversation.');
    if(source.id!==c.rootBranchId||this.branches(owner,c.id).length>=2) conflict('MVP_BRANCH_LIMIT','This demo supports one original and one alternative.');
    if(source.revision!==input.expectedSourceRevision) conflict('STALE_REVISION','Refresh the timeline before rewinding.');
    const turns=this.turns(owner,source.id), index=turns.findIndex(n=>n.id===input.targetUserTurnId);
    const reason=this.forkReason(owner,source,turns,index); if(reason) conflict('INVALID_FORK',reason);
    const prefix=turns.slice(0,index), checkpoint=this.checkpoint(owner,source,prefix), id=randomUUID();
    const branch:DurableBranch={schemaVersion:1,id,conversationId:c.id,parentBranchId:source.id,parentRevision:source.revision,
      forkTurnId:input.targetUserTurnId,characterId:source.characterId,createdAt:Date.now(),revision:0,
      turnIds:prefix.map(n=>n.id),initialCheckpointId:checkpoint.id,checkpointId:checkpoint.id};
    this.db.put('branch',id,owner,branch); return branch;
  }
  restore(owner:string,conversationId:string,input:{branchId:string;expectedConversationRevision:number;expectedActiveEpoch:number}) {
    const c=this.conversation(owner,conversationId), b=this.branch(owner,input.branchId), turns=this.turns(owner,b.id);
    if(b.conversationId!==c.id) conflict('WRONG_CONVERSATION','Choose a branch from this conversation.');
    if(c.revision!==input.expectedConversationRevision||c.activeEpoch!==input.expectedActiveEpoch) conflict('STALE_REVISION','Refresh the active path before connecting.');
    if(turns.length&&(!this.qualification.contextQualified||!this.qualification.preForkRecall||!this.qualification.postForkAbsent||!this.qualification.noDuplicateQuestion||!this.qualification.noUnsolicitedResponse||this.qualification.scenarioHashes?.[c.scenario.id]!==hash(c.scenario)))
      conflict('RESTORE_UNQUALIFIED','Restored-context tests have not passed. The original conversation remains available in the lab.');
    if(!this.prefixValid(turns)) conflict('INVALID_PREFIX','This path contains an interrupted or unfinished exchange. Rewind before it.');
    for(const a of this.db.all<Attachment>('attachment',owner)) if(a.conversationId===c.id&&a.status==='active'&&this.store.get(a.sessionId).status==='active') conflict('SESSION_ACTIVE','End the current conversation before restoring a path.');
    const checkpoint=this.checkpoint(owner,b,turns);
    const epoch=Math.max(c.activeEpoch,...this.db.all<Attachment>('attachment',owner).filter(a=>a.conversationId===c.id).map(a=>a.epoch))+1;
    c.revision++; this.db.put('conversation',c.id,owner,c);
    const op:Restoration={schemaVersion:1,id:randomUUID(),conversationId:c.id,branchId:b.id,branchRevision:b.revision,
      previousBranchId:c.activeBranchId,expectedConversationRevision:c.revision,epoch,prefixHash:hash(this.history(owner,b.id)),
      checkpointId:checkpoint.id,status:'prepared',createdAt:Date.now(),expiresAt:Date.now()+120000};
    this.db.put('restore',op.id,owner,op); return op;
  }
  prepareAttachment(owner:string,restoreId:string) {
    const op=this.db.get<Restoration>('restore',restoreId,owner), c=this.conversation(owner,op.conversationId);
    if(!['prepared','connecting'].includes(op.status)||op.expiresAt<Date.now()||c.revision!==op.expectedConversationRevision) conflict('RESTORE_EXPIRED','Restore attempt expired or was superseded. Refresh and try again.');
    if(op.sessionId) { const old=this.db.get<Attachment>('attachment',op.sessionId,owner); old.status='closed'; this.db.put('attachment',old.sessionId,owner,old); }
    const session=this.store.create(c.scenario), attemptId=randomUUID();
    const attachment:Attachment={sessionId:session.id,owner,conversationId:c.id,branchId:op.branchId,epoch:op.epoch,
      baseTurnIds:[...this.branch(owner,op.branchId).turnIds],restoreId:op.id,status:'preparing'};
    op.sessionId=session.id; op.attemptId=attemptId; op.status='connecting';
    this.db.put('attachment',session.id,owner,attachment); this.db.put('restore',op.id,owner,op);
    return {op,attachment,scenario:c.scenario,checkpoint:this.db.get<DynamicCharacterState>('checkpoint',op.checkpointId,owner)};
  }
  restoreEvent(owner:string,id:string,input:{attemptId:string;status:'ready'|'failed';prefixHash:string}) {
    const op=this.db.get<Restoration>('restore',id,owner), c=this.conversation(owner,op.conversationId);
    if(op.attemptId!==input.attemptId||op.prefixHash!==input.prefixHash) conflict('STALE_ATTEMPT','A different connection attempt is current.');
    if(op.status===input.status) return op;
    if(op.status!=='connecting'||op.expiresAt<Date.now()||c.revision!==op.expectedConversationRevision) conflict('STALE_ATTEMPT','This restoration was superseded or expired.');
    const a=this.db.get<Attachment>('attachment',op.sessionId!,owner);
    if(input.status==='ready'&&['closed','error'].includes(this.store.get(a.sessionId).status))conflict('STALE_SESSION','A closed connection cannot activate a restored branch.');
    if(this.branch(owner,op.branchId).revision!==op.branchRevision) conflict('STALE_REVISION','The branch changed during restoration.');
    op.status=input.status; a.status=input.status==='ready'?'active':'closed';
    if(input.status==='ready') { c.activeBranchId=op.branchId; c.activeEpoch=op.epoch; c.revision++; this.db.put('conversation',c.id,owner,c); }
    this.db.put('attachment',a.sessionId,owner,a); this.db.put('restore',id,owner,op);
    if(input.status==='failed')this.store.lifecycle(a.sessionId,{status:'error'});
    return op;
  }
  attachment(owner:string,id:string) { return this.db.get<Attachment>('attachment',id,owner); }
  validateSnapshot(owner:string,id:string,revision:number,raw:unknown) {
    const a=this.attachment(owner,id), c=this.conversation(owner,a.conversationId), session=this.store.get(id);
    const turns=parseTurns(raw);
    const identical=hash(turns.map(signature))===hash(session.turns.map(signature));
    // A lost final response may be retried after closure. Acknowledge unchanged observations only.
    if((a.status==='closed'||session.status==='closed'||session.status==='error')&&identical)return;
    if(a.status!=='active'||c.activeBranchId!==a.branchId||c.activeEpoch!==a.epoch||session.status==='closed'||session.status==='error') conflict('STALE_SESSION','This Realtime session no longer owns the active path.');
    if(revision<=session.revision) {
      if(revision===session.revision&&hash(turns.map(signature))!==hash(session.turns.map(signature))) conflict('REVISION_REUSED','This recording revision contains different content.');
      return;
    }
    const ids=new Set(turns.map(t=>t.itemId));
    if(session.turns.some(t=>!ids.has(t.itemId))) conflict('HISTORY_REMOVED','A recording cannot remove previous turns.');
    for(const old of session.turns) {
      const next=turns.find(t=>t.itemId===old.itemId)!;
      const frozen=complete(old);
      if(old.role!==next.role||frozen&&(old.text!==next.text||!complete(next))||old.status==='interrupted'&&next.status!=='interrupted') conflict('IMMUTABLE_TURN','Finalized dialogue cannot be rewritten.');
    }
    for(let i=0;i<turns.length;i++) {
      const t=turns[i], p=t.previousItemId;
      if(t.itemId.startsWith('pwseed_')||p&&p!==turns[i-1]?.itemId&&!(i===0&&p===`pwseed_${a.baseTurnIds.length-1}`)) conflict('INVALID_ORDER','The recorded predecessor chain is incomplete or out of order.');
    }
  }
  private observe(session:StoredSession) {
    const a=this.db.maybe<Attachment>('attachment',session.id); if(!a||a.status!=='active') return;
    const owner=a.owner,c=this.conversation(owner,a.conversationId); if(c.activeEpoch!==a.epoch||c.activeBranchId!==a.branchId) return;
    this.db.transaction(()=>{
      const b=this.branch(owner,a.branchId); let changed=false;
      const ids=[...a.baseTurnIds];
      for(const t of session.turns) {
        const id=`${session.id}/${t.itemId}`, prior=this.db.maybe<DurableTurn>('turn',id,owner);
        const checkpoint=session.adaptation?.states.find(s=>s.lastProcessedTurnId===t.itemId);
        if(checkpoint) this.db.immutable('checkpoint',checkpoint.id,owner,checkpoint);
        const next:DurableTurn={id,sessionId:session.id,branchId:b.id,turn:t,...((checkpoint?.id??prior?.checkpointId)&&{checkpointId:checkpoint?.id??prior?.checkpointId})};
        if(!prior||hash(signature(prior.turn))!==hash(signature(t))||prior.checkpointId!==next.checkpointId) { changed=true; this.db.put('turn',id,owner,next); }
        ids.push(id);
      }
      if(hash(ids)!==hash(b.turnIds)) changed=true;
      const last=session.adaptation?.states.filter(s=>s.version>0).at(-1);
      if(last) b.checkpointId=last.id;
      if(changed) { b.turnIds=ids; b.revision++; this.db.put('branch',b.id,owner,b); }
      if(['closed','error'].includes(session.status)) { a.status='closed'; this.db.put('attachment',a.sessionId,owner,a); }
    });
  }
  export(owner:string,id:string) {
    const conversation=this.conversation(owner,id), branches=this.branches(owner,id), turnIds=[...new Set(branches.flatMap(b=>b.turnIds))];
    const turns=turnIds.map(t=>this.db.get<DurableTurn>('turn',t,owner));
    const checkpoints=[...new Set([...branches.flatMap(b=>[b.initialCheckpointId,b.checkpointId]),...turns.flatMap(t=>t.checkpointId?[t.checkpointId]:[])])].map(id=>this.db.get('checkpoint',id,owner));
    return {schemaVersion:1,conversation,branches,turns,checkpoints,sessions:this.db.all<Attachment>('attachment',owner).filter(a=>a.conversationId===id).map(a=>this.store.get(a.sessionId))};
  }
}
