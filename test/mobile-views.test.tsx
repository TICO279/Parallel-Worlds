import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiscoverView, ProfileView, ConversationView, EvaluationContent } from '../src/mobile/views';
import type { ConversationProps, MobileState } from '../src/mobile/types';
import type { Scenario } from '../shared/domain';
import type { ComparisonResult } from '../shared/evaluation';
import report from '../docs/phase3-analysis-results.json';

const profile:Scenario={id:'alex-first-date',title:'First Date with Alex',setting:'An evening at a quiet café.',character:{
  id:'alex',name:'Alex',description:'Thoughtful, quietly curious, and drawn to honest conversation.',traits:['thoughtful','curious','somewhat reserved'],
  values:['honesty','respect'],motivation:'Discover whether the conversation is enjoyable.',goals:['Get to know each other.'],boundaries:['Respect privacy.'],speakingStyle:'Understated.',voice:'default',
}};
const comparison=report.followUpEvaluation.job.result as ComparisonResult;
const root={schemaVersion:1 as const,id:'original',conversationId:'conversation',parentBranchId:null,forkTurnId:null,parentRevision:null,
  characterId:'alex',createdAt:1,revision:4,turnIds:['s/u1','s/a1','s/u2','s/a2'],initialCheckpointId:'initial',checkpointId:'checkpoint'};
function state(overrides:Partial<MobileState>={}):MobileState {
  return {loading:false,profile,configured:true,qualification:{protocolVersion:'restore-1',contextQualified:true,testedAt:'2026-10-24T00:00:00Z',preForkRecall:true,
    postForkAbsent:true,noDuplicateQuestion:true,noUnsolicitedResponse:true,physicalMicrophoneTested:false},conversations:[],
    overview:{schemaVersion:1,conversation:{schemaVersion:1,id:'conversation',scenario:profile,createdAt:1,revision:2,rootBranchId:'original',activeBranchId:'original',activeEpoch:1},branches:[root]},
    branchId:'original',nodes:[{id:'s/u1',role:'user',text:'I enjoy pottery.',status:'complete',rewindable:true},
      {id:'s/a1',role:'assistant',text:'What do you make?',status:'complete',rewindable:false},
      {id:'s/u2',role:'user',text:'I prefer quiet cafés.',status:'complete',rewindable:true},
      {id:'s/a2',role:'assistant',text:'Where do you go?',status:'complete',rewindable:false}],
    connection:'closed',activity:'idle',mic:false,level:0,operating:null,error:null,warning:null,suggestion:null,evaluation:null,comparison:null,...overrides};
}
const noop=()=>{};
function conversationProps(s:MobileState):ConversationProps {return {state:s,onBack:noop,onTalk:noop,onEnd:noop,onRewind:async()=>{},onSelectBranch:noop,onEvaluate:noop,onDismissSuggestion:noop,onRetryEvaluation:noop,onDismissError:noop};}
const renderConversation=(s:MobileState)=>renderToStaticMarkup(<ConversationView {...conversationProps(s)}/>);

