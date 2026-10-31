import type { Database } from './db.js';
import { AppError } from './errors.js';
import { announceConversation, type Audience } from './events.js';

// Only aggregate timestamps leave the API. Recipient identities remain private.
export const receiptProjection = `
  (SELECT min(r.received_at) FROM message_receipts r WHERE r.message_id=m.id AND r.recipient_type=CASE WHEN m.sender='customer' THEN 'agent' ELSE 'customer' END) AS recipient_received_at,
  (SELECT min(r.read_at) FROM message_receipts r WHERE r.message_id=m.id AND r.recipient_type=CASE WHEN m.sender='customer' THEN 'agent' ELSE 'customer' END) AS recipient_read_at`;

export async function acknowledgeMessages(db: Database, audience: Audience, messageIds: string[], state: 'received'|'read') {
  const ids = [...new Set(messageIds)];
  if (!ids.length) return { updated: 0 };
  const result = await db.transaction(async tx => {
    if (audience.type === 'agent') {
      const membership = await tx.query(`SELECT 1 FROM agent_memberships WHERE user_id=$1 AND brand_id='verdant-co'`,[audience.id]);
      if (!membership.rows.length) throw new AppError(403,'not_an_agent','Agent access is required.');
    }
    const eligible = await tx.query<{ id: string; conversation_id: string }>(`SELECT m.id,m.conversation_id FROM messages m
      JOIN conversations c ON c.id=m.conversation_id JOIN customers u ON u.id=c.customer_id
      WHERE m.id=ANY($1::uuid[]) AND m.brand_id='verdant-co' AND
      (($2='agent' AND m.sender='customer') OR ($2='customer' AND m.sender='agent' AND u.external_id=$3))
      FOR SHARE OF m`,[ids,audience.type,audience.id]);
    // Reject the complete batch if any ID is invalid, belongs elsewhere, or is outgoing.
    if (eligible.rows.length !== ids.length) throw new AppError(403,'receipt_not_allowed','You can acknowledge only incoming messages in your conversation.');
    const changed = new Set<string>();
    let updated = 0;
    for (const message of eligible.rows) {
      const row = await tx.query<{ message_id: string }>(`INSERT INTO message_receipts(message_id,recipient_type,recipient_id,received_at,read_at)
        VALUES($1,$2,$3,statement_timestamp(),CASE WHEN $4='read' THEN statement_timestamp() ELSE NULL END)
        ON CONFLICT(message_id,recipient_type,recipient_id) DO UPDATE
        SET read_at=COALESCE(message_receipts.read_at,EXCLUDED.read_at)
        WHERE message_receipts.read_at IS NULL AND EXCLUDED.read_at IS NOT NULL
        RETURNING message_id`,[message.id,audience.type,audience.id,state]);
      if (row.rows.length) { updated++; changed.add(message.conversation_id); }
    }
    return { updated, conversations: [...changed] };
  });
  for (const id of result.conversations) void announceConversation(db,id,'receipt');
  return { updated: result.updated };
}
