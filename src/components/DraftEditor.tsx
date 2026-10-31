import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, CircleAlert, RefreshCw, Sparkles } from 'lucide-react';
import { api, type Conversation, type Draft } from '../api';
import { clearDraft, errorText, readDraft, Spinner, writeDraft } from './shared';

const failures: Record<string, string> = {
  provider_not_configured: 'Add LLM_API_KEY and LLM_MODEL to .env, restart the server, then retry this draft.',
  invalid_provider_output: 'The AI response did not pass validation. Try again.',
  provider_http_401: 'The AI provider rejected its credentials. Check the configured API key before retrying.',
  provider_http_429: 'The provider is busy or has reached its quota. Wait, then retry.',
};
export function DraftEditor({ draft, conversation, policies, onRefresh, onError, onApproved }: {
  draft: Draft; conversation: Conversation; policies: { id: string; text: string }[];
  onRefresh: () => Promise<void>; onError: (text: string) => void; onApproved: () => void;
}) {
  const cacheKey = `verdant.agent-draft.${draft.id}`;
  const [text, setText] = useState(() => readDraft(cacheKey, draft.original_text || ''));
  const [busy, setBusy] = useState(false), [reviewedVersion, setReviewedVersion] = useState<number | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const stale = draft.context_version !== conversation.version;
  useEffect(() => { setText(readDraft(cacheKey, draft.original_text || '')); }, [cacheKey, draft.original_text]);
  useEffect(() => {
    const input = textarea.current;
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.max(100, Math.min(input.scrollHeight, 220))}px`; }
  }, [text, draft.state]);
  async function approve() {
    setBusy(true); onError('');
    try {
      await api(`/agent/drafts/${draft.id}/approve`, { text, expectedVersion: conversation.version });
      clearDraft(cacheKey); onApproved(); await onRefresh();
    } catch (e) { onError(errorText(e)); await onRefresh(); } finally { setBusy(false); }
  }
  async function retry() {
    setBusy(true); onError('');
    try { await api(`/agent/drafts/${draft.id}/retry`, {}); await onRefresh(); }
    catch (e) { onError(errorText(e)); } finally { setBusy(false); }
  }
  if (draft.state === 'used') return <div className="draft-complete"><Check size={17} />Reply approved.</div>;
  if (draft.state === 'pending' || draft.state === 'generating') return <div className="draft-loading" role="status"><Spinner /><div><strong>{draft.state === 'pending' ? 'Waiting to generate a draft…' : 'Writing a suggested reply…'}</strong><p>The customer’s message is saved. {draft.attempts > 0 && draft.state === 'pending' ? 'Retrying after a temporary issue.' : 'You can continue reading the conversation.'}</p></div></div>;
  if (draft.state === 'failed') return <div className="draft-failure"><div className="failure-copy"><CircleAlert size={18} /><div><strong>AI draft unavailable</strong><p>The message is saved. Retry when the issue is resolved.</p></div></div><details className="failure-details"><summary>View details<ChevronDown size={13} /></summary><p>{failures[draft.error_code || ''] || 'The provider could not generate a valid response. Check the server logs, then retry.'}</p></details><button className="secondary-button" disabled={busy} onClick={() => void retry()}>{busy ? <Spinner /> : <RefreshCw size={14} />}Retry draft</button></div>;
  const citedPolicies = policies.filter(p => draft.policy_ids.includes(p.id));
  return <div className="draft-editor">
    <div className="draft-editor-heading"><span><Sparkles size={15} />AI draft</span><span>Only you can see this</span></div>
    {draft.needs_review && <div className="notice review"><CircleAlert size={16} /><span>{draft.reason_code === 'medical_concern' ? 'Health concern: review carefully. The knowledge base has no medical guidance.' : draft.reason_code === 'outside_knowledge' ? 'This question is not fully covered by the policies. Confirm the reply.' : 'This reply needs more information from the customer.'}</span></div>}
    {stale && <label className="context-review"><input type="checkbox" checked={reviewedVersion === conversation.version} onChange={e => setReviewedVersion(e.target.checked ? conversation.version : null)} /><span>Newer activity arrived. I’ve checked the latest messages.</span></label>}
    <label className="sr-only" htmlFor={`draft-${draft.id}`}>Edit suggested reply</label>
    <textarea ref={textarea} id={`draft-${draft.id}`} value={text} maxLength={4000} disabled={busy} onChange={e => { setText(e.target.value); writeDraft(cacheKey, e.target.value); }} />
    <div className="draft-actions"><div className="draft-reference">{citedPolicies.length > 0 ? <details><summary>{citedPolicies.length === 1 ? '1 policy reference' : `${citedPolicies.length} policy references`}<ChevronDown size={12} /></summary><div>{citedPolicies.map(p => <section key={p.id}><strong>{p.id.replaceAll('-', ' ')}</strong><p>{p.text}</p></section>)}</div></details> : <span>No matching policy</span>}</div><button className="primary-button" disabled={!text.trim() || busy || (stale && reviewedVersion !== conversation.version)} onClick={() => void approve()}>{busy ? <Spinner /> : <Check size={16} />}Approve reply</button></div>
    <p className="approval-note">Approving adds this reply to the customer’s conversation.</p>
  </div>;
}
