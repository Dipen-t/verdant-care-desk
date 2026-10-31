import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import type { Database } from './db.js';
import { AppError } from './errors.js';

const sessionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), userId: z.string().min(1), email: z.email(), exp: z.number().finite() }),
  z.object({ kind: z.literal('customer'), customerId: z.string().min(1), exp: z.number().finite() }),
]);
type Session = z.infer<typeof sessionSchema>;

export function createSessions(db: Database) {
  function readSession(request: FastifyRequest, name: string): Session | null {
    const cookie = request.cookies[name];
    if (!cookie) return null;
    const unsigned = request.unsignCookie(cookie);
    if (!unsigned.valid || !unsigned.value) return null;
    try {
      const parsed = sessionSchema.safeParse(JSON.parse(Buffer.from(unsigned.value, 'base64url').toString()));
      return parsed.success && parsed.data.exp > Date.now() ? parsed.data : null;
    } catch {
      return null;
    }
  }

  function setSession(reply: FastifyReply, name: string, session: Session) {
    reply.setCookie(name, Buffer.from(JSON.stringify(session)).toString('base64url'), {
      path: '/', httpOnly: true, sameSite: 'strict', secure: config.production,
      signed: true, maxAge: 8 * 3600,
    });
  }

  async function requireAgent(request: FastifyRequest) {
    const session = readSession(request, 'verdant_agent');
    if (!session || session.kind !== 'agent') {
      throw new AppError(401, 'sign_in_required', 'Sign in to open the agent workspace.');
    }
    const member = await db.query<{ allowed: number }>(
      `SELECT 1 AS allowed FROM agent_memberships WHERE user_id=$1 AND brand_id='verdant-co'`,
      [session.userId],
    );
    if (!member.rows.length) throw new AppError(403, 'not_an_agent', 'This account does not have agent access.');
    return session;
  }

  function requireCustomer(request: FastifyRequest) {
    const session = readSession(request, 'verdant_customer');
    if (!session || session.kind !== 'customer') {
      throw new AppError(401, 'choose_customer', 'Choose a test customer first.');
    }
    return session;
  }

  return { setSession, requireAgent, requireCustomer };
}
