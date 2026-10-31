import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import type { Database } from './db.js';
import { AppError, approve, agentConversation, customerConversation, ingest, listConversations, testCustomers, webhookSchema } from './domain.js';
import { policies } from './knowledge.js';
import { acknowledgeMessages } from './receipts.js';
import { createSessions } from './sessions.js';
import { createEventStreams } from './eventStreams.js';

declare module 'fastify' {
  interface FastifyRequest { rawBody?: Buffer }
}

export function validSignature(raw: Buffer, header: unknown, secret: string) {
  if (typeof header !== 'string' || !/^sha256=[a-fA-F0-9]{64}$/.test(header)) return false;
  return timingSafeEqual(createHmac('sha256',secret).update(raw).digest(),Buffer.from(header.slice(7),'hex'));
}
export async function buildApp(db: Database, options: { logger?: boolean; localAuth?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 32000, trustProxy: false });
  const localAuth = options.localAuth ?? config.localAuth;
  await app.register(cookie,{ secret: config.sessionSecret });
  await app.register(rateLimit,{ max: 240, timeWindow: '1 minute' });
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json',{ parseAs: 'buffer' },(request,body,done) => {
    request.rawBody = body as Buffer;
    try { done(null,JSON.parse((body as Buffer).toString('utf8'))); } catch { done(new AppError(400,'invalid_json','Request body must be valid JSON.')); }
  });
  app.addHook('onRequest',async request => {
    // Cookie APIs are same-origin. Webhooks authenticate by signature instead.
    if (request.method !== 'GET' && request.url.startsWith('/api/') && request.headers.origin) {
      let origin: URL;
      try { origin = new URL(request.headers.origin); } catch { throw new AppError(403,'invalid_origin','Invalid request origin.'); }
      if (origin.host !== request.headers.host) throw new AppError(403,'invalid_origin','Use this application to make changes.');
    }
  });
  app.addHook('onSend',async (_request,reply,payload) => {
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','same-origin').header('X-Frame-Options','DENY');
    reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (_request.url.startsWith('/api/')) reply.header('Cache-Control','no-store');
    return payload;
  });
  app.setErrorHandler((error,request,reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ code: 'invalid_input', message: 'Check the supplied fields and try again.' });
    if (error instanceof AppError) return reply.code(error.status).send({ code: error.code, message: error.message });
    const statusCode = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode === 429) return reply.code(429).send({ code: 'rate_limited', message: 'Too many requests. Please wait a minute.' });
    if (statusCode >= 400 && statusCode < 500) return reply.code(statusCode).send({ code: 'invalid_request', message: 'The request could not be accepted.' });
    // Do not serialize DB errors: PostgreSQL details can contain customer message values.
    request.log.error({ requestId: request.id, errorType: error instanceof Error ? error.name : 'unknown' },'Request failed');
    return reply.code(500).send({ code: 'internal_error', message: 'Unable to save changes. Please retry.', requestId: request.id });
  });
  const { setSession, requireAgent, requireCustomer } = createSessions(db);
  const openEvents = createEventStreams(app, async (request, audience) => {
    try {
      return audience.type === 'agent'
        ? (await requireAgent(request)).userId === audience.id
        : requireCustomer(request).customerId === audience.id;
    } catch {
      return false;
    }
  });
  const receiptInput=z.object({messageIds:z.array(z.uuid()).min(1).max(100),state:z.enum(['received','read'])});
  app.get('/api/customer/events',async (request,reply) => {
    const session=requireCustomer(request); openEvents(request,reply,{type:'customer',id:session.customerId});
  });
  app.get('/api/agent/events',async (request,reply) => {
    const session=await requireAgent(request); openEvents(request,reply,{type:'agent',id:session.userId});
  });
  app.post('/api/customer/receipts',async request => {
    const session=requireCustomer(request),input=receiptInput.parse(request.body);
    return acknowledgeMessages(db,{type:'customer',id:session.customerId},input.messageIds,input.state);
  });
  app.post('/api/agent/receipts',async request => {
    const session=await requireAgent(request),input=receiptInput.parse(request.body);
    return acknowledgeMessages(db,{type:'agent',id:session.userId},input.messageIds,input.state);
  });
  app.get('/api/config',async () => ({ localAuth, localEmail: localAuth ? config.localEmail : undefined, customers: testCustomers, policies, brand: 'Verdant & Co' }));
  app.get('/api/health',async (_request,reply) => {
    try { await db.query('SELECT 1'); return { status: 'ok', aiConfigured: Boolean(config.llmKey && config.llmModel) }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  app.post('/webhook',async (request,reply) => {
    if (!validSignature(request.rawBody || Buffer.alloc(0),request.headers['x-signature'],config.webhookSecret)) throw new AppError(401,'invalid_signature','Invalid webhook signature.');
    const event = webhookSchema.parse(request.body);
    const result = await ingest(db,event);
    request.log.info({ eventId: event.event_id, messageId: result.messageId, duplicate: result.duplicate },'Message accepted');
    return reply.code(result.duplicate ? 200 : 202).send(result);
  });
  app.post('/api/customer/select',{ config: { rateLimit: { max: 40,timeWindow: '1 minute' } } },async (request,reply) => {
    const { customerId } = z.object({ customerId: z.string() }).parse(request.body);
    if (!testCustomers.some(c => c.id === customerId)) throw new AppError(400,'invalid_customer','Choose one of the test customers.');
    setSession(reply,'verdant_customer',{ kind: 'customer',customerId,exp: Date.now()+8*3600000 });
    return { customerId };
  });
  app.get('/api/customer/conversation',async request => customerConversation(db,requireCustomer(request).customerId));
  app.post('/api/customer/messages',{ config: { rateLimit: { max: 20,timeWindow: '1 minute' } } },async request => {
    const session = requireCustomer(request);
    const input = z.object({ text: z.string().trim().min(1).max(4000),requestId: z.uuid(),timestamp: z.iso.datetime({ offset: true }) }).parse(request.body);
    const customer = testCustomers.find(c => c.id === session.customerId)!;
    return ingest(db,webhookSchema.parse({ event_id: `demo_evt_${input.requestId}`,type: 'message.received',brand_id: 'verdant-co',timestamp: input.timestamp,customer,message: { id: `demo_msg_${input.requestId}`, type: 'text',text: input.text } }));
  });
  app.post('/api/agent/login',{ config: { rateLimit: { max: 8,timeWindow: '1 minute' } } },async (request,reply) => {
    const { email,password } = z.object({ email: z.email(),password: z.string().min(1).max(200) }).parse(request.body);
    let userId: string;
    if (localAuth) {
      const safeEqual = (a: string,b: string) => { const ah = createHmac('sha256',config.sessionSecret).update(a).digest(); const bh = createHmac('sha256',config.sessionSecret).update(b).digest(); return timingSafeEqual(ah,bh); };
      if (!safeEqual(email.toLowerCase(),config.localEmail.toLowerCase()) || !safeEqual(password,config.localPassword)) throw new AppError(401,'invalid_credentials','Email or password is incorrect.');
      userId = 'local-demo-agent';
      await db.query(`INSERT INTO agent_memberships(user_id,brand_id) VALUES($1,'verdant-co') ON CONFLICT DO NOTHING`,[userId]);
    } else {
      if (!config.supabaseUrl || !config.supabaseAnonKey) throw new AppError(503,'auth_not_configured','Agent sign-in is not configured yet.');
      const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`,{ method: 'POST', headers: { apikey: config.supabaseAnonKey,'Content-Type': 'application/json' }, body: JSON.stringify({ email,password }),signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new AppError(401,'invalid_credentials','Email or password is incorrect.');
      const body = z.object({ user: z.object({ id: z.uuid() }) }).parse(await response.json());
      userId = body.user.id;
    }
    const member = await db.query(`SELECT 1 FROM agent_memberships WHERE user_id=$1 AND brand_id='verdant-co'`,[userId]);
    if (!member.rows.length) throw new AppError(403,'not_an_agent','This account does not have agent access.');
    setSession(reply,'verdant_agent',{ kind: 'agent',userId,email,exp: Date.now()+8*3600000 });
    return { email };
  });
  app.post('/api/agent/logout',async (_request,reply) => { reply.clearCookie('verdant_agent',{ path: '/' }); return { ok: true }; });
  app.get('/api/agent/session',async request => { const session = await requireAgent(request); return { email: session.email }; });
  app.get('/api/agent/conversations',async request => { await requireAgent(request); return listConversations(db); });
  app.get('/api/agent/conversations/:id',async request => { await requireAgent(request); const { id } = z.object({ id: z.uuid() }).parse(request.params); return agentConversation(db,id); });
  app.post('/api/agent/drafts/:id/approve',async request => {
    const session = await requireAgent(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { text,expectedVersion } = z.object({ text: z.string().trim().min(1).max(4000),expectedVersion: z.number().int().nonnegative() }).parse(request.body);
    return approve(db,id,text,expectedVersion,session.userId);
  });
  app.post('/api/agent/drafts/:id/retry',{ config: { rateLimit: { max: 10,timeWindow: '1 minute' } } },async request => {
    await requireAgent(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    await db.transaction(async tx => {
      // Same lock order as the worker: job, then draft.
      const job = (await tx.query(`SELECT j.* FROM draft_jobs j JOIN drafts d ON d.id=j.draft_id WHERE d.id=$1 AND d.brand_id='verdant-co' FOR UPDATE OF j`,[id])).rows[0];
      if (!job || job.status !== 'failed') throw new AppError(409,'not_retryable','Only a failed draft can be retried.');
      await tx.query(`UPDATE draft_jobs SET status='pending',attempts=0,error_code=NULL,next_attempt_at=now(),claim_token=NULL WHERE id=$1`,[job.id]);
      await tx.query(`UPDATE drafts SET state='pending' WHERE id=$1`,[id]);
    });
    return { ok: true };
  });
  if (existsSync(resolve('dist/index.html'))) {
    await app.register(staticFiles,{ root: resolve('dist') });
    app.setNotFoundHandler((request,reply) => request.url.startsWith('/api/') || request.url.startsWith('/webhook') ? reply.code(404).send({ message: 'Endpoint not found.' }) : reply.sendFile('index.html'));
  }
  return app;
}
