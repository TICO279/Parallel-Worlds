// Renders the README pictures from their HTML sources with headless Chrome (macOS path; pass another as argv[2]).
// Usage: node docs/images/src/render.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const chromePath = process.argv[2] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pictures = [['architecture.html', 'architecture.png', 1600, 940], ['turn-flow.html', 'turn-flow.png', 1600, 680]];
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pw-img-'))}`,
  '--allow-file-access-from-files', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let page;
for (let i = 0; i < 50 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { await sleep(200); } }
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const waiting = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await send('Page.enable');
for (const [source, output, width, height] of pictures) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(join(here, source)).href }); await sleep(1500);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
  writeFileSync(join(here, '..', output), Buffer.from(shot.result.data, 'base64'));
  console.log(`docs/images/${output}`);
}
ws.close(); chrome.kill(); process.exit(0);
