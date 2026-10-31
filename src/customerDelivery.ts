import type { Message } from './api';

export type OutgoingMessage = {
  text: string;
  requestId: string;
  timestamp: string;
  status: 'sending' | 'failed';
  error?: string;
};
export function restoreOutbox(serialized: string): OutgoingMessage[] {
  try {
    const data: unknown = JSON.parse(serialized);
    if (!Array.isArray(data)) return [];
    return data.filter((value): value is OutgoingMessage => Boolean(value &&
      typeof value.text === 'string' && value.text.trim() && value.text.length <= 4000 &&
      typeof value.requestId === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value.requestId) &&
      typeof value.timestamp === 'string' && Number.isFinite(Date.parse(value.timestamp))))
      .map(value => ({ text: value.text, requestId: value.requestId, timestamp: value.timestamp, status: 'failed', error: 'Send not confirmed. Retry to confirm it.' }));
  } catch { return []; }
}
export function reconcileOutbox(outbox: OutgoingMessage[], saved: Message[]) {
  const received = new Set(saved.map(message => message.client_request_id).filter(Boolean));
  return outbox.filter(message => !received.has(message.requestId));
}
export function customerTranscript(saved: Message[], outbox: OutgoingMessage[]): Message[] {
  return [
    ...saved.map(message => ({ ...message, deliveryStatus: message.sender === 'customer' ? 'sent' as const : undefined })),
    ...reconcileOutbox(outbox, saved).map(message => ({
      id: `pending-${message.requestId}`, sender: 'customer' as const, text: message.text,
      source_at: message.timestamp, received_at: message.timestamp, client_request_id: message.requestId,
      deliveryStatus: message.status, deliveryError: message.error,
    })),
  ];
}
