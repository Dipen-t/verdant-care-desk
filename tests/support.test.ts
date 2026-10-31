import { after,before,beforeEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac,randomUUID } from 'node:crypto';
import { createDatabase,migrate,type Database } from '../server/db.js';
import { agentConversation,approve,customerConversation,ingest,webhookSchema,type Incoming } from '../server/domain.js';
import { buildApp,validSignature } from '../server/app.js';
import { draftOutput,ProviderError,runOneJob } from '../server/worker.js';
import { config } from '../server/config.js';
let db: Database;
before(async () => { db = await createDatabase('',':memory:'); await migrate(db); });
after(async () => { await db?.close(); });
beforeEach(async () => { await db.query('TRUNCATE draft_jobs,drafts,webhook_events,messages,conversations,customers,agent_memberships RESTART IDENTITY CASCADE'); });
function event(text = 'What is your return policy?'): Incoming { return { event_id: `evt_${randomUUID()}`,type: 'message.received',brand_id: 'verdant-co',timestamp: '2026-10-30T10:00:00Z',customer: { id: 'cust_1042',name: 'Aisha Khan',phone: '+919800000001' },message: { id: `msg_${randomUUID()}`,type: 'text',text } }; }
const output = { reply: 'Returns are accepted within 7 days of delivery for unopened, unused products. Opened products are accepted only if damaged or if the wrong item was sent.',policy_ids: ['returns'],needs_human_review: false,reason_code: 'policy_answer' as const };
async function count(table: string) { return Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n); }

