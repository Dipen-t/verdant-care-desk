import 'dotenv/config';
import { createHmac,randomUUID } from 'node:crypto';
const body = JSON.stringify({ event_id: `evt_${randomUUID()}`,type: 'message.received',brand_id: 'verdant-co',timestamp: new Date().toISOString(),customer: { id: 'cust_1042',name: 'Aisha Khan',phone: '+919800000001' },message: { id: `msg_${randomUUID()}`,type: 'text',text: process.argv[3] || 'Hi, my order #4471 has not arrived. Can I change the address?' } });
const signature = createHmac('sha256',process.env.WEBHOOK_SECRET || 'verdant-demo-secret-2026').update(body).digest('hex');
const response = await fetch(process.argv[2] || 'http://127.0.0.1:3001/webhook',{ method: 'POST',headers: { 'Content-Type': 'application/json','X-Signature': `sha256=${signature}` },body });
console.log(response.status,await response.json());
if (!response.ok) process.exitCode=1;
