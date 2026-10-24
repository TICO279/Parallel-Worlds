import {networkInterfaces} from 'node:os';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer as httpsServer} from 'node:https';
import {createServer as httpServer,type Server} from 'node:http';
import {randomBytes,randomUUID,X509Certificate} from 'node:crypto';
import {createCertificateSetup,createPhoneGateway} from './phone-gateway';

const privateAddress=(ip:string)=>/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
const {values}=parseArgs({options:{host:{type:'string'}}});
const addresses=[...new Set(Object.values(networkInterfaces()).flatMap(list=>list??[]).filter(a=>a.family==='IPv4'&&!a.internal&&privateAddress(a.address)).map(a=>a.address))];
const host=values.host??(addresses.length===1?addresses[0]:undefined);
if(!host||!addresses.includes(host))throw new Error(`Choose a private Wi-Fi/LAN address on this PC: pnpm phone --host ADDRESS. Available: ${addresses.join(', ')||'none'}`);
if(!existsSync('dist/index.html'))throw new Error('Build the mobile frontend first: pnpm build');
try{const response=await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(3000)});if(!response.ok)throw new Error();}
catch{throw new Error('Start the existing backend in another terminal with pnpm start, then run pnpm phone.');}
const directory=resolve('data/phone-test'),metadataPath=resolve(directory,'certificate.json');
let metadata:{host:string;expiresAt:number;fingerprint:string}|undefined;
try{metadata=JSON.parse(readFileSync(metadataPath,'utf8').replace(/^\uFEFF/,''));}catch{/* First setup. */}
if(!metadata||metadata.host!==host||metadata.expiresAt<Date.now()+86400000||!existsSync(resolve(directory,'phone.pfx'))||!existsSync(resolve(directory,'root.cer'))){
  if(process.platform!=='win32')throw new Error('This local certificate helper requires Windows PowerShell 7. Run it on the Windows development PC.');
  execFileSync('pwsh',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./phone-cert.ps1',import.meta.url)),'-Address',host,'-OutputDirectory',directory],{stdio:'pipe',timeout:30000});
  metadata=JSON.parse(readFileSync(metadataPath,'utf8').replace(/^\uFEFF/,''));
}
const rootBytes=readFileSync(resolve(directory,'root.cer')),root=new X509Certificate(rootBytes);
if(root.fingerprint256.replaceAll(':','')!==metadata!.fingerprint)throw new Error('The phone certificate metadata does not match. Stop and inspect data/phone-test.');
const profile=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>PayloadType</key><string>Configuration</string><key>PayloadVersion</key><integer>1</integer><key>PayloadIdentifier</key><string>ai.parallelworlds.phone-test</string><key>PayloadUUID</key><string>${randomUUID()}</string><key>PayloadDisplayName</key><string>Parallel Worlds Phone Test</string><key>PayloadDescription</key><string>Temporary local HTTPS certificate for testing microphone access. Remove this profile after testing.</string><key>PayloadRemovalDisallowed</key><false/><key>PayloadContent</key><array><dict><key>PayloadType</key><string>com.apple.security.root</string><key>PayloadVersion</key><integer>1</integer><key>PayloadIdentifier</key><string>ai.parallelworlds.phone-test.root</string><key>PayloadUUID</key><string>${randomUUID()}</string><key>PayloadDisplayName</key><string>Parallel Worlds Phone Test Root</string><key>PayloadCertificateFileName</key><string>parallel-worlds-phone-test.cer</string><key>PayloadContent</key><data>${rootBytes.toString('base64')}</data></dict></array></dict></plist>`;
writeFileSync(resolve(directory,'phone.mobileconfig'),profile,{mode:0o600});
const origin=`https://${host}:3443`,code=randomBytes(5).toString('hex').toUpperCase();
const secure=httpsServer({pfx:readFileSync(resolve(directory,'phone.pfx')),passphrase:''},createPhoneGateway({origin,code}));
const setup=httpServer(createCertificateSetup({host,setupPort:3444,origin,profile,fingerprint:root.fingerprint256}));
const listen=(server:Server,port:number)=>new Promise<void>((done,fail)=>{server.once('error',fail);server.listen(port,host,()=>{server.off('error',fail);done();});});
try{await listen(secure,3443);await listen(setup,3444);}catch{secure.closeAllConnections();secure.close();setup.close();throw new Error('Phone ports 3443/3444 could not start. Check for an existing pnpm phone process.');}
console.log(`\nOn your iPhone (same Wi-Fi), open Safari: http://${host}:3444/\nSecure app: ${origin}/\nPairing code: ${code}\nRoot SHA-256: ${root.fingerprint256}\n\nInstall/trust the temporary profile yourself using the setup page, then pair.\nNo public tunnel, Windows trust-store changes or provider keys are exposed.\nKeep this terminal and the backend running. Ctrl+C stops phone access.\n`);
const close=()=>{secure.closeAllConnections();setup.closeAllConnections();secure.close();setup.close();};
process.once('SIGINT',close);process.once('SIGTERM',close);
