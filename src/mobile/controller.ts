import { Phase3Client, Phase3ApiError, HiggsClient, SessionRecorder, emptyConversation, reduceTranscript,
  orderedTurns, replayEvents, isReplayEcho, type ClientOptions, type DurableBootstrap, type TimelineNode,
  type Overview, type ComparisonResult, type AnalysisStatus, type ConnectionState } from '../../client';
import type { Scenario, ProtocolEvent, Turn } from '../../shared/domain';
import type { AdaptationView } from '../adaptationPolling';
import type { api as recorderRequest } from '../recording';
import type { MobileActions, MobileState } from './types';

export type MobileApi = Pick<Phase3Client, 'bootstrap'|'list'|'create'|'get'|'timeline'|'fork'|'restore'|'connectRestore'|
  'restoration'|'confirm'|'suggestion'|'dismiss'|'analyze'|'analysis'|'retry'|'transport'>;
export interface VoiceClient {
  readonly connectionState: ConnectionState;
  connect(): Promise<void>; disconnect(): Promise<void>; toggleMic(): Promise<void>;
  queueInstructions: HiggsClient['queueInstructions'];
}
export interface Recorder {
  readonly id: string; readonly synced: boolean;
  snapshot(turns: Turn[]): void; status: SessionRecorder['status'];
  waitForSync(signal: AbortSignal, timeoutMs?: number): Promise<void>; dispose(): void;
}
export interface MobileDependencies {
  api?: MobileApi;
  voiceFactory?: (options: ClientOptions) => VoiceClient;
  recorderFactory?: (id: string, status: (message: string|null) => void, request: typeof recorderRequest, url: string) => Recorder;
  pollIntervalMs?: number;
  requestKey?: () => string;
}
interface Context {
  voice: VoiceClient; boot?: DurableBootstrap; recorder?: Recorder; local: ReturnType<typeof emptyConversation>;
  retired: boolean; terminal: boolean; cancelled: boolean; ready: Promise<boolean>; resolveReady: (ready: boolean) => void;
  adaptationFailures: number;
  epoch: number;
}
const initialState = (): MobileState => ({ loading: true, profile: null, configured: null, qualification: null,
  conversations: [], overview: null, branchId: '', nodes: [], connection: 'idle', activity: 'idle', mic: false,
  level: 0, operating: null, error: null, warning: null, suggestion: null, evaluation: null, comparison: null });
const live = (s: ConnectionState) => ['ready','connecting','closing'].includes(s);
const finalized = (event: ProtocolEvent) => event.type.endsWith('.done') || event.type.endsWith('.completed') ||
  event.type.endsWith('.failed') || ['conversation.item.added','input_audio_buffer.committed','client.interrupted',
    'client.playback_complete','client.closed'].includes(event.type);

/** UI orchestration only. All historical paths, eligibility, checkpoints and scores remain server-owned. */
export class MobileController implements MobileActions {
  private state = initialState();
  private listeners = new Set<() => void>();
  private readonly api: MobileApi;
  private readonly deps: MobileDependencies;
  private current?: Context;
  private contexts = new Set<Context>();
  private epoch = 0;
  private disposed = false;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private requestController = new AbortController();
  private createKey?: string;
  private forkAttempt?: { conversationId: string; target: string; branchId: string; revision: number; key: string };
  private evaluationAttempt?: { conversationId: string; signature: string; key: string };
  private evaluationRetry?: { jobId: string; attempts: number; key: string };
  private dismissAttempt?: { suggestionId: string; key: string };