describe('preferred mobile frontend presentation',()=>{
  it('shows only the server-authored Alex card and public profile content',()=>{
    const discover=renderToStaticMarkup(<DiscoverView state={state()} onProfile={noop} onResume={noop} onRefresh={noop}/>);
    const card=renderToStaticMarkup(<ProfileView state={state()} onBack={noop} onStart={noop} onResume={noop}/>);
    expect(discover).toContain('Alex');expect(card).toContain(profile.character.description);
    for(const unsupported of ['Amara','Elena','Devin','Sofia','Leo','Maya','Grad student','Toronto','miles away']) {
      expect(discover).not.toContain(unsupported);expect(card).not.toContain(unsupported);
    }
    expect(card).toContain('/mobile/photos/maya.jpg');
    expect(discover).toContain('/mobile/photos/maya.jpg');
    expect(renderConversation(state())).toContain('/mobile/photos/maya.jpg');
    expect(card).not.toContain('/mobile/photos/alex.jpg');
  });
  it('keeps the profile and conversation flows free of text composers and emotional dashboards',()=>{
    const views=[renderToStaticMarkup(<DiscoverView state={state()} onProfile={noop} onResume={noop} onRefresh={noop}/>),
      renderToStaticMarkup(<ProfileView state={state()} onBack={noop} onStart={noop} onResume={noop}/>),renderConversation(state())];
    for(const html of views){expect(html).not.toMatch(/<(?:input|textarea)\b/);expect(html).not.toMatch(/How (?:Alex|she) feels|Conversation tree|Adaptive state|Debug dashboard/);}
  });
  it('renders backend-provided saved date summaries without simulated text chats',()=>{
    const html=renderToStaticMarkup(<ProfileView state={state({conversations:[{id:'saved-real-date',scenarioId:'alex-first-date',activeBranchId:'original',createdAt:1}]})} onBack={noop} onStart={noop} onResume={noop}/>);
    expect(html).toContain('Continue your saved conversation');expect(html).toContain('Latest');expect((html.match(/class="thread-row"/g)??[])).toHaveLength(1);
    expect(html).not.toContain('Unread messages');expect(html).not.toContain('Send message');
  });
  it('exposes microphone, Undo and Evaluate as real accessible controls',()=>{
    const html=renderConversation(state());expect(html).toContain('Undo');expect(html).toContain('Evaluate');expect(html).toMatch(/aria-label="[^"]*(?:Talk|microphone)[^"]*"/);
    expect(html).not.toContain('pw-compose');
  });
  it('surfaces recording failures and actionable errors',()=>{
    const warning=renderConversation(state({warning:'Recording is waiting for the server. Keep this tab open.'}));
    const error=renderConversation(state({error:'Refresh this saved conversation before reconnecting.'}));
    expect(warning).toContain('Recording is waiting for the server');expect(warning).toContain('role="status"');
    expect(error).toContain('Refresh this saved conversation');expect(error).toContain('role="alert"');
    const combined=renderConversation(state({warning:'Recording has unsynchronized observations.',error:'This saved conversation must be refreshed.'}));
    expect(combined).toContain('Recording has unsynchronized observations');expect(combined).toContain('This saved conversation must be refreshed');
  });
  it('allows setup cancellation while the microphone is still off during restoration',()=>{
    const html=renderConversation(state({connection:'connecting',operating:'Restoring your conversation…',mic:false}));
    const cancel=html.match(/<button\b[^>]*aria-label="Cancel connection"[^>]*>/)?.[0];
    expect(cancel).toBeDefined();expect(cancel).toContain('aria-pressed="false"');expect(cancel).not.toContain('disabled');
    expect(html).toContain('Joining the table');expect(html).not.toContain('Listening to you');
  });
  it('shows the actual microphone state and disables capture when credentials are unavailable',()=>{
    const active=renderConversation(state({connection:'ready',activity:'listening',mic:true}));
    expect(active).toMatch(/aria-label="Mute microphone"[^>]*aria-pressed="true"/);expect(active).toContain('Listening to you');
    const unavailable=renderConversation(state({configured:false}));
    expect(unavailable.match(/<button\b[^>]*aria-label="Talk with Alex"[^>]*>/)?.[0]).toContain('disabled');
  });
  it('does not enable profile entry before server metadata has loaded',()=>{
    const html=renderToStaticMarkup(<DiscoverView state={state({loading:true,profile:null})} onProfile={noop} onResume={noop} onRefresh={noop}/>);
    expect(html.match(/<button\b[^>]*aria-label="View Alex&#x27;s profile"[^>]*>/)?.[0]).toContain('disabled');
  });
  it('annotates the exact server suggestion target without starring other timeline nodes',()=>{
    const suggestion={schemaVersion:1 as const,id:'suggestion',branchId:'original',revision:4,targetTurnId:'s/u2',reason:'Explore another response about quiet cafés.',significance:.7,explorationPotential:.6,
      confidence:.6,evidence:[{turnId:'s/u2',quote:'I prefer quiet cafés.'}],status:'active' as const,provider:'deepseek',tentative:true};
    const html=renderConversation(state({suggestion}));
    const target=html.match(/<button\b[^>]*data-turn-id="s\/u2"[^>]*>/)?.[0];
    const other=html.match(/<button\b[^>]*data-turn-id="s\/u1"[^>]*>/)?.[0];
    expect(target).toContain('data-suggested="true"');expect(other).not.toContain('data-suggested');
    expect(html).toContain('A moment you could explore');expect(html).not.toContain('pw-star');
    for(const activity of ['speaking','thinking'] as const)expect(renderConversation(state({suggestion,activity}))).not.toContain('data-suggested="true"');
    expect(renderConversation(state({suggestion:{...suggestion,status:'dismissed'}}))).not.toContain('A moment you could explore');
  });
  it('does not offer a suggestion from a different branch or an unavailable timeline node',()=>{
    const suggestion={schemaVersion:1 as const,id:'suggestion',branchId:'original',revision:4,targetTurnId:'missing',reason:'A stale moment.',significance:.7,explorationPotential:.6,confidence:.7,
      evidence:[],status:'active' as const,provider:'deepseek'};
    expect(renderConversation(state({suggestion}))).not.toContain('One moment worth exploring');
    expect(renderConversation(state({suggestion:{...suggestion,targetTurnId:'s/u2',branchId:'other-branch'}}))).not.toContain('One moment worth exploring');
  });
});

