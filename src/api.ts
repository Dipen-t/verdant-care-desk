export class ApiError extends Error { constructor(public status: number,public code: string,message: string) { super(message); } }
export async function api<T = unknown>(path: string,body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`,{ method: body === undefined ? 'GET':'POST',credentials: 'same-origin',headers: body === undefined ? {} : { 'Content-Type':'application/json' },body: body === undefined ? undefined : JSON.stringify(body),signal: AbortSignal.timeout(15000) });
  } catch {
    throw new ApiError(0,'connection_failed','Could not connect. Check your connection and try again.');
  }
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new ApiError(response.status,'invalid_response','The service is temporarily unavailable. Please try again.'); }
  if (!response.ok) {
    const error = result && typeof result === 'object' ? result as Record<string, unknown> : {};
    throw new ApiError(response.status, typeof error.code === 'string' ? error.code : 'request_failed',
      typeof error.message === 'string' ? error.message : 'The request failed. Please retry.');
  }
  return result as T;
}
export type Message = { id: string; sender: 'customer'|'agent'; text: string; source_at: string; received_at: string; client_request_id?: string|null; deliveryStatus?: 'sending'|'failed'|'sent'; deliveryError?: string; recipient_received_at?:string|null;recipient_read_at?:string|null };
export type Draft = { id: string; trigger_message_id: string; state: 'pending'|'generating'|'ready'|'failed'|'used'; original_text: string|null; policy_ids: string[]; needs_review: boolean; reason_code: string; context_version: number; error_code: string|null; attempts: number };
export type ConversationSummary = { id: string; name: string; phone: string; preview: string; last_activity_at: string; pending_count: number; version: number };
export type Conversation = ConversationSummary & { messages: Message[]; drafts: Draft[] };
export type AppConfig = { localAuth: boolean; localEmail?: string; customers: { id: string; name: string; phone: string }[]; policies: { id: string; text: string }[] };
