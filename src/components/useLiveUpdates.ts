import { useEffect, useRef, useState } from 'react';
import { parseLiveBatch, type LiveChange } from '../liveChanges';

export function useLiveUpdates(
  role: 'agent' | 'customer',
  refresh: (changes?: LiveChange[]) => Promise<void> | void,
  enabled = true,
  scope = '',
) {
  const callback = useRef(refresh);
  callback.current = refresh;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setConnected(false);
    if (!enabled) return;
    const source = new EventSource(`/api/${role}/events`);
    let closed = false;
    let running = false;
    let pending: LiveChange[] = [];
    let fullRefresh = false;
    let dirty = false;

    async function drain() {
      if (closed || running) return;
      running = true;
      try {
        while (dirty && !closed) {
          const changes = fullRefresh ? undefined : pending;
          dirty = false;
          fullRefresh = false;
          pending = [];
          try { await callback.current(changes); }
          catch { /* Fetch and polling paths display connection errors. */ }
        }
      } finally {
        running = false;
      }
    }

    function enqueue(changes?: LiveChange[]) {
      dirty = true;
      if (!changes || pending.length + changes.length > 100) {
        fullRefresh = true;
        pending = [];
      } else if (!fullRefresh) {
        pending.push(...changes);
      }
      void drain();
    }

    source.addEventListener('ready', () => {
      setConnected(true);
      enqueue(); // Reconcile events missed while disconnected.
    });
    source.addEventListener('change', event => {
      try {
        enqueue(parseLiveBatch(JSON.parse((event as MessageEvent<string>).data)));
      } catch {
        enqueue();
      }
    });
    source.onerror = () => setConnected(false);
    return () => { closed = true; source.close(); };
  }, [role, enabled, scope]);

  return enabled && connected;
}