describe('mobile communication comparison presentation',()=>{
  it('shows a current evaluation error instead of an older comparison, and shows saving as loading',()=>{
    const error='A saved path contains an unfinished exchange.';
    const html=renderToStaticMarkup(<EvaluationContent state={state({comparison,error})}/>);
    expect(html).toContain('role="alert"');expect(html).toContain(error);expect(html).not.toContain('mobile-result-paths');
    const loading=renderToStaticMarkup(<EvaluationContent state={state({operating:'Preparing your comparison…'})}/>);
    expect(loading).toContain('role="status"');expect(loading).toContain('Waiting for recording');expect(loading).not.toContain('Finish a completed exchange');
  });
  it('renders the validated API scores, provisional coverage and transcript-grounded insight',()=>{
    const html=renderToStaticMarkup(<EvaluationContent state={state({comparison})}/>);
    expect(html).toContain('Original');expect(html).toContain('Alternative');expect(html).toContain('27');expect(html).toContain('75');
    expect(html).toMatch(/provisional/i);expect(html).toContain('80');expect(html).toContain('sketching');
    expect(html).not.toMatch(/How (?:Alex|she) feels|warmth|tension|attractiveness score/);
  });
  it('preserves a single recorded path instead of fabricating an alternative',()=>{
    const single={...comparison,paths:comparison.paths.slice(0,1),forkTurnId:null,sharedTurnIds:[],insight:'Only one completed path is available.'};
    const html=renderToStaticMarkup(<EvaluationContent state={state({comparison:single})}/>);
    expect(html).toContain('Original');expect(html).toContain('Only one completed path');expect(html).toContain('One recorded original conversation');expect(html).not.toContain('class="alternative"');
  });
  it('caps display at two recorded paths and does not convert unavailable scores into zero',()=>{
    const unavailable=structuredClone(comparison);unavailable.paths[0].overall=null;unavailable.paths[0].coverage=0;
    for(const category of Object.values(unavailable.paths[0].categories)){category.score=null;category.unavailableReason='Not enough user evidence.';}
    unavailable.paths.push({...unavailable.paths[1],branchId:'third-path'});
    const html=renderToStaticMarkup(<EvaluationContent state={state({comparison:unavailable})}/>);
    expect((html.match(/class="mobile-score"/g)??[])).toHaveLength(2);expect(html).toContain('class="mobile-score">—</strong>');
    expect(html).toContain('Not enough user evidence.');expect(html).not.toContain('third-path');
  });
  it('keeps evaluation loading and failure separate from old comparison results',()=>{
    const job={schemaVersion:1 as const,id:'job',conversationId:'conversation',kind:'evaluation' as const,status:'running' as const,attempts:1};
    const loading=renderToStaticMarkup(<EvaluationContent state={state({evaluation:job,comparison})}/>);
    expect(loading).toContain('Looking at what actually happened');expect(loading).not.toContain('mobile-result-paths');
    const failed=renderToStaticMarkup(<EvaluationContent state={state({evaluation:{...job,status:'failed',retryable:true,error:'EVIDENCE_INVALID'},comparison})}/>);
    expect(failed).toContain('could not be completed');expect(failed).toContain('Retry comparison');expect(failed).not.toContain('mobile-result-paths');
  });
});
