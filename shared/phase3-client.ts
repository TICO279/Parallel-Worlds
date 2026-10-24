import type { BranchHistoryItem,ProtocolEvent,Turn } from './domain';
import type { DurableConversation,DurableBranch,DurableBootstrap,Restoration,Timeline,RestoreQualification } from './phase3';
import type { ComparisonResult,ModelSuggestion } from './evaluation';
export interface Overview {schemaVersion:1;conversation:DurableConversation;branches:DurableBranch[];}
export interface Suggestion extends ModelSuggestion {schemaVersion:1;id:string;branchId:string;revision:number;status:'active'|'dismissed'|'unavailable';provider:string;tentative?:boolean;}
export interface AnalysisStatus {schemaVersion:1;id:string;conversationId:string;kind:'suggestion'|'evaluation';status:'queued'|'running'|'succeeded'|'failed';
  result?:ComparisonResult|Suggestion;error?:string;retryable?:boolean;attempts:number;}
export class Phase3ApiError extends Error {constructor(readonly status:number,readonly code:string,message:string){super(message);}}
/** Browser/mobile-web client. Server owns histories, checkpoints, eligibility, scoring and active selection. */
export class Phase3Client {
  constructor(private baseUrl='',private fetcher:typeof fetch=fetch){}
  async request<T>(path:string,options:RequestInit={}):Promise<T> {
    return this.transport<T>(`/api/v1${path}`,options);
  }
  /** Also supplies the legacy lifecycle/adaptation transport used by SessionRecorder. */
  async transport<T>(path:string,options:RequestInit={}):Promise<T> {
    const response=await this.fetcher.call(globalThis,`${this.baseUrl}${path}`,{credentials:'include',...options,headers:{'Content-Type':'application/json',...options.headers}});
    const body=await response.json();if(!response.ok)throw new Phase3ApiError(response.status,body.code??'REQUEST_FAILED',body.error??'Local request failed.');return body;
  }
  private mutation<T>(path:string,input:unknown,key:string=crypto.randomUUID(),signal?:AbortSignal) {return this.request<T>(path,{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(input),signal});}
  bootstrap(){return this.request<{schemaVersion:1;qualification:RestoreQualification;analysisProvider:string}>('/bootstrap');}
  list(){return this.request<{schemaVersion:1;conversations:{id:string;scenarioId:string;activeBranchId:string;createdAt:number}[]}>('/conversations');}
  create(scenarioId:string,key?:string){return this.mutation<{schemaVersion:1;conversation:DurableConversation;branch:DurableBranch}>('/conversations',{scenarioId},key);}
  get(id:string){return this.request<Overview>(`/conversations/${encodeURIComponent(id)}`);}
  timeline(id:string,cursor=0){return this.request<Timeline>(`/branches/${encodeURIComponent(id)}/timeline?cursor=${cursor}`);}
  fork(conversationId:string,sourceBranchId:string,targetUserTurnId:string,expectedSourceRevision:number,key?:string){return this.mutation<DurableBranch>(`/conversations/${encodeURIComponent(conversationId)}/branches`,{sourceBranchId,targetUserTurnId,expectedSourceRevision},key);}
  restore(c:DurableConversation,branchId:string,key?:string,signal?:AbortSignal){return this.mutation<Restoration>(`/conversations/${encodeURIComponent(c.id)}/restorations`,{branchId,expectedConversationRevision:c.revision,expectedActiveEpoch:c.activeEpoch},key,signal);}
  connectRestore(id:string,key?:string,signal?:AbortSignal){return this.mutation<DurableBootstrap>(`/restorations/${encodeURIComponent(id)}/connection-attempts`,{},key,signal);}
  restoration(id:string){return this.request<Restoration>(`/restorations/${encodeURIComponent(id)}`);}
  confirm(op:Restoration,status:'ready'|'failed',key?:string,signal?:AbortSignal){return this.mutation<Restoration>(`/restorations/${encodeURIComponent(op.id)}/events`,{attemptId:op.attemptId,status,prefixHash:op.prefixHash},key,signal);}
  record(sessionId:string,revision:number,turns:Turn[]){return this.request(`/sessions/${encodeURIComponent(sessionId)}/conversation`,{method:'PUT',body:JSON.stringify({revision,turns})});}
  suggestion(branchId:string){return this.request<{schemaVersion:1;suggestion:Suggestion|null}>(`/branches/${encodeURIComponent(branchId)}/suggestion`);}
  dismiss(branchId:string,key?:string){return this.mutation<Suggestion|null>(`/branches/${encodeURIComponent(branchId)}/suggestion-dismissals`,{},key);}
  analyze(conversationId:string,kind:'suggestion'|'evaluation',key?:string){return this.mutation<AnalysisStatus>(`/conversations/${encodeURIComponent(conversationId)}/analyses`,{kind},key);}
  analysis(id:string){return this.request<AnalysisStatus>(`/analyses/${encodeURIComponent(id)}`);}
  retry(id:string,key?:string){return this.mutation<AnalysisStatus>(`/analyses/${encodeURIComponent(id)}/retries`,{},key);}
  export(id:string){return this.request<unknown>(`/conversations/${encodeURIComponent(id)}/export`);}
}
export const isReplayEcho=(event:ProtocolEvent)=>event.type==='conversation.item.added'&&String((event.item as {id?:string})?.id??'').startsWith('pwseed_');
/** Transport adaptation only: the server supplied this exact ordered prefix. */
export function replayEvents(history:BranchHistoryItem[]):ProtocolEvent[] {
  return history.map((h,i)=>({type:'conversation.item.create',previous_item_id:i?`pwseed_${i-1}`:null,
    item:{id:`pwseed_${i}`,type:'message',role:h.role,content:[{type:h.role==='user'?'input_text':'text',text:h.text}]}}));
}
