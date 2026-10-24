import { describe,it,expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComparisonPanel,Phase3Harness } from '../src/Phase3Harness';
import report from '../docs/phase3-analysis-results.json';
import type { ComparisonResult } from '../shared/evaluation';
const result=report.followUpEvaluation.job.result as ComparisonResult;
describe('minimal Phase 3 integration harness',()=>{
  it('renders the real validated two-path result with evidence and provisional flags',()=>{
    const html=renderToStaticMarkup(<ComparisonPanel result={result}/>);
    expect(html).toContain('Original');expect(html).toContain('Alternative');expect(html).toContain('Provisional');expect(html).toContain('coverage 80%');
    expect((html.match(/<path /g)??[])).toHaveLength(3);expect(html).toContain('Evidence and rubric');expect(html).toContain('Turn ');expect(html).toContain('not emotional measurements');
  });
  it('does not fabricate another trajectory when only one branch exists',()=>{
    const html=renderToStaticMarkup(<ComparisonPanel result={{...result,paths:result.paths.slice(0,1),sharedTurnIds:[],forkTurnId:null}}/>);
    expect((html.match(/<path /g)??[])).toHaveLength(1);expect(html).toContain('One recorded original path');expect(html).not.toContain('<h3>Alternative');
  });
  it('keeps the backend harness voice-only and identifies its integration role',()=>{
    const html=renderToStaticMarkup(<Phase3Harness/>);expect(html).toContain('INTEGRATION HARNESS');expect(html).toContain('Enable microphone');expect(html).not.toContain('<input');
  });
});
