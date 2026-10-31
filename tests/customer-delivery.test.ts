import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerTranscript, reconcileOutbox, restoreOutbox, type OutgoingMessage } from '../src/customerDelivery.js';
import type { Message } from '../src/api.js';

const outgoing: OutgoingMessage = { text: 'Where is my order?', requestId: '4f328d75-aecb-4996-99fa-15333bd1fe62', timestamp: '2026-10-31T10:00:00.000Z', status: 'sending' };
const saved: Message = { id: 'saved-message', sender: 'customer', text: outgoing.text, source_at: outgoing.timestamp, received_at: outgoing.timestamp, client_request_id: outgoing.requestId };

test('a lost acknowledgment is reconciled from the saved request ID without showing a duplicate', () => {
  assert.deepEqual(reconcileOutbox([{ ...outgoing, status: 'failed' }], [saved]), []);
  const transcript = customerTranscript([saved], [outgoing]);
  assert.equal(transcript.length, 1);
  assert.equal(transcript[0].deliveryStatus, 'sent');
});
test('an interrupted send restores the exact payload for an idempotent retry', () => {
  const restored = restoreOutbox(JSON.stringify([outgoing]));
  assert.equal(restored[0].requestId, outgoing.requestId);
  assert.equal(restored[0].timestamp, outgoing.timestamp);
  assert.equal(restored[0].text, outgoing.text);
  assert.equal(restored[0].status, 'failed');
  const transcript = customerTranscript([], restored);
  assert.equal(transcript[0].deliveryStatus, 'failed');
  assert.equal(transcript[0].text, outgoing.text);
});
test('identical text with a distinct request ID remains a separate unsent message', () => {
  const another = { ...outgoing, requestId: '6e970a6a-0ddd-4658-953b-a3608ed39c20', status: 'failed' as const };
  const transcript = customerTranscript([saved], [another]);
  assert.equal(transcript.length, 2);
  assert.equal(transcript[1].deliveryStatus, 'failed');
});
test('corrupted local outbox data cannot break the conversation', () => {
  for (const value of ['invalid JSON', '{}', 'null', '[null,123,"text"]', JSON.stringify([{ ...outgoing, requestId: 'bad' }])]) assert.deepEqual(restoreOutbox(value), []);
});
