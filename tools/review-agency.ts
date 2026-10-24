/** Offline blinded review; no model calls and no automatic emotional-realism scores. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';
const raw=process.argv[2];if(!raw)throw new Error('Supply a directed pilot JSON file from captures/.');
const root=resolve('captures');const path=resolve(raw);if(relative(root,path).startsWith('..')||!path.endsWith('.json'))throw new Error('Use a local captures JSON report.');
const report=JSON.parse(await readFile(path,'utf8'));const groups=new Map<string,any[]>();
for(const row of report.rows){const key=`${row.caseId}/${row.arm}/${row.seed}`;groups.set(key,[...(groups.get(key)??[]),row]);}
const candidates=[...groups.values()].map(rows=>({id:randomBytes(4).toString('hex'),rows}));
for(let i=candidates.length-1;i>0;i--){const j=randomInt(i+1);[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
let md='# Blinded agency review\n\nNot yet human-rated. Rate each conversation independently: independence, grounding, continuity, proportionate warmth and naturalness (1–5). Flag unsupported praise, unearned endorsement, gratuitous hostility, invented shared history, ignored corrections and repetitive questioning with a quoted example. Incomplete conversations remain included; operational failures are reported separately.\n';
for(const c of candidates){md+=`\n## Candidate ${c.id}\n`;
 for(const r of c.rows)md+=`\nUser: ${r.utterance}\n\nCharacter: ${r.reply}\n`;
 md+='\nIndependence: ___ / 5 · Grounding: ___ / 5 · Continuity: ___ / 5 · Warmth: ___ / 5 · Naturalness: ___ / 5\n\nCritical failures and evidence: ___\n';}
await writeFile(resolve(root,'agency-review-blinded.md'),md);
await writeFile(resolve(root,'agency-review-key.json'),JSON.stringify(candidates.map(c=>({id:c.id,caseId:c.rows[0].caseId,arm:c.rows[0].arm,seed:c.rows[0].seed,turns:c.rows.length})),null,2));
console.log(JSON.stringify({packet:'captures/agency-review-blinded.md',key:'captures/agency-review-key.json',candidates:candidates.length}));
