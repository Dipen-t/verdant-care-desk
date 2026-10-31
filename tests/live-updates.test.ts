import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import { createEventStreams } from '../server/eventStreams.js';
import { updateHub } from '../server/events.js';
import { parseLiveBatch, refreshTargets } from '../src/liveChanges.js';

test('live updates refresh only relevant agent data', () => {
  const selected = randomUUID(), other = randomUUID();
  assert.deepEqual(refreshTargets([{ conversationId: other, kind: 'receipt' }], selected), { inbox: false, conversation: false });
  assert.deepEqual(refreshTargets([{ conversationId: selected, kind: 'receipt' }], selected), { inbox: false, conversation: true });
  assert.deepEqual(refreshTargets([{ conversationId: other, kind: 'message' }], selected), { inbox: true, conversation: false });
  assert.deepEqual(refreshTargets([{ conversationId: selected, kind: 'draft' }], selected), { inbox: true, conversation: true });
  assert.deepEqual(refreshTargets(undefined, selected), { inbox: true, conversation: true });
  assert.equal(parseLiveBatch({ changes: [{ conversationId: selected, kind: 'unknown' }] }), undefined);
  assert.equal(parseLiveBatch({ changes: Array(101).fill({ conversationId: selected, kind: 'receipt' }) }), undefined);
  assert.deepEqual(parseLiveBatch({ changes: [{ conversationId: selected, kind: 'receipt' }] }), [{ conversationId: selected, kind: 'receipt' }]);
});

test('streams batch duplicate changes, keep customers private, and close after authorization is revoked', async () => {
  const app = Fastify();
  let authorized = true;
  const open = createEventStreams(app, async () => authorized);
  app.get('/agent', (request, reply) => open(request, reply, { type: 'agent', id: 'test-agent' }));
  app.get('/customer', (request, reply) => open(request, reply, { type: 'customer', id: 'aisha' }));
  const controllers: AbortController[] = [];
  const readers: Promise<void>[] = [];
  async function connect(path: string) {
    const controller = new AbortController();
    controllers.push(controller);
    const response = await fetch(`${address}${path}`, { signal: controller.signal });
    const events: string[] = [];
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let finished = false;
    readers.push((async () => {
      let buffer = '';
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            events.push(buffer.slice(0, end));
            buffer = buffer.slice(end + 2);
          }
        }
      } catch { /* Expected when cleanup aborts the client. */ }
      finally { finished = true; }
    })());
    await until(() => events.some(event => event.startsWith('event: ready')));
    return { changes: () => events.filter(event => event.startsWith('event: change')), finished: () => finished };
  }
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    const agent = await connect('/agent'), customer = await connect('/customer');
    const change = { kind: 'receipt' as const, conversationId: randomUUID(), customerId: 'aisha' };
    updateHub.publish(change);
    updateHub.publish(change);
    updateHub.publish({ ...change, kind: 'draft' });
    updateHub.publish({ ...change, customerId: 'another-customer', conversationId: randomUUID() });
    await until(() => agent.changes().length === 1 && customer.changes().length === 1);
    const agentData = JSON.parse(agent.changes()[0].split('data: ')[1]);
    assert.equal(agentData.changes.length, 3);
    assert.ok(agentData.changes.every((item: object) => !('customerId' in item)));
    assert.equal(customer.changes()[0], 'event: change\ndata: {}');
    // A large burst must reconcile everything rather than silently lose targets.
    for (let i = 0; i < 101; i++) updateHub.publish({ ...change, conversationId: randomUUID() });
    await until(() => agent.changes().length === 2 && customer.changes().length === 2);
    assert.equal(agent.changes()[1], 'event: change\ndata: {}');
    authorized = false;
    updateHub.publish(change);
    await until(() => agent.finished() && customer.finished());
    assert.equal(agent.changes().length, 2);
    assert.equal(customer.changes().length, 2);
  } finally {
    for (const controller of controllers) controller.abort();
    await app.close();
    await Promise.all(readers);
  }
});

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert.ok(predicate(), 'Expected stream state before timeout');
}
