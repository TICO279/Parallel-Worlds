import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { LocalDatabase } from '../server/persistence/database';
import { ConversationStore } from '../server/store';
import { Phase3Client,Phase3ApiError } from '../shared/phase3-client';
import { unqualifiedRestore } from '../shared/phase3';
describe('Phase 3 integration contract',()=>{
  let server:Server,base:string,db:LocalDatabase;let sdk:Phase3Client;let cookie='',credentialCalls=0;
  const transport:typeof fetch=async(url,options)=>{const response=await fetch(url,{...options,headers:{...options?.headers,...(cookie&&{cookie})}});cookie=response.headers.get('set-cookie')?.split(';')[0]??cookie;return response;};
  beforeAll(async()=>{db=new LocalDatabase();const app=createApp({apiKey:'project-secret',fetcher:async()=>{credentialCalls++;return new Response(JSON.stringify({value:'bai-eph-fixture',expires_at:99999999}));},
    store:new ConversationStore(undefined,db),phase3:{db,qualification:{...unqualifiedRestore,contextQualified:true,preForkRecall:true,postForkAbsent:true,noDuplicateQuestion:true,noUnsolicitedResponse:true}},dist:'__none__'});
    server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;sdk=new Phase3Client(base,transport);await sdk.bootstrap();});
  afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));db.close();});
  async function session(){const c=await sdk.create('alex-first-date'),op=await sdk.restore(c.conversation,c.branch.id),boot=await sdk.connectRestore(op.id);await sdk.confirm(boot.restoration,'ready');
    await transport(`${base}/api/sessions/${boot.session.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'active'})});return{...c,boot};}
  it('creates idempotently and returns typed revision errors without provider payloads',async()=>{
    const a=await sdk.create('alex-first-date','creation-key'),b=await sdk.create('alex-first-date','creation-key');expect(a).toEqual(b);
    await expect(sdk.restore({...a.conversation,revision:10},a.branch.id)).rejects.toMatchObject({status:409,code:'STALE_REVISION'});
    const response=await transport(`${base}/api/v1/conversations`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});expect(response.status).toBe(400);
  });
  it('protects new conversations and linked legacy session APIs from another cookie',async()=>{
    const h=await session();const stranger=new Phase3Client(base);
    await expect(stranger.get(h.conversation.id)).rejects.toMatchObject({status:404});
    const response=await fetch(`${base}/api/sessions/${h.boot.session.id}`);expect(response.status).toBe(404);
  });
  it('records through the versioned contract and prevents legacy PUT bypasses',async()=>{
    const h=await session(),turns=[{itemId:'u1',role:'user' as const,text:'I enjoy pottery.',order:0,status:'complete' as const,transcriptFinal:true,startedAt:1,updatedAt:1},
      {itemId:'a1',role:'assistant' as const,text:'What do you make?',order:1,status:'complete' as const,transcriptFinal:true,playbackComplete:true,startedAt:2,updatedAt:2}];
    await sdk.record(h.boot.session.id,1,turns);await sdk.record(h.boot.session.id,1,turns);
    const timeline=await sdk.timeline(h.branch.id);expect(timeline.nodes[0].rewindable).toBe(true);expect(timeline.nodes).toHaveLength(2);
    await expect(sdk.record(h.boot.session.id,1,[{...turns[0],text:'different'},turns[1]])).rejects.toMatchObject({code:'REVISION_REUSED'});
    const bypass=await transport(`${base}/api/sessions/${h.boot.session.id}/conversation`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:2,turns:[]})});expect(bypass.status).toBe(409);
    const job=await sdk.analyze(h.conversation.id,'evaluation');let current=job;for(let i=0;i<30&&current.status!=='succeeded';i++){await new Promise(r=>setTimeout(r,5));current=await sdk.analysis(job.id);}
    expect(current.status).toBe('succeeded');expect(JSON.stringify(current)).not.toContain('branches');
    const exported=JSON.stringify(await sdk.export(h.conversation.id));expect(exported).not.toMatch(/project-secret|bai-eph-fixture/);
    expect(JSON.stringify(db.sql.prepare('SELECT result FROM mutations').all())).not.toMatch(/project-secret|bai-eph-fixture/);
  });
  it('requires a new fenced attempt key when a bootstrap response was lost',async()=>{
    const c=await sdk.create('alex-first-date'),op=await sdk.restore(c.conversation,c.branch.id);await sdk.connectRestore(op.id,'connection-key');
    await expect(sdk.connectRestore(op.id,'connection-key')).rejects.toMatchObject({code:'CONNECTION_RETRY_REQUIRED'});
    const replacement=await sdk.connectRestore(op.id,'replacement-key');expect(replacement.attachment.status).toBe('preparing');
  });
  it('checks ownership before any ephemeral credential request',async()=>{
    const c=await sdk.create('alex-first-date'),op=await sdk.restore(c.conversation,c.branch.id),stranger=new Phase3Client(base);
    const before=credentialCalls;
    await expect(stranger.connectRestore(op.id)).rejects.toMatchObject({status:404});
    expect(credentialCalls).toBe(before);
  });
});
