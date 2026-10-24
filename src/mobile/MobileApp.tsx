import {useEffect,useRef,useState} from 'react';
import {useMobileConversation} from './useMobileConversation';
import {DiscoverView,ProfileView,ConversationView} from './views';
import {readMobileRoute,routePath,type MobileRoute} from './navigation';
import './mobile.css';

export function MobileApp(){
  const {state,actions,controller}=useMobileConversation();
  const [route,setRoute]=useState<MobileRoute>(()=>readMobileRoute(location.pathname));
  const routeRef=useRef(route);routeRef.current=route;
  const navEpoch=useRef(0),requested=useRef('');
  function navigate(next:MobileRoute,replace=false){
    navEpoch.current++;requested.current='';
    history[replace?'replaceState':'pushState'](null,'',routePath(next));setRoute(next);window.scrollTo(0,0);
  }
  async function leave(next:MobileRoute){
    const epoch=++navEpoch.current;await actions.end();
    if(epoch===navEpoch.current&&controller.canLeave)navigate(next);
  }
  async function resume(id:string){
    const epoch=++navEpoch.current;await actions.open(id);
    if(epoch===navEpoch.current&&controller.getSnapshot().overview?.conversation.id===id)navigate({screen:'worlds',conversationId:id});
  }
  async function start(){const epoch=++navEpoch.current,id=await actions.create();if(id&&epoch===navEpoch.current)navigate({screen:'worlds',conversationId:id});}
  useEffect(()=>{
    if(route.screen!=='worlds'||state.loading||!state.profile)return;
    if(controller.getSnapshot().overview?.conversation.id===route.conversationId||requested.current===route.conversationId)return;
    requested.current=route.conversationId;void actions.open(route.conversationId);
  },[route,state.loading,state.profile,actions,controller]);
  useEffect(()=>{
    const pop=()=>{
      const next=readMobileRoute(location.pathname),previous=routeRef.current,epoch=++navEpoch.current;
      if(previous.screen==='worlds'&&routePath(next)!==routePath(previous)){
        void actions.end().then(()=>{
          if(epoch!==navEpoch.current)return;
          if(controller.canLeave){requested.current='';setRoute(next);}
          else history.replaceState(null,'',routePath(previous));
        });
      }else{requested.current='';setRoute(next);}
    };
    window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);
  },[actions,controller]);
  useEffect(()=>{
    const oldTitle=document.title,meta=document.querySelector('meta[name="theme-color"]'),oldColor=meta?.getAttribute('content');
    document.title=route.screen==='worlds'?'Alex · Parallel Worlds':'Ember · Parallel Worlds';
    meta?.setAttribute('content',route.screen==='worlds'?'#0b0e14':'#ff4b68');
    return()=>{document.title=oldTitle;if(oldColor)meta?.setAttribute('content',oldColor);};
  },[route.screen]);
  if(route.screen==='discover')return <DiscoverView state={state} onProfile={()=>navigate({screen:'profile'})} onResume={id=>void resume(id)} onRefresh={()=>void actions.refresh()}/>;
  if(route.screen==='profile')return <ProfileView state={state} onBack={()=>navigate({screen:'discover'})} onStart={()=>void start()} onResume={id=>void resume(id)}/>;
  if(route.screen==='worlds'){
    const same=state.overview?.conversation.id===route.conversationId;
    const shown=same?state:{...state,overview:null,branchId:'',nodes:[],suggestion:null,evaluation:null,comparison:null};
    return <ConversationView state={shown} onBack={()=>void leave({screen:'profile'})}
      onTalk={()=>{if(same)void actions.talk();}} onEnd={()=>void actions.end()} onRewind={id=>actions.rewind(id)}
      onSelectBranch={id=>{if(same)void actions.selectBranch(id);}} onEvaluate={()=>{if(same)void actions.evaluate();}}
      onDismissSuggestion={()=>void actions.dismissSuggestion()} onRetryEvaluation={()=>void actions.retryEvaluation()} onDismissError={()=>actions.dismissError()}/>;
  }
  return <div className="mobile-shell"><main className="mobile-missing"><h1>This page isn’t available</h1><p>Your saved conversations remain available.</p><button onClick={()=>navigate({screen:'discover'},true)}>Back to Ember</button></main></div>;
}
