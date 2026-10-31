import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import type { Database } from './db.js';
import { policies, systemPrompt } from './knowledge.js';
import { announceConversation } from './events.js';
export const draftOutput = z.object({ reply: z.string().trim().min(1).max(700), policy_ids: z.array(z.enum(policies.map(p => p.id) as [string,...string[]])).max(7), needs_human_review: z.boolean(), reason_code: z.enum(['policy_answer','missing_information','outside_knowledge','medical_concern']) });
export type DraftOutput = z.infer<typeof draftOutput>;
export type GeneratedDraft = DraftOutput & { model?: string };
export class ProviderError extends Error { constructor(public code: string, public retryable: boolean) { super(code); } }
type History = { sender: string; text: string }[];
export async function generateDraft(history: History): Promise<GeneratedDraft> {
  if (!config.llmKey || !config.llmModel) throw new ProviderError('provider_not_configured',false);
  let openRouter: boolean;
  try { openRouter = new URL(config.llmBaseUrl).hostname === 'openrouter.ai'; }
  catch { throw new ProviderError('invalid_provider_url',false); }
  const models = [...new Set([config.llmModel,...(openRouter ? config.llmFallbackModels : [])])];
  if (config.llmModel.endsWith(':free') && models.some(model => !model.endsWith(':free') && model !== 'openrouter/free')) throw new ProviderError('non_free_fallback_not_allowed',false);
  const signal = AbortSignal.timeout(config.llmTimeout);
  let lastError: ProviderError = new ProviderError('provider_unavailable',true);
  for (const model of models) {
    try { return await requestDraft(model,history,signal,openRouter); }
    catch (error) {
      if (!(error instanceof ProviderError) || !error.retryable || signal.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
async function requestDraft(model: string, history: History, signal: AbortSignal, openRouter: boolean): Promise<GeneratedDraft> {
  let response: Response;
  try {
    response = await fetch(`${config.llmBaseUrl.replace(/\/$/,'')}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.llmKey}`, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ model, ...(openRouter ? { reasoning: { enabled: false } } : {}), temperature: 0.2, max_tokens: 450, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Draft a reply to the final customer message in this conversation data:\n${JSON.stringify(history)}` }] }),
    });
  } catch { throw new ProviderError('provider_timeout_or_network',true); }
  if (!response.ok) throw new ProviderError(`provider_http_${response.status}`,response.status === 429 || response.status >= 500);
  try {
    const body = await response.json() as any;
    const result = draftOutput.parse(JSON.parse(body.choices[0].message.content));
    // Flag unsupported topics even if the provider forgets its own review flag.
    if (result.reason_code !== 'policy_answer') result.needs_human_review = true;
    return { ...result, model: typeof body.model === 'string' ? body.model : model };
  } catch { throw new ProviderError('invalid_provider_output',true); }
}
export async function runOneJob(db: Database, generate = generateDraft, log: (data: object) => void = () => {}) {
  const job = await db.transaction(async tx => {
    const row = (await tx.query(`SELECT j.*,d.conversation_id,d.trigger_message_id FROM draft_jobs j JOIN drafts d ON d.id=j.draft_id
      WHERE (j.status='pending' AND j.next_attempt_at<=now()) OR (j.status='running' AND j.lease_until<now())
      ORDER BY j.next_attempt_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`)).rows[0];
    if (!row) return null;
    const token = randomUUID();
    await tx.query(`UPDATE draft_jobs SET status='running',attempts=attempts+1,claim_token=$2,lease_until=now()+($3 * interval '1 millisecond'),updated_at=now() WHERE id=$1`,[row.id,token,Math.max(config.llmTimeout + 15000,60000)]);
    await tx.query(`UPDATE drafts SET state='generating' WHERE id=$1 AND state!='used'`,[row.draft_id]);
    return { ...row, claim_token: token, attempts: row.attempts+1 };
  });
  if (!job) return false;
  const started = Date.now();
  try {
    // Context ends at the triggering message, so newer messages do not silently change this draft's target.
    const history = (await db.query(`SELECT sender,text FROM (SELECT sender,text,sequence FROM messages WHERE conversation_id=$1 AND sequence <= (SELECT sequence FROM messages WHERE id=$2) ORDER BY sequence DESC LIMIT 12) h ORDER BY sequence`,[job.conversation_id,job.trigger_message_id])).rows as History;
    const output = await generate(history);
    await db.transaction(async tx => {
      const current = (await tx.query('SELECT claim_token,status FROM draft_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
      if (current.claim_token !== job.claim_token || current.status !== 'running') return;
      await tx.query(`UPDATE drafts SET state='ready',original_text=$2,policy_ids=$3,needs_review=$4,reason_code=$5,model=$6 WHERE id=$1 AND state='generating'`,[job.draft_id,output.reply,JSON.stringify(output.policy_ids),output.needs_human_review,output.reason_code,output.model || config.llmModel || 'injected-test-provider']);
      await tx.query(`UPDATE draft_jobs SET status='done',lease_until=NULL,error_code=NULL,updated_at=now() WHERE id=$1`,[job.id]);
    });
    log({ jobId: job.id, draftId: job.draft_id, attempt: job.attempts, status: 'done', durationMs: Date.now()-started });
    void announceConversation(db,job.conversation_id,'draft');
  } catch(error) {
    const failure = error instanceof ProviderError ? error : new ProviderError('internal_generation_error',true);
    const retry = failure.retryable && job.attempts < 3;
    await db.transaction(async tx => {
      const current = (await tx.query('SELECT claim_token,status FROM draft_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
      if (current.claim_token !== job.claim_token || current.status !== 'running') return;
      await tx.query(`UPDATE draft_jobs SET status=$2,error_code=$3,lease_until=NULL,next_attempt_at=now()+($4 * interval '1 millisecond'),updated_at=now() WHERE id=$1`,[job.id,retry ? 'pending':'failed',failure.code,5000*2**(job.attempts-1)+Math.floor(Math.random()*1000)]);
      await tx.query('UPDATE drafts SET state=$2 WHERE id=$1',[job.draft_id,retry ? 'pending':'failed']);
    });
    log({ jobId: job.id, draftId: job.draft_id, attempt: job.attempts, status: retry ? 'retry':'failed', errorCode: failure.code, durationMs: Date.now()-started });
    void announceConversation(db,job.conversation_id,'draft');
  }
  return true;
}
export function startWorker(db: Database, log: (data: object) => void) {
  let stopped = false, active: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (active || stopped) return;
    active = runOneJob(db,generateDraft,log).then(() => {}).catch(() => log({ errorCode: 'worker_database_failure' })).finally(() => { active = undefined; });
  },1000);
  timer.unref();
  return async () => { stopped = true; clearInterval(timer); await active; };
}