test('raw-body HMAC rejects tampered bytes and malformed signatures',() => {
  const raw = Buffer.from('{"hello":"world"}'),secret = 'test';
  const header = `sha256=${createHmac('sha256',secret).update(raw).digest('hex')}`;
  assert.equal(validSignature(raw,header,secret),true);
  assert.equal(validSignature(Buffer.from('{ "hello":"world"}'),header,secret),false);
  for (const bad of [undefined,'sha256=zz','abc',123]) assert.equal(validSignature(raw,bad,secret),false);
});
test('duplicate event and duplicate message IDs preserve a single message and job',async () => {
  const incoming = event();
  const first = await ingest(db,incoming);
  assert.equal((await ingest(db,incoming)).duplicate,true);
  const secondEvent = await ingest(db,{ ...incoming,event_id: 'evt_distinct' });
  assert.equal(secondEvent.messageId,first.messageId);
  assert.equal(await count('messages'),1); assert.equal(await count('draft_jobs'),1); assert.equal(await count('webhook_events'),2);
});
test('conflicting reused identifiers are rejected without changing stored content',async () => {
  const incoming = event(); await ingest(db,incoming);
  await assert.rejects(ingest(db,{ ...incoming,message: { ...incoming.message,text: 'Different content' } }),{ code: 'identifier_conflict' });
  assert.equal((await db.query('SELECT text FROM messages')).rows[0].text,incoming.message.text);
});
test('concurrent messages share one open conversation',async () => {
  const results = await Promise.all([ingest(db,event('First message')),ingest(db,event('Second message'))]);
  assert.equal(results[0].conversationId,results[1].conversationId); assert.equal(await count('conversations'),1); assert.equal(await count('messages'),2);
});
test('database constraint independently prevents multiple open conversations',async () => {
  const saved = await ingest(db,event());
  const c = (await db.query('SELECT * FROM conversations WHERE id=$1',[saved.conversationId])).rows[0];
  await assert.rejects(db.query(`INSERT INTO conversations(id,brand_id,customer_id) VALUES($1,'verdant-co',$2)`,[randomUUID(),c.customer_id]));
});
test('draft generation preserves context and approval exposes only final text',async () => {
  const saved = await ingest(db,event());
  assert.equal(await runOneJob(db,async history => { assert.equal(history.at(-1)?.text,event().message.text); return output; }),true);
  const view = await agentConversation(db,saved.conversationId);
  const draft = view.drafts[0]; assert.equal(draft.state,'ready');
  const customerBefore = await customerConversation(db,'cust_1042');
  assert.equal(customerBefore.messages.length,1); assert.equal('drafts' in customerBefore,false);
  const edited = 'Thanks for getting in touch. '+output.reply;
  await approve(db,draft.id,edited,view.version,'test-agent');
  const customerAfter = await customerConversation(db,'cust_1042');
  assert.equal(customerAfter.messages.at(-1).text,edited);
  const stored = (await db.query('SELECT * FROM drafts WHERE id=$1',[draft.id])).rows[0];
  assert.equal(stored.original_text,output.reply); assert.equal(stored.state,'used'); assert.equal(stored.approved_by,'test-agent');
});
test('concurrent identical approvals create exactly one agent reply',async () => {
  const saved = await ingest(db,event()); await runOneJob(db,async () => output);
  const view = await agentConversation(db,saved.conversationId);
  const results = await Promise.all([approve(db,view.drafts[0].id,output.reply,view.version,'agent-a'),approve(db,view.drafts[0].id,output.reply,view.version,'agent-b')]);
  assert.equal(results[0].messageId,results[1].messageId);
  assert.equal(Number((await db.query(`SELECT count(*) AS n FROM messages WHERE sender='agent'`)).rows[0].n),1);
});
test('new-message race prevents approval against an old version',async () => {
  const saved = await ingest(db,event()); await runOneJob(db,async () => output);
  const view = await agentConversation(db,saved.conversationId);
  await ingest(db,event('Actually it has been opened.'));
  await assert.rejects(approve(db,view.drafts[0].id,output.reply,view.version,'agent'),{ code: 'context_changed' });
  const updated = await agentConversation(db,saved.conversationId);
  await approve(db,view.drafts[0].id,output.reply,updated.version,'agent');
});
test('provider failure leaves message intact and surfaces a durable failure',async () => {
  await ingest(db,event());
  await runOneJob(db,async () => { throw new ProviderError('provider_not_configured',false); });
  assert.equal(await count('messages'),1);
  assert.equal((await db.query('SELECT state FROM drafts')).rows[0].state,'failed');
  assert.equal((await db.query('SELECT error_code FROM draft_jobs')).rows[0].error_code,'provider_not_configured');
});
test('transient failures retry three times then stop',async () => {
  await ingest(db,event());
  for (let i=0;i<3;i++) { await db.query(`UPDATE draft_jobs SET next_attempt_at=now()`); await runOneJob(db,async () => { throw new ProviderError('provider_http_429',true); }); }
  const job = (await db.query('SELECT * FROM draft_jobs')).rows[0];
  assert.equal(job.attempts,3); assert.equal(job.status,'failed');
});
test('expired job leases are reclaimed and produce one draft',async () => {
  await ingest(db,event());
  await db.query(`UPDATE draft_jobs SET status='running',claim_token=$1,lease_until=now()-interval '1 minute',attempts=1`,[randomUUID()]);
  await runOneJob(db,async () => output);
  assert.equal((await db.query('SELECT state FROM drafts')).rows[0].state,'ready');
  assert.equal((await db.query('SELECT attempts FROM draft_jobs')).rows[0].attempts,2);
});
test('a late worker cannot overwrite a result after its claim is replaced',async () => {
  await ingest(db,event());
  await runOneJob(db,async () => { await db.query(`UPDATE draft_jobs SET claim_token=$1`,[randomUUID()]); return output; });
  assert.equal((await db.query('SELECT original_text FROM drafts')).rows[0].original_text,null);
});
test('draft generation history ends at the triggering message',async () => {
  await ingest(db,event('First question'));
  await ingest(db,event('Second question'));
  const seen: string[][] = [];
  await runOneJob(db,async history => { seen.push(history.map(m => m.text)); return output; });
  await runOneJob(db,async history => { seen.push(history.map(m => m.text)); return output; });
  assert.ok(seen.some(h => h.length === 1 && h[0] === 'First question'));
  assert.ok(seen.some(h => h.length === 2 && h[1] === 'Second question'));
});
test('validation rejects unsupported brands, oversized text and fabricated policy IDs',() => {
  assert.equal(webhookSchema.safeParse({ ...event(),brand_id: 'another-brand' }).success,false);
  const incoming = event('x'.repeat(4001)); assert.equal(webhookSchema.safeParse(incoming).success,false);
  assert.equal(draftOutput.safeParse({ ...output,policy_ids: ['imaginary-policy'] }).success,false);
});
test('HTTP endpoints enforce agent sessions, customer scopes, signatures and approval',async () => {
  const app = await buildApp(db,{ logger: false,localAuth: true });
  try {
    assert.equal((await app.inject('/api/agent/conversations')).statusCode,401);
    assert.equal((await app.inject('/api/customer/conversation')).statusCode,401);
    assert.equal((await app.inject({ method: 'POST',url: '/api/customer/select',payload: { customerId: 'not-a-demo-customer' } })).statusCode,400);
    const select = await app.inject({ method: 'POST',url: '/api/customer/select',payload: { customerId: 'cust_1042' } });
    const customerCookie = select.cookies.map(c => `${c.name}=${encodeURIComponent(c.value)}`).join('; ');
    const request = { text: 'Returns?',requestId: randomUUID(),timestamp: new Date().toISOString() };
    assert.equal((await app.inject({ method: 'POST',url: '/api/customer/messages',headers: { cookie: customerCookie },payload: request })).statusCode,200);
    assert.equal((await app.inject({ method: 'POST',url: '/api/customer/messages',headers: { cookie: customerCookie },payload: request })).json().duplicate,true);
    await runOneJob(db,async () => output);
    const customer = (await app.inject({ url: '/api/customer/conversation',headers: { cookie: customerCookie } })).json();
    assert.equal(customer.messages.length,1); assert.equal(JSON.stringify(customer).includes('original_text'),false);
    assert.equal(customer.messages[0].client_request_id,request.requestId);
    const signIn = await app.inject({ method: 'POST',url: '/api/agent/login',payload: { email: config.localEmail,password: config.localPassword } });
    assert.equal(signIn.statusCode,200);
    const agentCookie = signIn.cookies.map(c => `${c.name}=${encodeURIComponent(c.value)}`).join('; ');
    const detail = (await app.inject({ url: `/api/agent/conversations/${customer.id}`,headers: { cookie: agentCookie } })).json();
    assert.equal((await app.inject({ method: 'POST',url: `/api/agent/drafts/${detail.drafts[0].id}/approve`,headers: { cookie: agentCookie },payload: { text: output.reply,expectedVersion: detail.version } })).statusCode,200);
    const raw = JSON.stringify(event('Webhook test'));
    assert.equal((await app.inject({ method: 'POST',url: '/webhook',headers: { 'Content-Type': 'application/json' },payload: raw })).statusCode,401);
    const signature = createHmac('sha256',config.webhookSecret).update(raw).digest('hex');
    assert.equal((await app.inject({ method: 'POST',url: '/webhook',headers: { 'Content-Type': 'application/json','X-Signature': `sha256=${signature}` },payload: raw })).statusCode,202);
    assert.equal((await app.inject({ method: 'POST',url: '/api/agent/logout',headers: { origin: 'https://attacker.example' },payload: {} })).statusCode,403);
    // A different demo customer receives an empty, independent projection.
    const another = await app.inject({ method: 'POST',url: '/api/customer/select',payload: { customerId: 'cust_1043' } });
    const anotherCookie = another.cookies.map(c => `${c.name}=${encodeURIComponent(c.value)}`).join('; ');
    assert.deepEqual((await app.inject({ url: '/api/customer/conversation',headers: { cookie: anotherCookie } })).json().messages,[]);
  } finally { await app.close(); }
});
