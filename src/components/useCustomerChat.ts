import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type Message } from '../api';
import { customerTranscript, reconcileOutbox, restoreOutbox, type OutgoingMessage } from '../customerDelivery';
import { errorText, readDraft, writeDraft } from './shared';
import { useLiveUpdates } from './useLiveUpdates';

export function useCustomerChat(customerId: string) {
  const [saved, setSaved] = useState<Message[]>([]);
  const [outbox, setOutbox] = useState<OutgoingMessage[]>(() => restoreOutbox(readDraft(`verdant.outbox.${customerId}`, '[]')));
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const queue = useRef(outbox), activeSend = useRef(false), sessionReady = useRef(false);
  const mutationVersion = useRef(0), activeCustomer = useRef(customerId), reconnect = useRef<()=>Promise<void>>(async () => {});
  const mounted = useRef(true);
  const liveReady=useRef(false);
  function storeQueue(next: OutgoingMessage[], customer = customerId) {
    writeDraft(`verdant.outbox.${customer}`, JSON.stringify(next));
    if (activeCustomer.current === customer) { queue.current = next; setOutbox(next); }
  }
  useEffect(() => {
    mounted.current = true;
    activeCustomer.current = customerId;
    let cancelled = false, refreshing = false, again=false;
    let timer: ReturnType<typeof setTimeout>;
    sessionReady.current = false; setLoading(true); setSaved([]); setConnection('connecting');
    const restored = restoreOutbox(readDraft(`verdant.outbox.${customerId}`, '[]'));
    queue.current = restored; setOutbox(restored);
    async function refresh() {
      if (cancelled) return;
      if (refreshing) { again=true; return; }
      refreshing = true; clearTimeout(timer);
      const version = mutationVersion.current;
      try {
        if (!sessionReady.current) {
          await api('/customer/select', { customerId });
          if (cancelled) return;
          sessionReady.current = true;
        }
        const result = await api<{ messages: Message[] }>('/customer/conversation');
        if (cancelled) return;
        if (version === mutationVersion.current) {
          setSaved(result.messages);
          const remaining = reconcileOutbox(queue.current, result.messages);
          if (remaining.length !== queue.current.length) storeQueue(remaining);
        }
        setConnection('connected');
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) sessionReady.current = false;
        setConnection('reconnecting');
      } finally {
        refreshing = false;
        if (!cancelled) {
          setLoading(false);
          if (again) { again=false; void refresh(); }
          else timer = setTimeout(() => void refresh(), liveReady.current?15000:3000);
        }
      }
    }
    const online = () => void refresh();
    const offline = () => setConnection('reconnecting');
    reconnect.current = refresh;
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    void refresh();
    return () => { cancelled = true; mounted.current = false; clearTimeout(timer); window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, [customerId]);
  async function transmit(message: OutgoingMessage) {
    if (activeSend.current) return;
    activeSend.current = true; setBusy(true);
    storeQueue(queue.current.map(item => item.requestId === message.requestId ? { ...item, status: 'sending', error: undefined } : item));
    try {
      const result = await api<{ messageId: string }>('/customer/messages', { text: message.text, requestId: message.requestId, timestamp: message.timestamp });
      if (!mounted.current || activeCustomer.current !== customerId) return;
      mutationVersion.current++;
      if (activeCustomer.current === customerId) {
        setSaved(previous => previous.some(item => item.id === result.messageId) ? previous : [...previous, {
          id: result.messageId, sender: 'customer', text: message.text, source_at: message.timestamp,
          received_at: new Date().toISOString(), client_request_id: message.requestId,
        }]);
      }
      storeQueue(queue.current.filter(item => item.requestId !== message.requestId));
    } catch (error) {
      if (!mounted.current || activeCustomer.current !== customerId) return;
      storeQueue(queue.current.map(item => item.requestId === message.requestId ? { ...item, status: 'failed', error: errorText(error) } : item));
      if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) setConnection('reconnecting');
    } finally { activeSend.current = false; if (mounted.current) setBusy(false); }
  }
  function send(text: string) {
    if (!text.trim() || activeSend.current || !sessionReady.current) return false;
    const message: OutgoingMessage = { text: text.trim(), requestId: crypto.randomUUID(), timestamp: new Date().toISOString(), status: 'sending' };
    storeQueue([...queue.current, message]); void transmit(message); return true;
  }
  function retry(requestId: string) {
    const message = queue.current.find(item => item.requestId === requestId);
    if (message && !activeSend.current && sessionReady.current) void transmit(message);
  }
  const current = activeCustomer.current === customerId;
  const live=useLiveUpdates('customer',()=>reconnect.current(),current&&sessionReady.current&&!loading,customerId);
  liveReady.current=live;
  return { messages: current ? customerTranscript(saved, outbox) : [], loading: !current || loading, busy, connection, canSend: current && sessionReady.current && !loading, send, retry, reconnect: () => reconnect.current() };
}
