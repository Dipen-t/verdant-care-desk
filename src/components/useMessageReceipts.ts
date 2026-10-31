import { useEffect,useRef,type RefObject } from 'react';
import { api,type Message } from '../api';
import { isViewed } from '../receiptVisibility';

export function useMessageReceipts(root: RefObject<HTMLDivElement|null>,messages: Message[],agentView: boolean) {
  const received=useRef(new Set<string>()),read=useRef(new Set<string>());
  const receiving=useRef(new Set<string>()),reading=useRef(new Set<string>());
  const role=agentView?'agent':'customer';
  useEffect(() => {
    const incoming=messages.filter(message => message.sender===(agentView?'customer':'agent'));
    async function acknowledge(ids: string[],state: 'received'|'read') {
      const done=state==='read'?read.current:received.current;
      const pending=state==='read'?reading.current:receiving.current;
      const next=ids.filter(id=>!done.has(id)&&!pending.has(id));
      if (!next.length) return;
      next.forEach(id=>pending.add(id));
      try {
        for (let i=0;i<next.length;i+=100) {
          const batch=next.slice(i,i+100);
          await api(`/${role}/receipts`,{messageIds:batch,state});
          batch.forEach(id=>{done.add(id);if(state==='read')received.current.add(id);});
        }
      } catch { /* Retry later; never fake a receipt. */ }
      finally { next.forEach(id=>pending.delete(id)); }
    }
    void acknowledge(incoming.map(message=>message.id),'received');
    const node=root.current;
    if (!node) return;
    const ids=new Set(incoming.map(message=>message.id));
    let timer: ReturnType<typeof setTimeout>;
    function visibleIds() {
      const bounds=node!.getBoundingClientRect();
      const viewport={top:Math.max(0,bounds.top),bottom:Math.min(window.innerHeight,bounds.bottom),left:Math.max(0,bounds.left),right:Math.min(window.innerWidth,bounds.right),width:Math.max(0,Math.min(window.innerWidth,bounds.right)-Math.max(0,bounds.left)),height:Math.max(0,Math.min(window.innerHeight,bounds.bottom)-Math.max(0,bounds.top))};
      return [...node!.querySelectorAll<HTMLElement>('[data-receipt-id]')].filter(element=>ids.has(element.dataset.receiptId!)&&isViewed(element.getBoundingClientRect(),viewport,document.visibilityState)).map(element=>element.dataset.receiptId!);
    }
    function schedule() {
      clearTimeout(timer);
      if (document.visibilityState!=='visible') return;
      const candidates=new Set(visibleIds().filter(id=>!read.current.has(id)));
      if (!candidates.size) return;
      timer=setTimeout(()=>void acknowledge(visibleIds().filter(id=>candidates.has(id)),'read'),350);
    }
    const observer=new IntersectionObserver(schedule,{root:node,threshold:[0,0.01,0.25,0.5,0.75,1]});
    node.querySelectorAll<HTMLElement>('[data-receipt-id]').forEach(element=>observer.observe(element));
    node.addEventListener('scroll',schedule,{passive:true});document.addEventListener('visibilitychange',schedule);window.addEventListener('focus',schedule);
    schedule();
    return ()=>{clearTimeout(timer);observer.disconnect();node.removeEventListener('scroll',schedule);document.removeEventListener('visibilitychange',schedule);window.removeEventListener('focus',schedule);};
  },[messages,agentView,role,root]);
}
