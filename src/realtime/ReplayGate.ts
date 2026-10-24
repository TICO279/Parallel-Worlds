import type { ProtocolEvent } from '../../shared/domain';
/** Ordering/ACK gate only. Semantic context correctness is qualified separately by the live probe. */
export class ReplayGate {
  private index=0;private started=false;private finished=false;private failed=false;
  constructor(private instructions:string,private seeds:ProtocolEvent[],private send:(e:ProtocolEvent)=>void,
    private ready:()=>void,private failure:()=>void,private configured:(e:ProtocolEvent)=>void=()=>{}){}
  observe(event:ProtocolEvent) {
    if(this.failed)return;
    if(event.type==='error'||event.type.startsWith('response.'))return this.fail();
    if(this.finished)return;
    if(event.type==='session.created') {
      if(this.started)return this.fail();
      if((event.session as {instructions?:string}|undefined)?.instructions!==this.instructions)return this.fail();
      this.started=true;this.configured(event);this.next();return;
    }
    if(event.type==='conversation.item.added') {
      const expected=this.seeds[this.index]?.item as {id:string;role:string;content:{text:string}[]} | undefined;
      const item=event.item as {id?:string;role?:string;content?:{text?:string}[]}|undefined;
      if(!expected||item?.id!==expected.id||item.role!==expected.role||item.content?.map(c=>c.text??'').join('')!==expected.content.map(c=>c.text).join(''))return this.fail();
      this.index++;this.next();
    }
  }
  private next(){if(this.index===this.seeds.length){this.finished=true;this.ready();}else this.send(this.seeds[this.index]);}
  private fail(){this.failed=true;this.failure();}
}
