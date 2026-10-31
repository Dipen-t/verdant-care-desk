import { EventEmitter } from 'node:events';
import type { Queryable } from './db.js';

export type Change = {
  kind: 'message' | 'draft' | 'receipt';
  conversationId: string;
  customerId: string;
};
export type Audience = { type: 'agent' | 'customer'; id: string };

export function canReceiveChange(audience: Audience, change: Change) {
  return audience.type === 'agent'
    || (change.kind !== 'draft' && change.customerId === audience.id);
}

export class UpdateHub {
  private emitter = new EventEmitter();

  constructor() { this.emitter.setMaxListeners(0); }

  publish(change: Change) { this.emitter.emit('change', change); }

  subscribe(handler: (change: Change) => void) {
    this.emitter.on('change', handler);
    return () => { this.emitter.off('change', handler); };
  }
}
export const updateHub = new UpdateHub();

let lastWarning = 0;
export function reportNotificationFailure() {
  // Rate-limit warnings and omit data/error values that might contain message text.
  if (Date.now() - lastWarning > 60000) {
    lastWarning = Date.now();
    console.warn(JSON.stringify({ component: 'live_updates', status: 'notification_failed_polling_fallback' }));
  }
}

export async function announceConversation(db: Queryable, conversationId: string, kind: Change['kind']) {
  try {
    const result = await db.query<{ external_id: string }>(
      `SELECT u.external_id FROM conversations c JOIN customers u ON u.id=c.customer_id
       WHERE c.id=$1 AND c.brand_id='verdant-co'`, [conversationId],
    );
    if (result.rows[0]) {
      updateHub.publish({ kind, conversationId, customerId: result.rows[0].external_id });
    }
  } catch {
    reportNotificationFailure();
  }
}
