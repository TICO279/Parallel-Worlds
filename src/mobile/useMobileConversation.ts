import { useEffect, useRef, useSyncExternalStore } from 'react';
import { MobileController, type MobileDependencies } from './controller';

export function useMobileConversation(dependencies?: MobileDependencies) {
  const ref=useRef<MobileController|null>(null);ref.current??=new MobileController(dependencies);
  const controller=ref.current;
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  useEffect(()=>{
    void controller.initialize();
    const leaving=(event:BeforeUnloadEvent)=>{if(controller.needsUnloadWarning)event.preventDefault();};
    window.addEventListener('beforeunload',leaving);
    return()=>{window.removeEventListener('beforeunload',leaving);void controller.dispose();};
  },[controller]);
  return {state,actions:controller,controller};
}
