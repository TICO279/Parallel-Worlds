import { describe, expect, it, vi } from 'vitest';
import { compactAppraisalSchema, expandCompactAppraisal } from '../server/adaptation/compact';
import { DeepSeekAppraisalProvider, OpenAIAppraisalProvider, type AppraisalInput } from '../server/adaptation/providers';
import { unpackAppraisalResult } from '../server/adaptation/results';
import { initialState } from '../server/adaptation/engine';
import { scenarios } from '../server/orchestrator';
import { realismProposal } from './helpers/realism';
import { realismAppraisalSchema } from '../shared/characterState';
const input:AppraisalInput={character:scenarios[1].character,previous:initialState(scenarios[1].character,'s',1),utterance:'I compared two rollout options.',turnId:'s/u1',context:[],outputSchema:'evidence-v1'};
function wire() {
  const {schemaVersion:_v,evidence:_e,memoryOperations:_m,brief,...base}=realismProposal('s/u1',input.utterance,{event:'evidence'});
  const {move:_move,...outward}=brief;
  return {...base,brief:outward,memoryText:'User reports comparing two rollout options.'};
}
describe('compact appraisal wire format',()=>{
  it('validates a smaller model response then expands it through the existing state schema',()=>{
    const raw=wire();expect(compactAppraisalSchema.safeParse(raw).success).toBe(true);
    const expanded=expandCompactAppraisal(raw,input);expect(realismAppraisalSchema.safeParse(expanded).success).toBe(true);
    expect(expanded).toMatchObject({schemaVersion:2,evidence:[{turnId:'s/u1',quote:input.utterance}],memoryOperations:[{action:'add',category:'claim',targetId:null}]});
  });
  it('rejects invented IDs, categories, actor move codes, invalid events and oversized notes rather than coercing them',()=>{
    for(const raw of [{...wire(),memoryOperations:[]},{...wire(),evidence:[{turnId:'invented'}]},
      {...wire(),brief:{...wire().brief,move:'answer'}},{...wire(),event:'clarification'},{...wire(),memoryText:'x'.repeat(121)}])
      expect(()=>expandCompactAppraisal(raw,input)).toThrow();
  });
  it('never creates a resolution for an unknown note and requires existing repair progress',()=>{
    const raw={...wire(),event:'respectful_action'};
    expect(expandCompactAppraisal(raw,input).memoryOperations.every(op=>op.action==='add')).toBe(true);
    expect(()=>expandCompactAppraisal(raw,{...input,turnId:undefined})).toThrow('Identified');
  });
  it('uses JSON mode and reports the actual wire profile through provider-independent telemetry',async()=>{
    const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire())}}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})));
    const result=await new DeepSeekAppraisalProvider('test-key','deepseek-flash',fetcher).appraise(input,new AbortController().signal);
    expect(unpackAppraisalResult(result).telemetry).toMatchObject({schemaProfile:'evidence-v1',usage:{totalTokens:300}});
    const body=JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));expect(body.response_format).toEqual({type:'json_object'});
  });
  it('retains the OpenAI adapter and the same normalized appraisal format without live OpenAI calls',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(wire())}]}]})));
    const raw=await new OpenAIAppraisalProvider('test-key','configured-model',fetcher).appraise(input,new AbortController().signal);
    expect(unpackAppraisalResult(raw).appraisal).toMatchObject({schemaVersion:2,event:'evidence'});
  });
});
