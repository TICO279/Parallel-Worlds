import { describe, expect, it, vi } from 'vitest';
import { SessionRecorder, type api } from '../src/recording';
describe('recording queue', () => {
  it('drains a newer snapshot before closing the server session', async () => {
    const calls:string[]=[];let first!:()=>void,second!:()=>void;let writes=0,closed=false;
    const request=vi.fn(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body));calls.push(init.method==='PUT'?`put:${body.revision}`:body.status);
      if(init.method==='PATCH'){closed=true;return{};}
      if(closed)throw new Error('STALE_SESSION');
      if(++writes===1)await new Promise<void>(done=>{first=done;});
      else if(writes===2)await new Promise<void>(done=>{second=done;});return{};
    });
    const recorder=new SessionRecorder('session',vi.fn(),request as typeof api);
    try{
      recorder.snapshot([]);recorder.snapshot([]);recorder.status('closed');first();
      await vi.waitFor(()=>expect(second).toBeTypeOf('function'));
      recorder.snapshot([]);second();await vi.waitFor(()=>expect(calls).toHaveLength(4));
      expect(calls).toEqual(['put:1','put:2','put:3','closed']);await recorder.waitForSync(new AbortController().signal,500);
    }finally{recorder.dispose();}
  });
  it('cancels directed waiting without abandoning the underlying recording write', async () => {
    vi.useFakeTimers();let finish!:()=>void;
    const request=vi.fn(()=>new Promise(resolve=>{finish=()=>resolve({});}));
    const recorder=new SessionRecorder('s',vi.fn(),request as typeof api);recorder.snapshot([]);
    const controller=new AbortController();const waiting=recorder.waitForSync(controller.signal);
    const rejection=expect(waiting).rejects.toThrow();controller.abort();await vi.advanceTimersByTimeAsync(26);await rejection;
    finish();await vi.advanceTimersByTimeAsync(0);expect(recorder.synced).toBe(true);recorder.dispose();vi.useRealTimers();
  });
  it('serializes writes and coalesces snapshots without stale overwrites', async () => {
    let finish!: () => void; const bodies: any[] = [];
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) await new Promise<void>(r => { finish = r; });
      return {};
    });
    const recorder = new SessionRecorder('session', vi.fn(), request as unknown as typeof api);
    recorder.snapshot([]); recorder.snapshot([]); recorder.snapshot([]);
    expect(request).toHaveBeenCalledTimes(1); finish();
    await vi.waitFor(() => expect(recorder.synced).toBe(true));
    expect(bodies.map(b => b.revision)).toEqual([1, 3]); recorder.dispose();
  });
  it('keeps a failed snapshot and retries it', async () => {
    vi.useFakeTimers(); const status = vi.fn();
    const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
    const recorder = new SessionRecorder('session', status, request as typeof api);
    recorder.snapshot([]); await Promise.resolve(); await Promise.resolve();
    expect(status).toHaveBeenCalledWith(expect.stringContaining('Retrying'));
    await vi.advanceTimersByTimeAsync(2001); expect(recorder.synced).toBe(true);
    expect(status).toHaveBeenLastCalledWith(null); recorder.dispose(); vi.useRealTimers();
  });
});
