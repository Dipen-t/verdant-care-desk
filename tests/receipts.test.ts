import { before,after,beforeEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase,migrate,type Database } from '../server/db.js';
import { ingest,agentConversation,customerConversation,approve,AppError } from '../server/domain.js';
import { acknowledgeMessages } from '../server/receipts.js';
import { canReceiveChange,UpdateHub } from '../server/events.js';
import { runOneJob } from '../server/worker.js';
import { isViewed,type Bounds } from '../src/receiptVisibility.js';
let db:Database;
before(async()=>{db=await createDatabase('',':memory:');await migrate(db);});
after(async()=>{await db.close();});
beforeEach(async()=>{
  await db.query('TRUNCATE messages,conversations,customers,agent_memberships CASCADE');
  await db.query(`INSERT INTO agent_memberships(user_id,brand_id) VALUES('receipt-agent','verdant-co')`);
});
const agent={type:'agent' as const,id:'receipt-agent'};
const aisha={type:'customer' as const,id:'cust_1042'};
async function message(customerId='cust_1042'){
  return ingest(db,{event_id:randomUUID(),type:'message.received',brand_id:'verdant-co',timestamp:new Date().toISOString(),customer:{id:customerId,name:'Test Customer',phone:'+919800000001'},message:{id:randomUUID(),type:'text',text:'Returns?'}});
}
async function reply(){
  const incoming=await message();
  await runOneJob(db,async()=>({reply:'Unopened, unused products can be returned within 7 days of delivery.',policy_ids:['returns'],needs_human_review:false,reason_code:'policy_answer'}));
  const conversation=await agentConversation(db,incoming.conversationId);
  return {...incoming,replyId:(await approve(db,conversation.drafts[0].id,'Approved test reply',conversation.version,agent.id)).messageId};
}
test('fetching messages never manufactures delivery or read receipts',async()=>{
  const incoming=await message();await agentConversation(db,incoming.conversationId);
  const customer=await customerConversation(db,aisha.id);
  assert.equal(customer.messages[0].recipient_received_at,null);
  assert.equal(customer.messages[0].recipient_read_at,null);
});
test('received then read advances monotonically; repeated acknowledgments keep first timestamps',async()=>{
  const incoming=await message();
  assert.equal((await acknowledgeMessages(db,agent,[incoming.messageId],'received')).updated,1);
  const first=(await customerConversation(db,aisha.id)).messages[0];
  assert.ok(first.recipient_received_at);assert.equal(first.recipient_read_at,null);
  assert.equal((await acknowledgeMessages(db,agent,[incoming.messageId],'received')).updated,0);
  await acknowledgeMessages(db,agent,[incoming.messageId],'read');
  const viewed=(await customerConversation(db,aisha.id)).messages[0];
  assert.ok(viewed.recipient_read_at);
  assert.equal(new Date(viewed.recipient_received_at).getTime(),new Date(first.recipient_received_at).getTime());
  assert.equal((await acknowledgeMessages(db,agent,[incoming.messageId],'read')).updated,0);
});
test('a read receipt also records delivery and cannot be downgraded',async()=>{
  const incoming=await message();
  await acknowledgeMessages(db,agent,[incoming.messageId],'read');
  const first=(await customerConversation(db,aisha.id)).messages[0];
  assert.ok(first.recipient_received_at&&first.recipient_read_at);
  await acknowledgeMessages(db,agent,[incoming.messageId],'received');
  assert.deepEqual((await customerConversation(db,aisha.id)).messages[0],first);
});
test('customers acknowledge only agent replies in their own conversation',async()=>{
  const conversation=await reply();
  await assert.rejects(acknowledgeMessages(db,{type:'customer',id:'cust_1043'},[conversation.replyId],'read'),{code:'receipt_not_allowed'});
  await assert.rejects(acknowledgeMessages(db,aisha,[conversation.messageId],'read'),{code:'receipt_not_allowed'});
  await acknowledgeMessages(db,aisha,[conversation.replyId],'received');
  let detail=await agentConversation(db,conversation.conversationId);
  assert.ok(detail.messages.at(-1).recipient_received_at);assert.equal(detail.messages.at(-1).recipient_read_at,null);
  await acknowledgeMessages(db,aisha,[conversation.replyId],'read');
  detail=await agentConversation(db,conversation.conversationId);assert.ok(detail.messages.at(-1).recipient_read_at);
});
test('mixed unauthorized batches are atomic and non-agents cannot forge agent receipts',async()=>{
  const conversation=await reply();
  await assert.rejects(acknowledgeMessages(db,agent,[conversation.messageId,conversation.replyId],'read'),{code:'receipt_not_allowed'});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM message_receipts')).rows[0].n,0);
  await assert.rejects(acknowledgeMessages(db,{type:'agent',id:'outsider'},[conversation.messageId],'read'),{code:'not_an_agent'});
});
test('receipts do not change the approval context version',async()=>{
  const incoming=await message();const before=await agentConversation(db,incoming.conversationId);
  await acknowledgeMessages(db,agent,[incoming.messageId],'read');
  assert.equal((await agentConversation(db,incoming.conversationId)).version,before.version);
});
test('customer notifications exclude draft activity and other customers',()=>{
  const change={kind:'message' as const,conversationId:randomUUID(),customerId:aisha.id};
  assert.equal(canReceiveChange(aisha,change),true);
  assert.equal(canReceiveChange(aisha,{...change,kind:'draft'}),false);
  assert.equal(canReceiveChange(aisha,{...change,customerId:'cust_1043'}),false);
  assert.equal(canReceiveChange(agent,{...change,kind:'draft'}),true);
  const hub=new UpdateHub();let count=0;const stop=hub.subscribe(()=>count++);hub.publish(change);stop();hub.publish(change);assert.equal(count,1);
});
test('hidden, offscreen and briefly clipped messages are not eligible to be marked viewed',()=>{
  const viewport:Bounds={top:0,bottom:400,left:0,right:300,height:400,width:300};
  const bubble:Bounds={top:100,bottom:200,left:10,right:290,height:100,width:280};
  assert.equal(isViewed(bubble,viewport,'visible'),true);
  assert.equal(isViewed(bubble,viewport,'hidden'),false);
  assert.equal(isViewed({...bubble,top:500,bottom:600},viewport,'visible'),false);
  assert.equal(isViewed({...bubble,top:380,bottom:480},viewport,'visible'),false);
  assert.equal(isViewed({...bubble,top:0,bottom:1200,height:1200},viewport,'visible'),true);
});