  constructor(deps: MobileDependencies = {}) {
    this.deps = deps;
    this.api = deps.api ?? new Phase3Client('',(url,options)=>globalThis.fetch(url,{...options,
      signal:options?.signal?AbortSignal.any([options.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)}));
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  get needsUnloadWarning() { return Boolean(this.state.operating || live(this.state.connection) || [...this.contexts].some(c => c.recorder && !c.recorder.synced && !c.terminal)); }
  get canLeave() { return !this.needsUnloadWarning; }
  private key() { return this.deps.requestKey?.() ?? crypto.randomUUID(); }
  private active(epoch = this.epoch) { return !this.disposed && epoch === this.epoch; }
  private currentContext(ctx: Context) { return this.active(ctx.epoch) && this.current === ctx && !ctx.retired; }
  private publish(next: Partial<MobileState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...next }; this.listeners.forEach(listener => listener());
  }
  private message(error: unknown) {
    if (error instanceof Phase3ApiError) {
      const messages: Record<string,string> = {
        STALE_REVISION: 'The saved path changed. It has been refreshed; try the action again.',
        STALE_SESSION: 'This connection is no longer current. Reconnect from the saved path.',
        STALE_ATTEMPT: 'That connection attempt is no longer current. Reconnect to the saved path.',
        CHECKPOINT_UNAVAILABLE: 'Alex’s saved context is still being prepared. Wait for this exchange to finish, then try again.',
        SESSION_ACTIVE: 'This conversation is open in another session. End it there before reconnecting.',
        RESTORE_UNQUALIFIED: 'This saved context cannot be restored yet. Your original conversation is preserved.',
        PROFILE_CHANGED: 'Alex’s profile changed. Your saved history is preserved; start a new conversation.',
        MVP_BRANCH_LIMIT: 'This conversation already has an alternative. Revisit either saved path or start a new conversation.',
        CONNECTION_RETRY_REQUIRED: 'The previous connection is uncertain. Tap the microphone again to replace it safely.',
        RESTORE_EXPIRED: 'The connection attempt expired. Tap the microphone to reconnect.',
      };
      return messages[error.code] ?? error.message;
    }
    return error instanceof Error ? error.message : 'The action could not complete. Your saved conversation is preserved.';
  }
  private async run<T>(label: string, action: () => Promise<T>, rethrow = false): Promise<T|undefined> {
    if (this.disposed || this.state.operating) return;
    const epoch = this.epoch; this.publish({ operating: label, error: null });
    try { return await action(); }
    catch (error) {
      if (this.active(epoch)) {
        this.publish({ error: this.message(error) });
        const pendingFork=this.forkAttempt;
        if (pendingFork||error instanceof Phase3ApiError && ['STALE_REVISION','STALE_ATTEMPT'].includes(error.code)) await this.refreshCore().catch(() => {});
        const recovered=pendingFork&&this.state.overview?.branches.some(b=>b.id===this.state.branchId&&b.parentBranchId===pendingFork.branchId&&b.forkTurnId===pendingFork.target);
        if(rethrow&&!recovered)throw error;
      }
    } finally { if (this.active(epoch)) this.publish({ operating: null }); }
  }

  async initialize() {
    // React StrictMode may clean up and attach the same controller once more.
    this.disposed = false; const epoch = ++this.epoch;
    this.requestController.abort(); this.requestController = new AbortController(); clearTimeout(this.pollTimer);
    this.publish({ loading: true, error: null, operating: null });
    try {
      const capability = await this.api.bootstrap(); if (!this.active(epoch)) return;
      const [scenarios, health, dates] = await Promise.all([
        this.api.transport<Scenario[]>('/api/scenarios'),
        this.api.transport<{credentialsConfigured:boolean}>('/api/health'), this.api.list(),
      ]);
      if (!this.active(epoch)) return;
      const profile = scenarios.find(s => s.id === 'alex-first-date');
      if (!profile) throw new Error('Alex is not available on this server.');
      this.publish({ profile, configured: health.credentialsConfigured, qualification: capability.qualification,
        conversations: dates.conversations.filter(c => c.scenarioId === profile.id), loading: false });
      this.schedulePoll(epoch);
    } catch (error) { if (this.active(epoch)) this.publish({ loading: false, error: this.message(error) }); }
  }

  async create(): Promise<string|null> {
    const result = await this.run('Opening a new conversation…', async () => {
      await this.stopAndSynchronize();
      this.createKey ??= this.key();
      const created = await this.api.create('alex-first-date', this.createKey);
      if (!this.active()) return null;
      this.createKey = undefined;
      const overview: Overview = {schemaVersion:1,conversation:created.conversation,branches:[created.branch]};
      this.publish({overview,branchId:created.branch.id,nodes:[],suggestion:null,evaluation:null,comparison:null,warning:null,
        conversations:[...this.state.conversations.filter(c=>c.id!==created.conversation.id),{id:created.conversation.id,
          scenarioId:created.conversation.scenario.id,activeBranchId:created.branch.id,createdAt:created.conversation.createdAt}]});
      this.forkAttempt = undefined; this.evaluationAttempt = undefined;
      return created.conversation.id;
    });
    return result ?? null;
  }
  async open(id: string) {
    await this.run('Opening your saved conversation…', async () => {
      await this.stopAndSynchronize();
      const overview = await this.api.get(id);
      if (overview.conversation.scenario.id !== 'alex-first-date') throw new Error('Choose a saved conversation with Alex.');
      this.publish({overview,branchId:overview.conversation.activeBranchId,nodes:[],suggestion:null,evaluation:null,comparison:null,warning:null});
      this.forkAttempt = undefined; this.evaluationAttempt = undefined; await this.refreshCore();
    });
  }
  async refresh() {
    if(!this.state.profile){await this.initialize();return;}
    await this.run('Refreshing your saved path…',async()=>{
      const [dates,health]=await Promise.all([this.api.list(),this.api.transport<{credentialsConfigured:boolean}>('/api/health')]);
      this.publish({conversations:dates.conversations.filter(c=>c.scenarioId==='alex-first-date'),configured:health.credentialsConfigured});
      await this.refreshCore();
    });
  }
  private async timeline(branchId: string) {
    const nodes: TimelineNode[] = []; let cursor: number|null = 0; const seen = new Set<number>();
    while (cursor !== null) {
      if (seen.has(cursor)) throw new Error('The timeline could not be loaded. Try refreshing.');
      seen.add(cursor); const page = await this.api.timeline(branchId,cursor); nodes.push(...page.nodes); cursor=page.nextCursor;
    }
    return nodes;
  }
  private displayNodes(ctx: Context, saved: TimelineNode[]) {
    if (!ctx.boot) return saved;
    const byId = new Map(saved.map(n=>[n.id,n]));
    return [...ctx.boot.history.map(h=>byId.get(h.nodeId)??{id:h.nodeId,role:h.role,text:h.text,status:'complete' as const,rewindable:false}),
      ...orderedTurns(ctx.local).map(t=>{
        const id=`${ctx.boot!.session.id}/${t.itemId}`, original=byId.get(id), matching=original?.text===t.text&&original?.status===t.status;
        return {id,role:t.role,text:t.text,status:t.status,rewindable:matching?original!.rewindable:false,
          reason:matching?original?.reason:'Waiting for the exchange to finish and save.'};
      })];
  }
  private async refreshCore() {
    const id=this.state.overview?.conversation.id, branchId=this.state.branchId,epoch=this.epoch;
    if(!id||!branchId)return;
    const [overview,nodes,response]=await Promise.all([this.api.get(id),this.timeline(branchId),this.api.suggestion(branchId)]);
    if(!this.active(epoch)||this.state.overview?.conversation.id!==id||this.state.branchId!==branchId)return;
    const pending=this.forkAttempt;
    const recovered=pending?.conversationId===id&&pending.branchId===branchId?overview.branches.find(b=>b.parentBranchId===pending.branchId&&b.forkTurnId===pending.target):undefined;
    if(recovered){
      const [recoveredNodes,recoveredSuggestion]=await Promise.all([this.timeline(recovered.id),this.api.suggestion(recovered.id)]);
      if(!this.active(epoch)||this.state.overview?.conversation.id!==id||this.state.branchId!==branchId)return;
      this.forkAttempt=undefined;this.evaluationAttempt=undefined;
      this.publish({overview,branchId:recovered.id,nodes:recoveredNodes,suggestion:recoveredSuggestion.suggestion,error:null,
        warning:'Your saved alternative is ready. Tap the microphone to continue.',evaluation:null,comparison:null});return;
    }
    const ctx=this.current;
    this.publish({overview,nodes:ctx&&!ctx.retired?this.displayNodes(ctx,nodes):nodes,suggestion:response.suggestion});
  }

  private makeContext() {
    let resolveReady!: (ready:boolean)=>void;
    const ready=new Promise<boolean>(resolve=>{resolveReady=resolve;});
    const ctx={local:emptyConversation(),retired:false,terminal:false,cancelled:false,ready,resolveReady,adaptationFailures:0,epoch:this.epoch} as Context;
    const options: ClientOptions = {
      bootstrap: async signal => {
        for(const pending of [...this.contexts])if(pending!==ctx&&!pending.retired){
          if(pending.recorder&&!pending.terminal)await pending.recorder.waitForSync(signal);
          pending.recorder?.dispose();pending.retired=true;this.contexts.delete(pending);
        }
        signal.throwIfAborted();
        const id=this.state.overview?.conversation.id;if(!id)throw new Error('Open Alex’s profile and start a conversation first.');
        const overview=await this.api.get(id);signal.throwIfAborted();
        const branch=this.state.branchId||overview.conversation.activeBranchId;
        const restoration=await this.api.restore(overview.conversation,branch,this.key(),signal);
        return this.api.connectRestore(restoration.id,this.key(),signal);
      },
      onBootstrap: data => {
        if(!this.currentContext(ctx))return;
        ctx.boot=data as DurableBootstrap;ctx.local=emptyConversation();
        const request: typeof recorderRequest = async(url,options) => {
          try{return await this.api.transport(url,options);}
          catch(error){
            if(error instanceof Phase3ApiError&&['STALE_SESSION','IMMUTABLE_TURN','INVALID_ORDER','REVISION_REUSED','HISTORY_REMOVED'].includes(error.code)){
              ctx.terminal=true;ctx.recorder?.dispose();
              if(this.currentContext(ctx))this.publish({warning:'Recording was rejected. Your saved path is intact; unsaved local speech is not part of it. Reconnect from server history.'});
              void ctx.voice.disconnect();
            }throw error;
          }
        };
        ctx.recorder=this.deps.recorderFactory?.(data.session.id,message=>{if(this.currentContext(ctx)&&!ctx.terminal)this.publish({warning:message});},request,`/api/v1/sessions/${data.session.id}/conversation`)
          ??new SessionRecorder(data.session.id,message=>{if(this.currentContext(ctx)&&!ctx.terminal)this.publish({warning:message});},request,`/api/v1/sessions/${data.session.id}/conversation`);
        this.publish({nodes:this.displayNodes(ctx,[])});
      },
      seed:()=>replayEvents(ctx.boot?.history??[]),
      confirmReady:async signal=>{
        if(!ctx.boot)throw new Error('The saved path is unavailable.');
        ctx.boot.restoration=await this.api.confirm(ctx.boot.restoration,'ready',this.key(),signal);
      },
      onState: connection=>{
        if(connection==='ready')ctx.resolveReady(true);
        if(connection==='closed')ctx.resolveReady(false);
        if(this.currentContext(ctx))this.publish({connection});
      },
      onActivity:activity=>{if(this.currentContext(ctx))this.publish({activity});},
      onMic:mic=>{if(this.currentContext(ctx))this.publish({mic});},
      onLevel:level=>{if(this.currentContext(ctx))this.publish({level});},
      onError:message=>{
        if(this.currentContext(ctx)&&!ctx.cancelled)this.publish({error:message});
        if(ctx.boot&&ctx.boot.restoration.status==='connecting')void this.api.confirm(ctx.boot.restoration,'failed',this.key()).catch(()=>{});
      },
      onApplication:(version,status)=>{
        const id=ctx.boot?.session.id;if(!id)return;
        void this.api.transport(`/api/sessions/${id}/adaptation/application`,{method:'POST',body:JSON.stringify({version,status})})
          .catch(()=>{if(this.currentContext(ctx))this.publish({warning:'The guidance receipt could not be saved. Audio can continue.'});});
      },
      onLatency:metric=>{
        const id=ctx.boot?.session.id;if(id)void this.api.transport(`/api/sessions/${id}/latencies`,{method:'POST',body:JSON.stringify(metric)})
          .catch(()=>{if(this.currentContext(ctx))this.publish({warning:'A response timing measurement could not be saved.'});});
      },
      onEvent:event=>{
        if(ctx.retired||isReplayEcho(event))return;
        if(event.type==='session.created')ctx.recorder?.status('active',(event.session as {id?:string})?.id);
        ctx.local=reduceTranscript(ctx.local,event,Date.now());
        if(!ctx.terminal){if(finalized(event)&&ctx.boot?.restoration.status==='ready')ctx.recorder?.snapshot(orderedTurns(ctx.local));if(event.type==='client.closed')ctx.recorder?.status('closed');}
        if(this.currentContext(ctx))this.publish({nodes:this.displayNodes(ctx,this.state.nodes)});
      },
    };
    ctx.voice=this.deps.voiceFactory?.(options)??new HiggsClient(options);this.contexts.add(ctx);return ctx;
  }
  private async start(withMic:boolean) {
    if(live(this.state.connection))return;
    if(!this.state.overview){this.publish({error:'Open Alex’s profile and start a conversation first.'});return;}
    await this.run('Joining the table…',async()=>{
      const ctx=this.makeContext();this.current=ctx;
      try{await ctx.voice.connect();}catch(error){ctx.cancelled=true;await ctx.voice.disconnect().catch(()=>{});throw error;}
      const ready=await ctx.ready;
      if(!ready||!this.currentContext(ctx)||ctx.cancelled)return;
      if(withMic)await ctx.voice.toggleMic();
      if(this.currentContext(ctx))await this.refreshCore();
    });
  }
  async connect() { await this.start(false); }
  async talk() {
    if(this.state.connection==='connecting'){await this.end();return;}
    if(this.state.connection==='ready'){
      await this.run('Updating microphone…',async()=>{await this.current?.voice.toggleMic();});return;
    }
    await this.start(true);
  }
  private async stopAndSynchronize() {
    const contexts=[...this.contexts].filter(c=>!c.retired);
    for(const ctx of contexts){ctx.cancelled=true;await ctx.voice.disconnect();}
    for(const ctx of contexts)if(ctx.recorder&&!ctx.terminal)await ctx.recorder.waitForSync(this.requestController.signal);
    for(const ctx of contexts){ctx.recorder?.dispose();ctx.retired=true;this.contexts.delete(ctx);if(this.current===ctx)this.current=undefined;}
    if(this.active())this.publish({connection:'closed',activity:'idle',mic:false,level:0});
  }
  async end() {
    if(this.state.connection==='connecting'&&this.current){
      this.current.cancelled=true;
      try{await this.stopAndSynchronize();await this.refreshCore();}catch(error){this.publish({error:this.message(error)});}
      return;
    }
    await this.run('Saving the conversation…',async()=>{await this.stopAndSynchronize();await this.refreshCore();});
  }
  private requireBoundary() {
    if(this.state.connection==='connecting'||this.state.connection==='closing'||['thinking','speaking'].includes(this.state.activity)||
      orderedTurns(this.current?.local??emptyConversation()).some(t=>t.status==='pending'||t.status==='streaming'))
      throw new Error('Let the current exchange finish before rewinding or evaluating.');
  }
  private async settleAppraisal() {
    const ctx=this.current;if(!ctx?.boot||ctx.terminal)return;
    if(this.state.mic)await ctx.voice.toggleMic();
    await ctx.recorder?.waitForSync(this.requestController.signal);
    const latest=orderedTurns(ctx.local).filter(t=>t.role==='user'&&t.transcriptFinal&&t.status==='complete').at(-1);
    if(!latest)return;
    let until=Date.now()+33000;
    while(this.currentContext(ctx)){
      const data=await this.api.transport<AdaptationView>(`/api/sessions/${ctx.boot.session.id}/adaptation`,{signal:this.requestController.signal});
      if(!data.pending&&data.attempts.some(a=>a.turnId===latest.itemId))return;
      until=Math.min(until,Date.now()+data.appraisalTimeoutMs+2000);
      if(Date.now()>until)throw new Error('Alex’s saved context is still being prepared. Try again in a moment.');
      await new Promise(resolve=>setTimeout(resolve,150));
    }
  }
  async rewind(targetUserTurnId:string) {
    await this.run('Preparing your alternative…',async()=>{
      const recovering=this.forkAttempt;
      this.requireBoundary();await this.settleAppraisal();await this.stopAndSynchronize();await this.refreshCore();
      const current=this.state.overview;if(!current)return;
      if(recovering&&current.branches.some(b=>b.id===this.state.branchId&&b.parentBranchId===recovering.branchId&&b.forkTurnId===recovering.target))return;
      if(current.branches.length>=2&&!(this.forkAttempt?.conversationId===current.conversation.id&&this.forkAttempt.target===targetUserTurnId))throw new Error('This conversation already has an alternative. Revisit either path or start a new conversation.');
      const target=this.state.nodes.find(n=>n.id===targetUserTurnId);
      if(!target?.rewindable)throw new Error(target?.reason??'That moment is not available to rewind.');
      const overview=await this.api.get(current.conversation.id),branch=overview.branches.find(b=>b.id===this.state.branchId);
      if(!branch)throw new Error('This saved path is unavailable.');
      if(!this.forkAttempt||this.forkAttempt.conversationId!==overview.conversation.id||this.forkAttempt.target!==targetUserTurnId)
        this.forkAttempt={conversationId:overview.conversation.id,target:targetUserTurnId,branchId:branch.id,revision:branch.revision,key:this.key()};
      const attempt=this.forkAttempt;
      try{
        const child=await this.api.fork(attempt.conversationId,attempt.branchId,attempt.target,attempt.revision,attempt.key);
        this.forkAttempt=undefined;this.evaluationAttempt=undefined;
        this.publish({branchId:child.id,evaluation:null,comparison:null,suggestion:null,warning:null});await this.refreshCore();
      }catch(error){if(error instanceof Phase3ApiError&&error.code==='STALE_REVISION')this.forkAttempt=undefined;throw error;}
    },true);
  }
  async selectBranch(branchId:string) {
    await this.run('Opening this path…',async()=>{
      this.requireBoundary();await this.settleAppraisal();await this.stopAndSynchronize();
      const current=this.state.overview;if(!current)return;const overview=await this.api.get(current.conversation.id);
      if(!overview.branches.some(b=>b.id===branchId))throw new Error('Choose one of this conversation’s saved paths.');
      this.publish({overview,branchId,nodes:[],suggestion:null,warning:null});await this.refreshCore();
    });
  }
  async evaluate() {
    await this.run('Preparing your comparison…',async()=>{
      this.requireBoundary();await this.settleAppraisal();await this.stopAndSynchronize();await this.refreshCore();
      const overview=this.state.overview,branch=overview?.branches.find(b=>b.id===this.state.branchId);if(!overview||!branch)return;
      const signature=overview.branches.map(b=>`${b.id}:${b.revision}`).join('|');
      if(!this.evaluationAttempt||this.evaluationAttempt.conversationId!==overview.conversation.id||this.evaluationAttempt.signature!==signature)
        this.evaluationAttempt={conversationId:overview.conversation.id,signature,key:this.key()};
      const job=await this.api.analyze(overview.conversation.id,'evaluation',this.evaluationAttempt.key);this.evaluationAttempt=undefined;this.applyEvaluation(job);
    });
  }
  private applyEvaluation(evaluation:AnalysisStatus) {
    this.publish({evaluation,comparison:evaluation.status==='succeeded'&&evaluation.kind==='evaluation'?evaluation.result as ComparisonResult:null});
  }
  async retryEvaluation() {
    await this.run('Retrying the assessment…',async()=>{
      const job=this.state.evaluation;if(!job||job.status!=='failed'||!job.retryable)return;
      if(!this.evaluationRetry||this.evaluationRetry.jobId!==job.id||this.evaluationRetry.attempts!==job.attempts)
        this.evaluationRetry={jobId:job.id,attempts:job.attempts,key:this.key()};
      this.applyEvaluation(await this.api.retry(job.id,this.evaluationRetry.key));
    });
  }
  async dismissSuggestion() {
    await this.run('Saving your preference…',async()=>{
      const suggestion=this.state.suggestion;if(!suggestion)return;
      if(this.dismissAttempt?.suggestionId!==suggestion.id)this.dismissAttempt={suggestionId:suggestion.id,key:this.key()};
      const saved=await this.api.dismiss(suggestion.branchId,this.dismissAttempt.key);this.publish({suggestion:saved});
    });
  }
  dismissError() { this.publish({error:null}); }
  private schedulePoll(epoch:number) {
    if(!this.active(epoch))return;
    this.pollTimer=setTimeout(()=>void this.poll(epoch),this.deps.pollIntervalMs??1200);
  }
  private async poll(epoch:number) {
    try{
      if(!this.active(epoch))return;
      const ctx=this.current;
      if(ctx?.boot&&this.currentContext(ctx)&&this.state.connection==='ready'){
        try{
          const data=await this.api.transport<AdaptationView>(`/api/sessions/${ctx.boot.session.id}/adaptation`,{signal:this.requestController.signal});
          if(this.currentContext(ctx)&&this.state.connection==='ready'){
            ctx.adaptationFailures=0;ctx.voice.queueInstructions(data.prepared.version,data.prepared.instructions,
              {persistentInstructions:data.prepared.persistentInstructions??data.prepared.instructions,triggerTurnId:data.prepared.triggerTurnId});
          }
        }catch{if(this.currentContext(ctx)&&++ctx.adaptationFailures===2)this.publish({warning:'Alex’s context updates are temporarily unavailable. Your voice connection can continue.'});}
      }
      if(!this.active(epoch))return;
      if(!this.state.operating)await this.refreshCore();
      const job=this.state.evaluation;
      if(job&&['queued','running'].includes(job.status)){
        const next=await this.api.analysis(job.id);if(this.active(epoch)&&this.state.evaluation?.id===job.id)this.applyEvaluation(next);
      }
    }catch{if(this.active(epoch))this.publish({warning:'Saved updates are temporarily unavailable. Reconnect or refresh when the server is reachable.'});}
    finally{this.schedulePoll(epoch);}
  }
  async dispose() {
    this.disposed=true;++this.epoch;clearTimeout(this.pollTimer);this.requestController.abort();
    const contexts=[...this.contexts];
    await Promise.allSettled(contexts.map(async ctx=>{
      ctx.cancelled=true;await ctx.voice.disconnect();
      if(ctx.recorder&&!ctx.terminal)await ctx.recorder.waitForSync(new AbortController().signal).catch(()=>{});
      ctx.recorder?.dispose();ctx.retired=true;this.contexts.delete(ctx);
    }));
    if(this.current&&contexts.includes(this.current))this.current=undefined;
  }
}
