import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createServer,request as httpRequest,type Server} from 'node:http';
import {createApp} from '../server/app';
import {createCertificateSetup,createPhoneGateway} from '../tools/phone-gateway';
import {scenarios} from '../server/orchestrator';

const origin='https://192.168.1.10:3443',host='192.168.1.10:3443',code='01234ABCDE';
const listen=(server:Server)=>new Promise<number>(done=>server.listen(0,'127.0.0.1',()=>done((server.address() as {port:number}).port)));
const close=(server:Server)=>new Promise<void>(done=>server.close(()=>done()));
// Node fetch deliberately controls Host itself; raw HTTP lets these tests exercise exact-host guards.
const rawFetch=(url:string,init:RequestInit={})=>new Promise<Response>((done,fail)=>{
  const req=httpRequest(url,{method:init.method??'GET',headers:Object.fromEntries(new Headers(init.headers))},response=>{
    const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(Buffer.from(chunk)));response.on('error',fail);
    response.on('end',()=>{const headers=new Headers();for(let i=0;i<response.rawHeaders.length;i+=2)headers.append(response.rawHeaders[i],response.rawHeaders[i+1]);done(new Response(Buffer.concat(chunks),{status:response.statusCode,headers}));});
  });req.on('error',fail);req.end(init.body?.toString());
});

describe('private phone gateway',()=>{
  let upstream:Server,gateway:Server,base:string,now=1000,pairCookie='';
  const request=(path:string,init:RequestInit={})=>rawFetch(base+path,{...init,headers:{host,...init.headers}});
  beforeAll(async()=>{
    upstream=createServer(createApp({dist:'__missing_dist__'}));const upstreamPort=await listen(upstream);
    gateway=createServer(createPhoneGateway({origin,code,upstreamPort,now:()=>now}));base=`http://127.0.0.1:${await listen(gateway)}`;
  });
  afterAll(async()=>{await close(gateway);await close(upstream);});
  it('keeps API access behind pairing and disables caching',async()=>{
    const api=await request('/api/health');expect(api.status).toBe(401);expect(api.headers.get('cache-control')).toBe('no-store');
    const page=await request('/profile/alex');expect(page.status).toBe(303);expect(page.headers.get('location')).toBe('/__phone/pair');
    const pair=await request('/__phone/pair');const text=await pair.text();expect(text).toContain('Pairing code');expect(text).not.toContain(code);
  });
  it('rejects deceptive hosts and cross-site requests before pairing or proxying',async()=>{
    expect((await request('/api/health',{headers:{host:'attacker.example'}})).status).toBe(403);
    expect((await request('/api/health',{headers:{origin:'https://attacker.example'}})).status).toBe(403);
    expect((await request('/api/health',{headers:{'sec-fetch-site':'cross-site'}})).status).toBe(403);
    expect((await request('/__phone/pair',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:`code=${code}`})).status).toBe(403);
  });
  it('allows the HTTP setup link to open the HTTPS pairing document without opening cross-site API access',async()=>{
    const headers={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
    expect((await request('/__phone/pair',{headers})).status).toBe(200);
    expect((await request('/api/health',{headers})).status).toBe(403);
    expect((await request('/__phone/pair',{headers:{...headers,origin:'http://192.168.1.10:3444'}})).status).toBe(403);
  });
  it('rejects bad codes and issues a secure, HttpOnly pairing cookie for the exact origin',async()=>{
    const post=(value:string)=>request('/__phone/pair',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:value})});
    expect((await post('incorrect')).status).toBe(401);expect((await post('éééééééééé')).status).toBe(401);
    const response=await post(code);expect(response.status).toBe(303);expect(response.headers.get('location')).toBe('/profile/alex');
    const cookie=response.headers.get('set-cookie')!;expect(cookie).toContain('Secure; HttpOnly; SameSite=Strict');pairCookie=cookie.split(';')[0];
    const health=await request('/api/health',{headers:{cookie:pairCookie}});expect(health.status).toBe(200);
    expect((await health.json()).ok).toBe(true);expect(health.headers.get('permissions-policy')).toContain('microphone=(self)');
  });
  it('preserves real device ownership, idempotency, origin safeguards and API contracts',async()=>{
    const boot=await request('/api/v1/bootstrap',{headers:{cookie:pairCookie}});expect(boot.status).toBe(200);
    const serverCookie=boot.headers.get('set-cookie')!;expect(serverCookie).toContain('Secure');
    const headers={origin,cookie:`${pairCookie}; ${serverCookie.split(';')[0]}`,'content-type':'application/json','idempotency-key':'phone-create-test-1'};
    const created=await request('/api/v1/conversations',{method:'POST',headers,body:JSON.stringify({scenarioId:scenarios[0].id})});expect(created.status).toBe(201);
    const first=await created.json();const retried=await request('/api/v1/conversations',{method:'POST',headers,body:JSON.stringify({scenarioId:scenarios[0].id})});expect((await retried.json()).conversation.id).toBe(first.conversation.id);
    const list=await request('/api/v1/conversations',{headers});expect((await list.json()).conversations.map((c:{id:string})=>c.id)).toEqual([first.conversation.id]);
    const other=await request('/api/v1/conversations',{headers:{cookie:pairCookie}});expect((await other.json()).conversations).toEqual([]);
    expect((await request('/api/v1/conversations',{method:'POST',headers:{...headers,origin:'https://attacker.example'},body:'{}'})).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${(upstream.address() as {port:number}).port}/api/health`,{headers:{origin}})).status).toBe(403);
  });
  it('expires paired access after eight hours',async()=>{
    now+=8*60*60*1000+1;expect((await request('/api/health',{headers:{cookie:pairCookie}})).status).toBe(401);
  });
  it('rate-limits code attempts without exposing provider responses',async()=>{
    now+=60001;
    for(let i=0;i<10;i++)expect((await request('/__phone/pair',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:'code=BAD'})).status).toBe(401);
    expect((await request('/__phone/pair',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:`code=${code}`})).status).toBe(429);
  });
});

describe('certificate bootstrap port',()=>{
  it('serves only a public certificate profile and instructions, never the API',async()=>{
    const server=createServer(createCertificateSetup({host:'192.168.1.10',setupPort:3444,origin,profile:'<plist>public certificate only</plist>',fingerprint:'AA:BB'}));
    const port=await listen(server);const base=`http://127.0.0.1:${port}`;
    try{
      const page=await rawFetch(base,{headers:{host:'192.168.1.10:3444'}});expect(await page.text()).toContain('Remove the profile after testing');
      const cert=await rawFetch(base+'/phone.mobileconfig',{headers:{host:'192.168.1.10:3444'}});expect(cert.headers.get('content-type')).toContain('application/x-apple-aspen-config');expect(await cert.text()).toContain('public certificate only');
      expect((await rawFetch(base+'/api/v1/bootstrap',{headers:{host:'192.168.1.10:3444'}})).status).toBe(404);
      expect((await rawFetch(base,{headers:{host:'attacker.example'}})).status).toBe(403);
    }finally{await close(server);}
  });
});
