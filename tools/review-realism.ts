/** Offline, blinded human review packet. Never makes API requests or assigns its own realism scores. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomInt, randomBytes } from 'node:crypto';
const labels = process.argv.slice(2);
if (labels.length !== 2 || labels.some(l => !/^[a-z0-9-]+$/.test(l))) throw new Error('Supply two report labels, e.g. baseline revised-confirmation.');
const reports = await Promise.all(labels.map(async label => JSON.parse(await readFile(`captures/realism-${label}.json`, 'utf8'))));
const candidates: { id: string; label: string; caseId: string; mode: string; rows: any[] }[] = [];
for (const [index, report] of reports.entries()) {
  const groups = new Map<string, any[]>();
  for (const row of report.rows) { const key = `${row.caseId}/${row.mode}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  for (const rows of groups.values()) candidates.push({ id: randomBytes(4).toString('hex'), label: labels[index], caseId: rows[0].caseId, mode: rows[0].mode, rows });
}
for (let i = candidates.length - 1; i > 0; i--) { const j = randomInt(i + 1); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
const rubric = ['Identity consistency', 'Grounded reaction', 'Continuity', 'Proportionate warmth', 'Independent judgment', 'Naturalness'];
const flags = ['Unsupported praise', 'Invented shared history', 'Instant forgiveness', 'Persistent hostility', 'Repeated questioning'];
let md = '# Blinded conversation review\n\nNot yet human-rated. Text-only, one sample per condition; labels are kept in a separate key. Rate each criterion 1 (poor) to 5 (strong). Flag critical failures with a quoted example; do not hide them in an average. Read each conversation independently before comparing candidates.\n';
for (const c of candidates) {
  md += `\n## Candidate ${c.id} · ${c.rows[0].scenarioId}\n`;
  for (const r of c.rows) md += `\n**User:** ${r.utterance}\n\n**Character:** ${r.reply}\n`;
  md += '\n' + rubric.map(r => `- ${r}: ___ / 5`).join('\n') + '\n\n' + flags.map(f => `- ${f}: yes / no · evidence: ___`).join('\n') + '\n\nNotes: ___\n';
}
await mkdir('captures', { recursive: true });
await writeFile('captures/realism-review-blinded.md', md);
await writeFile('captures/realism-review-key.json', JSON.stringify(candidates.map(({ rows: _, ...key }) => key), null, 2));
const nearest = (values: number[], q: number) => values.length ? [...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length*q)-1)] : null;
const summary = reports.map((report, i) => {
  const attempts = report.rows.filter((r:any) => r.mode === 'adaptive' && r.attempt).map((r:any) => r.attempt);
  const lags = report.rows.filter((r:any) => r.mode === 'adaptive' && r.instructionApplication?.status === 'acknowledged' && r.instructionCommittedAt !== undefined)
    .map((r:any) => r.instructionApplication.at - r.instructionCommittedAt).filter((n:number) => n >= 0);
  return { label: labels[i], replies: report.rows.length, conversationFailures: report.failures.length, appraisalAttempts: attempts.length,
    appraisalFailures: attempts.filter((a:any) => a.status !== 'committed').length,
    appraisalTimeouts: attempts.filter((a:any) => a.error?.includes('timed out')).length,
    appraisalP50Ms: nearest(attempts.map((a:any) => a.latencyMs), .5), appraisalP95Ms: nearest(attempts.map((a:any) => a.latencyMs), .95),
    knownInputTokens: attempts.reduce((s:number,a:any) => s+(a.usage?.inputTokens ?? 0),0),
    knownOutputTokens: attempts.reduce((s:number,a:any) => s+(a.usage?.outputTokens ?? 0),0),
    missingUsageCount: attempts.filter((a:any) => !a.usage).length,
    instructionApplicationLag: { samples: lags.length, p50Ms: nearest(lags, .5), p95Ms: nearest(lags, .95),
      method: 'Backend context commit to acknowledgement recording; controlled runner waits between turns. Not browser polling/idle-boundary latency.' } };
});
await writeFile('captures/realism-comparison-summary.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ packet: 'captures/realism-review-blinded.md', key: 'captures/realism-review-key.json', summary }));
