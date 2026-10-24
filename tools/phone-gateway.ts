import express from 'express';
import {request} from 'node:http';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

const cookieName='__Host-pw_phone';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const page=(title:string,body:string)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${title}</title><style>body{font:17px system-ui;background:#10151e;color:#f5f5f5;max-width:500px;margin:0 auto;padding:32px 24px;line-height:1.5}h1{font-size:28px}a{color:#a5ccff}button,input{box-sizing:border-box;font:inherit;border-radius:12px;padding:14px;width:100%;margin:8px 0}button{background:#accbff;color:#10151e;border:0}small{display:block;overflow-wrap:anywhere;color:#c2c6d0}li{margin:14px 0}</style></head><body>${body}</body></html>`;
const pairingPage=(message='')=>page('Pair your iPhone',`<h1>Parallel Worlds</h1><p>Enter the phone pairing code shown in the PC terminal.</p>${message?`<p role="alert">${message}</p>`:''}<form action="/__phone/pair" method="post"><label for="code">Pairing code</label><input id="code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="10" required><button>Open Alex’s profile</button></form><p>This private test runs on your PC. Keep the PC and backend running while you talk.</p>`);

/** Optional LAN-only TLS gateway. The existing app and its origin rules stay unchanged. */
export function createPhoneGateway(options:{origin:string;code:string;upstreamPort?:number;now?:()=>number}) {
  const origin=new URL(options.origin);
  if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw new Error('An exact HTTPS phone origin is required.');
  if(!/^[A-F0-9]{10}$/.test(options.code))throw new Error('Invalid phone pairing code.');
  const app=express(),sessions=new Map<string,number>();
  const now=options.now??Date.now,upstreamPort=options.upstreamPort??3000;
  let attempts=0,windowEnds=0;
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
      'Permissions-Policy':'microphone=(self), camera=(), geolocation=()',
      'Content-Security-Policy':"frame-ancestors 'none'; base-uri 'self'; object-src 'none'"});
    // The HTTP setup link opens an HTTPS document across schemes. Permit that navigation,
    // while continuing to reject cross-site API/resource requests and every foreign write.
    const setupNavigation=['GET','HEAD'].includes(req.method)&&!req.path.startsWith('/api/')&&
      req.get('sec-fetch-mode')==='navigate'&&req.get('sec-fetch-dest')==='document'&&!req.get('origin');
    if(req.get('host')!==origin.host||req.get('sec-fetch-site')==='cross-site'&&!setupNavigation||
      req.get('origin')&&req.get('origin')!==origin.origin||
      !['GET','HEAD'].includes(req.method)&&req.get('origin')!==origin.origin)
      return res.status(403).json({error:'Use the paired phone page on this PC’s exact HTTPS address.'});
    next();
  });
  const cookie=(header:string|undefined,name:string)=>header?.split(';').map(c=>c.trim()).find(c=>c.startsWith(name+'='))?.slice(name.length+1);
  app.get('/__phone/pair',(_req,res)=>res.type('html').send(pairingPage()));
  app.post('/__phone/pair',express.urlencoded({extended:false,limit:'512b'}),(req,res)=>{
    if(now()>=windowEnds){attempts=0;windowEnds=now()+60000;}
    if(++attempts>10)return res.status(429).type('html').send(pairingPage('Too many attempts. Wait one minute and try again.'));
    const value=typeof req.body?.code==='string'?req.body.code.trim().toUpperCase():'';
    if(!/^[A-F0-9]{10}$/.test(value)||!timingSafeEqual(Buffer.from(value),Buffer.from(options.code)))
      return res.status(401).type('html').send(pairingPage('That code did not match. Check the PC terminal.'));
    for(const [id,expires]of sessions)if(expires<=now())sessions.delete(id);
    if(sessions.size>=10)return res.status(429).type('html').send(pairingPage('Restart the phone gateway before pairing more devices.'));
    const token=randomBytes(32).toString('hex');sessions.set(digest(token),now()+8*60*60*1000);
    res.set('Set-Cookie',`${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800`);
    res.redirect(303,'/profile/alex');
  });
  app.use((req,res,next)=>{
    const token=cookie(req.get('cookie'),cookieName);
    if(!token||!/^[a-f0-9]{64}$/.test(token)||(sessions.get(digest(token))??0)<=now()){
      if(req.path.startsWith('/api/'))return res.status(401).json({error:'Pair this phone again using the PC terminal code.'});
      return res.redirect(303,'/__phone/pair');
    }next();
  });
  app.post('/__phone/logout',(req,res)=>{
    const token=cookie(req.get('cookie'),cookieName);if(token)sessions.delete(digest(token));
    res.set('Set-Cookie',`${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);res.redirect(303,'/__phone/pair');
  });
  app.use((req,res)=>{
    if(!req.url.startsWith('/')||req.url.startsWith('//'))return res.status(400).json({error:'Invalid phone request.'});
    // Forward only the app's own request headers; never trust arbitrary forwarded hosts/origins.
    const headers:Record<string,string>={origin:'http://127.0.0.1:3000','sec-fetch-site':'same-origin'};
    for(const name of ['accept','accept-language','content-type','content-length','idempotency-key']){const value=req.get(name);if(value)headers[name]=value;}
    const device=cookie(req.get('cookie'),'pw_device');if(device&&/^[a-f0-9]{64}$/.test(device))headers.cookie=`pw_device=${device}`;
    const upstream=request({hostname:'127.0.0.1',port:upstreamPort,method:req.method,path:req.url,headers},response=>{
      res.status(response.statusCode??502);
      for(const [name,value]of Object.entries(response.headers)){
        if(value!==undefined&&!['connection','keep-alive','transfer-encoding','set-cookie','cache-control','x-powered-by'].includes(name))res.setHeader(name,value);
      }
      if(response.headers['set-cookie'])res.setHeader('Set-Cookie',response.headers['set-cookie'].map(c=>/;\s*secure(?:;|$)/i.test(c)?c:`${c}; Secure`));
      response.on('error',()=>res.destroy());response.pipe(res);
    });
    upstream.setTimeout(20000,()=>upstream.destroy());
    upstream.on('error',()=>{if(!res.headersSent)res.status(502).json({error:'The PC backend is unavailable. Start it with pnpm start and keep this page open.'});else res.destroy();});
    req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableFinished)upstream.destroy();});req.pipe(upstream);
  });
  app.use(((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
    res.status(400).json({error:'Invalid phone request.'});
  }) as express.ErrorRequestHandler);
  return app;
}

/** Public certificate only; this HTTP listener never proxies application data or API calls. */
export function createCertificateSetup(options:{host:string;setupPort:number;origin:string;profile:string;fingerprint:string}) {
  const app=express();app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
    if(req.get('host')!==`${options.host}:${options.setupPort}`)return res.status(403).send('Use the exact PC setup address.');next();
  });
  app.get('/',(_req,res)=>res.type('html').send(page('iPhone test setup',`<h1>Test on your iPhone</h1><p>Use the same Wi-Fi as your PC. This setup installs only a temporary local certificate, not a native app.</p><ol><li><a href="/phone.mobileconfig">Download the test certificate profile</a>.</li><li>Open Settings → Profile Downloaded (or General → VPN &amp; Device Management). Inspect and install <b>Parallel Worlds Phone Test</b>. Compare its root certificate SHA-256 with the PC terminal before trusting it.</li><li>Open Settings → General → About → Certificate Trust Settings. Enable full trust for <b>Parallel Worlds Phone Test Root</b>.</li><li><a href="${options.origin}/__phone/pair">Open the secure app</a> and enter the pairing code from the PC terminal.</li></ol><p>Trusting this root allows certificates signed by this test authority. Its signing key is discarded after setup and the root expires in 14 days. Remove the profile after testing.</p><small>Root SHA-256: ${options.fingerprint}</small><p>In Safari, Share → Add to Home Screen is optional. Allow microphone access when you tap the mic. Use headphones for interruption testing.</p>`)));
  app.get('/phone.mobileconfig',(_req,res)=>res.attachment('parallel-worlds-phone-test.mobileconfig').type('application/x-apple-aspen-config').send(options.profile));
  app.use((_req,res)=>res.status(404).send('This port serves certificate setup only. Open the HTTPS app address.'));
  return app;
}
