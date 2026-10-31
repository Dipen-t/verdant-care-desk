import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, Check, CheckCheck, CircleAlert, LoaderCircle, MessageCircle, X } from 'lucide-react';
import type { Message } from '../api';
import { useMessageReceipts } from './useMessageReceipts';

export function readDraft(key: string, fallback = '') {
  try { return sessionStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
export function writeDraft(key: string, value: string) {
  try { sessionStorage.setItem(key, value); } catch { /* Storage can be disabled. */ }
}
export function clearDraft(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* Storage can be disabled. */ }
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Could not connect. Please try again.';
}
export function initials(name: string) { return name.split(' ').slice(0, 2).map(n => n[0]).join(''); }
export function clock(value: string) { return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
export function activityTime(value: string) {
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString() ? clock(value) : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
export function Avatar({ name, brand = false }: { name: string; brand?: boolean }) {
  return <span className={`avatar ${brand ? 'brand-avatar' : ''}`} aria-hidden="true">{brand ? 'v.' : initials(name)}</span>;
}
export function Spinner() { return <LoaderCircle size={16} className="spin" aria-hidden="true" />; }
export function ErrorNotice({ text, onClose }: { text: string; onClose?: () => void }) {
  return <div className="notice error" role="alert"><CircleAlert size={17} /><span>{text}</span>{onClose && <button className="icon-button" onClick={onClose} aria-label="Dismiss error"><X size={16} /></button>}</div>;
}
export function usePolling(callback: () => Promise<void>, enabled = true,interval=3000) {
  const saved = useRef(callback); saved.current = callback;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try { await saved.current(); }
      finally { if (!cancelled) timer = setTimeout(tick, interval); }
    };
    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled,interval]);
}
function dayLabel(value: string) {
  const date = new Date(value), today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { day: 'numeric', month: 'long', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
function ReceiptTicks({ message,agentView }: { message:Message;agentView:boolean }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => { if (open && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [open]);
  const read=Boolean(message.recipient_read_at),received=Boolean(message.recipient_received_at);
  const label=read?'Viewed':received?'Received':'Saved';
  const recipient=agentView?'customer':'support team';
  const detail=read?`Viewed by the ${recipient}`:received?`Received by the ${recipient}’s app`:'Saved by the server';
  const date=message.recipient_read_at||message.recipient_received_at;
  return <><button type="button" className={`receipt-ticks ${read?'viewed':''}`} aria-label={`${label}. Show message status`} aria-haspopup="dialog" title={`${detail}${date?` · ${new Date(date).toLocaleString()}`:''}`} onClick={() => setOpen(true)}>{read||received?<CheckCheck size={15}/>:<Check size={15}/>}</button>
    {open && <dialog ref={dialog} className="message-status-dialog" aria-labelledby={headingId} onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="message-status-content"><header><h2 id={headingId}>Message status</h2><button className="icon-button" autoFocus onClick={() => dialog.current?.close()} aria-label="Close message status"><X size={18}/></button></header>
        <p className="current-message-status">{label}</p><p>{detail}.</p>
        <dl><div><dt>Saved</dt><dd>{new Date(message.received_at).toLocaleString()}</dd></div>
          <div><dt>Received</dt><dd>{message.recipient_received_at ? new Date(message.recipient_received_at).toLocaleString() : `Waiting for the ${recipient}’s app`}</dd></div>
          <div><dt>Viewed</dt><dd>{message.recipient_read_at ? new Date(message.recipient_read_at).toLocaleString() : 'Not marked as viewed yet'}</dd></div></dl>
        <p className="message-status-hint">One tick means saved, two ticks mean received, and blue ticks mean viewed in this app.</p>
      </div>
    </dialog>}
  </>;
}
export function Transcript({ messages, customerName, agentView = false, onRetry, retryDisabled, emptyActions }: { messages: Message[]; customerName: string; agentView?: boolean; onRetry?: (requestId: string) => void; retryDisabled?: boolean; emptyActions?: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  useMessageReceipts(container,messages,agentView);
  const atBottom = useRef(true), previousLast = useRef<string | undefined>(undefined);
  const [newMessages, setNewMessages] = useState(false);
  function scrollToLatest() {
    if (container.current) container.current.scrollTop = container.current.scrollHeight;
    atBottom.current = true; setNewMessages(false);
  }
  useEffect(() => {
    const last = messages.at(-1)?.id;
    if (last !== previousLast.current) {
      if (atBottom.current || !previousLast.current || messages.at(-1)?.deliveryStatus === 'sending') scrollToLatest();
      else setNewMessages(true);
      previousLast.current = last;
    }
  }, [messages]);
  return <div className="transcript-shell">
    <div ref={container} className={`transcript ${agentView ? 'agent-transcript' : ''}`} role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions" onScroll={() => {
      const el = container.current!;
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
      if (atBottom.current) setNewMessages(false);
    }}>
      {!messages.length && <div className="empty-thread"><span className="empty-thread-icon"><MessageCircle size={26} strokeWidth={1.5} /></span><h2>How can we help?</h2><p>Ask about your order, a return, or a product.<br />Our support team will reply here.</p>{emptyActions}</div>}
      {messages.map((message, index) => {
        const outgoing = agentView ? message.sender === 'agent' : message.sender === 'customer';
        const firstOfDay = index === 0 || new Date(messages[index - 1].source_at).toDateString() !== new Date(message.source_at).toDateString();
        const previous = messages[index - 1];
        const grouped = !firstOfDay && previous?.sender === message.sender && Math.abs(Date.parse(message.source_at) - Date.parse(previous.source_at)) < 120000;
        return <div key={message.id}>
          {firstOfDay && <div className="day-divider"><span>{dayLabel(message.source_at)}</span></div>}
          <div className={`message-row ${outgoing ? 'outgoing' : 'incoming'} ${grouped ? 'grouped' : ''} ${message.deliveryStatus === 'failed' ? 'send-failed' : ''}`}>
            {!outgoing && (grouped ? <span className="message-avatar-spacer" /> : <Avatar name={customerName} brand={!agentView} />)}
            <div className="message-content"><div className="bubble" data-receipt-id={!outgoing?message.id:undefined}>{message.text}</div><div className="message-meta">{!grouped && <span>{outgoing ? 'You' : agentView ? customerName : 'Verdant support'}</span>}<time dateTime={message.source_at}>{clock(message.source_at)}</time>{outgoing && message.deliveryStatus!=='sending' && message.deliveryStatus!=='failed' && <ReceiptTicks message={message} agentView={agentView}/>} {message.deliveryStatus === 'sending' && <span className="delivery-state" role="status"><Spinner />Sending…</span>}{message.deliveryStatus === 'failed' && <span className="delivery-state failed" role="status">Couldn’t send</span>}</div>{message.deliveryStatus === 'failed' && <div className="message-send-error"><span>{message.deliveryError}</span><button disabled={retryDisabled} onClick={() => onRetry?.(message.client_request_id!)}>Retry message</button></div>}</div>
          </div>
        </div>;
      })}
    </div>
    {newMessages && <button className="new-messages" onClick={scrollToLatest}><ArrowDown size={14} />{!agentView && messages.at(-1)?.sender === 'agent' ? 'New reply' : 'New messages'}</button>}
  </div>;
}
