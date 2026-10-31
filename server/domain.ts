import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, Queryable } from './db.js';
import { AppError } from './errors.js';
import { receiptProjection } from './receipts.js';
import { announceConversation, reportNotificationFailure } from './events.js';
export { AppError } from './errors.js';
export const webhookSchema = z.object({
  event_id: z.string().min(1).max(150), type: z.literal('message.received'), brand_id: z.literal('verdant-co'),
  timestamp: z.iso.datetime({ offset: true }),
  customer: z.object({ id: z.string().min(1).max(150), name: z.string().trim().min(1).max(100), phone: z.string().trim().min(5).max(30) }),
  message: z.object({ id: z.string().min(1).max(150), type: z.literal('text'), text: z.string().trim().min(1).max(4000) }),
});
export type Incoming = z.infer<typeof webhookSchema>;
export const testCustomers = [
  { id: 'cust_1042', name: 'Aisha Khan', phone: '+919800000001' },
  { id: 'cust_1043', name: 'Rohan Mehta', phone: '+919800000002' },
  { id: 'cust_1044', name: 'Maya Iyer', phone: '+919800000003' },
];
export async function ingest(db: Database, event: Incoming) {
  const { event_id, ...body } = event;
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return db.transaction(async tx => {
    // Serialize identifier collisions across processes, not just within this API instance.
    for (const key of [`event:${event_id}`, `message:${event.message.id}`, `customer:${event.customer.id}`]) {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
    }
    const existing = await tx.query(`SELECT e.payload_hash,e.message_id,m.conversation_id FROM webhook_events e JOIN messages m ON m.id=e.message_id WHERE e.brand_id=$1 AND (e.event_id=$2 OR m.external_id=$3)`, [event.brand_id,event_id,event.message.id]);
    if (existing.rows.length) {
      if (existing.rows.some(row => row.payload_hash !== hash)) throw new AppError(409,'identifier_conflict','An event or message ID was reused with different content.');
      const row = existing.rows[0];
      await tx.query('INSERT INTO webhook_events(brand_id,event_id,payload_hash,message_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[event.brand_id,event_id,hash,row.message_id]);
      return { duplicate: true, messageId: row.message_id, conversationId: row.conversation_id };
    }
    const customer = (await tx.query(`INSERT INTO customers(id,brand_id,external_id,name,phone) VALUES($1,$2,$3,$4,$5) ON CONFLICT(brand_id,external_id) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone RETURNING id`,[randomUUID(),event.brand_id,event.customer.id,event.customer.name,event.customer.phone])).rows[0];
    const conversation = (await tx.query(`INSERT INTO conversations(id,brand_id,customer_id) VALUES($1,$2,$3) ON CONFLICT(brand_id,customer_id) WHERE status='open' DO UPDATE SET customer_id=EXCLUDED.customer_id RETURNING id`,[randomUUID(),event.brand_id,customer.id])).rows[0];
    await tx.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE',[conversation.id]);
    const version = (await tx.query('UPDATE conversations SET version=version+1,last_activity_at=now() WHERE id=$1 RETURNING version',[conversation.id])).rows[0].version;
    const messageId = randomUUID(), draftId = randomUUID();
    await tx.query(`INSERT INTO messages(id,brand_id,conversation_id,external_id,sender,text,source_at) VALUES($1,$2,$3,$4,'customer',$5,$6)`,[messageId,event.brand_id,conversation.id,event.message.id,event.message.text,event.timestamp]);
    await tx.query('INSERT INTO webhook_events(brand_id,event_id,payload_hash,message_id) VALUES($1,$2,$3,$4)',[event.brand_id,event_id,hash,messageId]);
    await tx.query('INSERT INTO drafts(id,brand_id,conversation_id,trigger_message_id,context_version) VALUES($1,$2,$3,$4,$5)',[draftId,event.brand_id,conversation.id,messageId,version]);
    await tx.query('INSERT INTO draft_jobs(id,draft_id) VALUES($1,$2)',[randomUUID(),draftId]);
    return { duplicate: false, messageId, conversationId: conversation.id };
  }).then(result => {
    if (!result.duplicate) void announceConversation(db,result.conversationId,'message');
    return result;
  });
}
export async function customerConversation(db: Queryable, externalId: string) {
  const conversation = (await db.query(`SELECT c.id FROM conversations c JOIN customers u ON u.id=c.customer_id WHERE u.external_id=$1 AND c.brand_id='verdant-co' AND c.status='open'`,[externalId])).rows[0];
  if (!conversation) return { id: null, messages: [] };
  const messages = (await db.query(`SELECT m.id,m.sender,m.text,m.source_at,m.received_at,m.sequence,
    CASE WHEN left(m.external_id,9)='demo_msg_' THEN substring(m.external_id from 10) END AS client_request_id,
    ${receiptProjection} FROM messages m WHERE m.conversation_id=$1 ORDER BY m.sequence`,[conversation.id])).rows;
  return { id: conversation.id, messages };
}
export async function listConversations(db: Queryable) {
  return (await db.query(`SELECT c.id,c.version,c.last_activity_at,u.name,u.phone,
    (SELECT text FROM messages m WHERE m.conversation_id=c.id ORDER BY sequence DESC LIMIT 1) AS preview,
    (SELECT count(*)::int FROM drafts d WHERE d.conversation_id=c.id AND d.state!='used') AS pending_count
    FROM conversations c JOIN customers u ON u.id=c.customer_id WHERE c.brand_id='verdant-co' ORDER BY c.last_activity_at DESC,c.id`)).rows;
}
export async function agentConversation(db: Database, id: string) {
  // A consistent snapshot prevents showing new messages paired with an old approval version.
  return db.transaction(async tx => {
    const conversation = (await tx.query(`SELECT c.*,u.name,u.phone FROM conversations c JOIN customers u ON u.id=c.customer_id WHERE c.id=$1 AND c.brand_id='verdant-co' FOR UPDATE OF c`,[id])).rows[0];
    if (!conversation) throw new AppError(404,'not_found','Conversation not found.');
    const messages = (await tx.query(`SELECT m.id,m.sender,m.text,m.source_at,m.received_at,m.sequence,${receiptProjection} FROM messages m WHERE m.conversation_id=$1 ORDER BY m.sequence`,[id])).rows;
    const drafts = (await tx.query(`SELECT d.*,j.attempts,j.error_code FROM drafts d JOIN draft_jobs j ON j.draft_id=d.id WHERE d.conversation_id=$1 ORDER BY d.created_at,d.id`,[id])).rows;
    return { ...conversation, messages, drafts };
  });
}
export async function approve(db: Database, id: string, text: string, expectedVersion: number, agentId: string) {
  return db.transaction(async tx => {
    const initial = (await tx.query(`SELECT conversation_id FROM drafts WHERE id=$1 AND brand_id='verdant-co'`,[id])).rows[0];
    if (!initial) throw new AppError(404,'not_found','Draft not found.');
    const conversation = (await tx.query('SELECT * FROM conversations WHERE id=$1 FOR UPDATE',[initial.conversation_id])).rows[0];
    const draft = (await tx.query('SELECT * FROM drafts WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if (draft.state === 'used') {
      const saved = (await tx.query('SELECT text FROM messages WHERE id=$1',[draft.approved_message_id])).rows[0];
      if (saved.text === text) return { messageId: draft.approved_message_id, alreadyApproved: true };
      throw new AppError(409,'already_approved','This draft has already been approved. Refresh to see the reply.');
    }
    if (draft.state !== 'ready') throw new AppError(409,'draft_not_ready','Wait for a ready draft before approving.');
    if (conversation.version !== expectedVersion) throw new AppError(409,'context_changed','New activity arrived. Review the conversation and approve again.');
    const messageId = randomUUID();
    await tx.query(`INSERT INTO messages(id,brand_id,conversation_id,sender,text,source_at,agent_id) VALUES($1,'verdant-co',$2,'agent',$3,now(),$4)`,[messageId,conversation.id,text,agentId]);
    await tx.query(`UPDATE drafts SET state='used',approved_message_id=$2,approved_by=$3,approved_at=now() WHERE id=$1`,[id,messageId,agentId]);
    await tx.query('UPDATE conversations SET version=version+1,last_activity_at=now() WHERE id=$1',[conversation.id]);
    return { messageId, alreadyApproved: false };
  }).then(result => {
    if (!result.alreadyApproved) void db.query('SELECT conversation_id FROM drafts WHERE id=$1',[id]).then(row => announceConversation(db,row.rows[0].conversation_id,'message')).catch(reportNotificationFailure);
    return result;
  });
}
