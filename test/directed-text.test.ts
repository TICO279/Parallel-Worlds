import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectedText } from '../src/realtime/DirectedText';
import type { ResponsePlan } from '../shared/behavior';
const plan = ():ResponsePlan => ({id:'s:intent:1',sessionId:'s',turnId:'u1',stateVersion:1,contextHash:'hash',instructions:'Full current contract',persistentInstructions:'Persistent identity',
  createdAt:Date.now(),expiresAt:Date.now()+30000,policyVersion:'agency-1',status:'prepared',events:[],
  contract:{action:'probe',objective:'Ask for ownership.',endorsement:'none',maxQuestions:1,maxSentences:2,delivery:'Level.'}});
const tick = async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness(prepare=vi.fn(async(_turnId:string,_signal:AbortSignal)=>plan()),record=vi.fn(async(_plan:ResponsePlan,_status:ResponsePlan['status'],_responseId?:string)=>{})) {
  const options={prepare,record,send:vi.fn(),acknowledged:vi.fn(),busy:vi.fn(),failure:vi.fn(),notice:vi.fn()};
  const c=new DirectedText(options);c.enabled=true;c.begin('u1');
  const echo=()=>c.observe({type:'conversation.item.added',item:{id:'u1',role:'user'}});
  const ack=()=>c.observe({type:'session.updated',session:{instructions:'Full current contract'}});
  return {c,options,echo,ack};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe('directed typed response authorization',()=>{
  it('waits for recording/appraisal, exact session acknowledgement and persisted authorization before one create',async()=>{
    const h=harness();h.echo();await tick();expect(h.options.send).toHaveBeenCalledTimes(1);
    expect(h.options.send.mock.calls[0][0]).toMatchObject({type:'session.update'});
    h.c.observe({type:'session.updated',session:{instructions:'Wrong'}});await tick();expect(h.options.record).not.toHaveBeenCalled();
    h.ack();h.ack();await tick();expect(h.options.send).toHaveBeenCalledTimes(2);
    expect(h.options.record).toHaveBeenCalledWith(expect.objectContaining({id:'s:intent:1'}),'dispatched',undefined);
    expect(h.options.send.mock.calls[1][0]).toEqual({type:'response.create',response:{metadata:{intentId:'s:intent:1',contextHash:'hash'}}});h.c.close();
  });
  it('blocks mismatched response metadata and any uncorrelated audio',async()=>{
    const h=harness();h.echo();await tick();h.ack();await tick();
    expect(h.c.accept({type:'response.created',response:{id:'r',metadata:{intentId:'wrong'}}})).toBe(false);
    expect(h.options.failure).toHaveBeenCalledWith(expect.stringContaining('did not match'));expect(h.c.busy).toBe(false);
  });
  it('blocks audio arriving before response intent validation',()=>{
    const h=harness();expect(h.c.accept({type:'response.output_audio.delta',response_id:'unknown'})).toBe(false);
    expect(h.options.failure).toHaveBeenCalled();
  });
  it('restores persistent guidance after generation and playback before accepting another turn',async()=>{
    const h=harness();h.echo();await tick();h.ack();await tick();
    const created={type:'response.created',response:{id:'r',metadata:{intentId:'s:intent:1',contextHash:'hash'}}};
    expect(h.c.accept(created)).toBe(true);expect(h.c.accept({type:'response.output_audio.delta',response_id:'r'})).toBe(true);
    expect(h.c.accept(created)).toBe(false);expect(h.options.failure).not.toHaveBeenCalled();
    h.c.observe({type:'response.done',response:{id:'r',status:'completed'}});expect(h.c.busy).toBe(true);
    h.c.idle();expect(h.options.send).toHaveBeenLastCalledWith({type:'session.update',session:{instructions:'Persistent identity'}});
    h.c.observe({type:'session.updated',session:{instructions:'Persistent identity'}});expect(h.c.busy).toBe(false);await tick();
    expect(h.c.accept({type:'response.output_audio.delta',response_id:'r'})).toBe(false);expect(h.options.failure).not.toHaveBeenCalled();
    expect(h.options.record.mock.calls.map(c=>c[1])).toEqual(['dispatched','created','completed']);
  });
  it('cancels pending preparation on disconnect and ignores a stale result',async()=>{
    let finish!:(p:ResponsePlan)=>void;const prepare=vi.fn((_turnId:string,_signal:AbortSignal)=>new Promise<ResponsePlan>(r=>{finish=r;}));const h=harness(prepare);
    h.echo();const signal=prepare.mock.calls[0]?.[1] as AbortSignal|undefined;h.c.close();finish(plan());await tick();
    expect(signal?.aborted).toBe(true);expect(h.options.send).not.toHaveBeenCalled();expect(h.options.record).toHaveBeenCalledWith(expect.anything(),'cancelled');
  });
  it('never sends a response when authorization recording fails',async()=>{
    const h=harness(undefined,vi.fn(async()=>{throw new Error('offline');}));h.echo();await tick();h.ack();await tick();
    expect(h.options.send.mock.calls.filter(c=>c[0].type==='response.create')).toHaveLength(0);expect(h.options.failure).toHaveBeenCalled();
  });
  it('marks a missing response creation as uncertain without retrying it',async()=>{
    vi.useFakeTimers();const h=harness();h.echo();await tick();h.ack();await tick();await vi.advanceTimersByTimeAsync(10001);
    expect(h.options.send.mock.calls.filter(c=>c[0].type==='response.create')).toHaveLength(1);
    expect(h.options.record).toHaveBeenCalledWith(expect.anything(),'uncertain',undefined);expect(h.options.failure).toHaveBeenCalledWith(expect.stringContaining('uncertain'));
  });
  it('records provider generation failure honestly and still restores the persistent context',async()=>{
    const h=harness();h.echo();await tick();h.ack();await tick();
    h.c.accept({type:'response.created',response:{id:'r',metadata:{intentId:'s:intent:1',contextHash:'hash'}}});
    h.c.observe({type:'response.done',response:{id:'r',status:'failed'}});h.c.idle();await tick();
    expect(h.options.record).toHaveBeenLastCalledWith(expect.anything(),'failed','r');
    expect(h.options.notice).toHaveBeenCalledWith(expect.stringContaining('did not complete'));
    h.c.observe({type:'session.updated',session:{instructions:'Persistent identity'}});expect(h.c.busy).toBe(false);
  });
  it('blocks an unsolicited response even between directed turns',()=>{
    const h=harness();h.c.close();
    expect(h.c.accept({type:'response.created',response:{id:'unrequested'}})).toBe(false);
    expect(h.options.failure).toHaveBeenCalledWith(expect.stringContaining('unrequested'));
  });
});
