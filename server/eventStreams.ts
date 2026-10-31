import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { canReceiveChange, updateHub, type Audience, type Change } from './events.js';

type Authorize = (request: FastifyRequest, audience: Audience) => Promise<boolean>;

export function createEventStreams(app: FastifyInstance, authorize: Authorize) {
  const streams = new Set<() => void>();
  app.addHook('preClose', async () => {
    for (const close of streams) close();
  });

  return function openEvents(request: FastifyRequest, reply: FastifyReply, audience: Audience) {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    let closed = false;
    let flushing = false;
    let fullRefresh = false;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Map<string, Change>();

    function schedule() {
      if (!closed && !flushing && !flushTimer) {
        // Coalesce bursts and local/database echoes into a single refetch.
        flushTimer = setTimeout(() => { flushTimer = undefined; void flush(); }, 100);
        flushTimer.unref();
      }
    }

    async function flush() {
      if (closed || flushing) return;
      flushing = true;
      const changes = [...pending.values()];
      const refreshAll = fullRefresh;
      fullRefresh = false;
      pending.clear();
      try {
        if (!(await authorize(request, audience))) return close();
        if (closed) return;
        const payload = audience.type === 'agent' && !refreshAll
          ? { changes: changes.map(({ conversationId, kind }) => ({ conversationId, kind })) }
          : {};
        // Backpressure closes a slow stream; reconnect and polling reconcile state.
        if (!reply.raw.write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`)) close();
      } catch {
        close();
      } finally {
        flushing = false;
        if (pending.size || fullRefresh) schedule();
      }
    }

    const unsubscribe = updateHub.subscribe(change => {
      if (!canReceiveChange(audience, change)) return;
      pending.set(`${change.conversationId}:${change.kind}`, change);
      // Bound memory even if a busy connection is waiting for authorization.
      if (pending.size > 100) { pending.clear(); fullRefresh = true; }
      schedule();
    });
    const heartbeat = setInterval(() => {
      void authorize(request, audience).then(valid => {
        if (!valid) close();
        else if (!closed && !reply.raw.write(': heartbeat\n\n')) close();
      }).catch(close);
    }, 15000);
    heartbeat.unref();

    function close() {
      if (closed) return;
      closed = true;
      clearTimeout(flushTimer);
      clearInterval(heartbeat);
      unsubscribe();
      pending.clear();
      streams.delete(close);
      reply.raw.end();
    }
    streams.add(close);
    reply.raw.on('close', close);
    reply.raw.write('event: ready\ndata: {}\n\n');
  };
}
