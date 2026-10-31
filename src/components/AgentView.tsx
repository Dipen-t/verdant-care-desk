import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Check, ChevronDown, Inbox, LogOut, RefreshCw, Search, X } from 'lucide-react';
import { api, ApiError, type AppConfig, type Conversation, type ConversationSummary } from '../api';
import { activityTime, Avatar, ErrorNotice, errorText, Spinner, Transcript, usePolling } from './shared';
import { DraftEditor } from './DraftEditor';
import { SignIn } from './SignIn';
import { useLiveUpdates } from './useLiveUpdates';
import { refreshTargets, type LiveChange } from '../liveChanges';

export function AgentView({ config }: { config: AppConfig }) {
  const [email, setEmail] = useState<string | null>(null), [checking, setChecking] = useState(true);
  const [list, setList] = useState<ConversationSummary[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null), [activeDraft, setActiveDraft] = useState('');
  const [error, setError] = useState(''), [filter, setFilter] = useState(''), [needsReplyOnly, setNeedsReplyOnly] = useState(false);
  const [loading, setLoading] = useState(false), [showPolicies, setShowPolicies] = useState(false), [approved, setApproved] = useState(false);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const listRenderedIndex = useRef(0);
  const requestIndex = useRef(0), renderedIndex = useRef(0), initialSelectionMade = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void api<{ email: string }>('/agent/session').then(session => { if (!cancelled) setEmail(session.email); }).catch(e => {
      if (!cancelled && !(e instanceof ApiError && e.status === 401)) setError(errorText(e));
    }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, []);
  const refresh = useCallback(async (changes?: LiveChange[]) => {
    const id = selectedRef.current, index = ++requestIndex.current;
    try {
      const targets = refreshTargets(changes, id);
      const rows = targets.inbox ? await api<ConversationSummary[]>('/agent/conversations') : null;
      if (rows && index >= listRenderedIndex.current) { listRenderedIndex.current = index; setList(rows); }
      if (!id && rows?.length && !initialSelectionMade.current) {
        initialSelectionMade.current = true;
        if (window.matchMedia('(min-width: 761px)').matches) { setSelected(rows[0].id); return; }
      }
      if (id && targets.conversation) {
        const detail = await api<Conversation>(`/agent/conversations/${id}`);
        if (id === selectedRef.current && index >= renderedIndex.current) { renderedIndex.current = index; setConversation(detail); }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setEmail(null); else setError(errorText(e));
    }
  }, []);
  const live=useLiveUpdates('agent',refresh,Boolean(email));
  usePolling(refresh, Boolean(email),live?15000:3000);
  useEffect(() => {
    setConversation(null); setActiveDraft(''); setError(''); setApproved(false); setShowPolicies(false);
    if (selected && email) { setLoading(true); void refresh().finally(() => setLoading(false)); }
  }, [selected, email, refresh]);
  useEffect(() => { if (!approved) return; const timer = setTimeout(() => setApproved(false), 5000); return () => clearTimeout(timer); }, [approved]);
  useEffect(() => {
    if (!showPolicies) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowPolicies(false); };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, [showPolicies]);
  const availableDrafts = conversation?.drafts.filter(d => d.state !== 'used') || [];
  const draft = availableDrafts.find(d => d.id === activeDraft) || availableDrafts.at(-1);
  const waiting = list.filter(c => c.pending_count > 0).length;
  const filtered = list.filter(c => (!needsReplyOnly || c.pending_count > 0) && `${c.name} ${c.phone} ${c.preview}`.toLowerCase().includes(filter.toLowerCase()));
  async function logout() {
    try { await api('/agent/logout', {}); setEmail(null); setList([]); setSelected(null); initialSelectionMade.current = false; }
    catch (e) { setError(errorText(e)); }
  }
  if (checking) return <main className="loading-space"><Spinner />Opening inbox…</main>;
  if (!email) return <>{error && <div className="global-notice"><ErrorNotice text={error} /></div>}<SignIn config={config} onSignedIn={setEmail} /></>;
  return <main className={`agent-layout ${selected ? 'conversation-open' : ''}`}>
    <aside className="inbox-panel" aria-label="Conversation inbox">
      <header className="inbox-heading"><div><Inbox size={19} /><h1>Inbox</h1></div><button className="icon-button" onClick={() => void refresh()} aria-label="Refresh conversations"><RefreshCw size={16} /></button></header>
      <div className="inbox-tools"><label className="search-field"><Search size={16} /><span className="sr-only">Search conversations</span><input type="search" placeholder="Search conversations" value={filter} onChange={e => setFilter(e.target.value)} /></label><div className="inbox-filters" aria-label="Filter conversations"><button aria-pressed={!needsReplyOnly} onClick={() => setNeedsReplyOnly(false)}>All<span>{list.length}</span></button><button aria-pressed={needsReplyOnly} onClick={() => setNeedsReplyOnly(true)}>Needs reply<span>{waiting}</span></button></div></div>
      <div className="inbox-list">{filtered.map(c => <button key={c.id} className={`conversation-item ${selected === c.id ? 'selected' : ''}`} aria-current={selected === c.id ? 'true' : undefined} onClick={() => setSelected(c.id)}><Avatar name={c.name} /><span className="conversation-copy"><span className="conversation-top"><strong>{c.name}</strong><time dateTime={c.last_activity_at}>{activityTime(c.last_activity_at)}</time></span><span className="conversation-preview">{c.preview}</span><span className="conversation-status">{c.pending_count > 0 ? <><span className="waiting-dot" />Needs reply</> : <><Check size={12} />Replied</>}</span></span></button>)}{!filtered.length && <div className="inbox-empty"><Inbox size={28} strokeWidth={1.3} /><h2>{filter ? 'No matching conversations' : needsReplyOnly ? 'Nothing waiting for a reply' : 'No conversations yet'}</h2><p>{filter ? 'Try a name or a word from the message.' : needsReplyOnly ? 'All drafts have been reviewed.' : 'Send a message from the Customer view to get started.'}</p></div>}</div>
      <footer className="agent-account"><span className="account-avatar">{email[0].toUpperCase()}</span><div><strong>Agent account</strong><span>{email}</span></div><button className="icon-button" onClick={() => void logout()} aria-label="Sign out"><LogOut size={16} /></button></footer>
    </aside>
    <section className="agent-thread" aria-label="Selected conversation">
      <header className="thread-header"><button className="icon-button inbox-back" onClick={() => { setSelected(null); selectedRef.current = null; }} aria-label="Back to inbox"><ArrowLeft size={20} /></button>{conversation ? <><Avatar name={conversation.name} /><div className="thread-person"><h2>{conversation.name}</h2><p>{conversation.phone}</p></div><button className="policies-button" aria-expanded={showPolicies} aria-controls="brand-policies" onClick={() => setShowPolicies(!showPolicies)}><BookOpen size={16} /><span>Policies</span></button></> : <h2>{loading ? 'Opening conversation…' : 'Conversations'}</h2>}</header>
      {error && <div className="thread-notice"><ErrorNotice text={error} onClose={() => setError('')} /></div>}
      {approved && <div className="success-notice" role="status"><Check size={15} />Reply approved. The customer can see it now.</div>}
      {conversation ? <><Transcript key={conversation.id} messages={conversation.messages} customerName={conversation.name} agentView /><section className="reply-composer" aria-label="Review suggested reply">
        {availableDrafts.length > 1 && <div className="draft-picker"><label htmlFor="draft-selection">Reply to</label><div><select id="draft-selection" value={draft?.id || ''} onChange={e => setActiveDraft(e.target.value)}>{availableDrafts.map(d => <option key={d.id} value={d.id}>{conversation.messages.find(m => m.id === d.trigger_message_id)?.text.slice(0, 75)}</option>)}</select><ChevronDown size={13} /></div></div>}
        {draft ? <DraftEditor key={draft.id} draft={draft} conversation={conversation} policies={config.policies} onRefresh={refresh} onError={setError} onApproved={() => setApproved(true)} /> : <div className="all-replied"><Check size={17} /><span>All replies reviewed. New messages will appear here.</span></div>}
      </section></> : <div className="unselected-thread">{loading ? <Spinner /> : <Inbox size={38} strokeWidth={1.1} />}<h2>{loading ? 'Loading conversation' : 'Choose a conversation'}</h2><p>Messages and suggested replies appear here.</p></div>}
      {showPolicies && <section className="policies-panel" id="brand-policies" aria-label="Brand policies"><header><h2>Brand policies</h2><button className="icon-button" onClick={() => setShowPolicies(false)} aria-label="Close brand policies"><X size={18} /></button></header><p>Source of truth for suggested replies.</p>{config.policies.map(p => <section key={p.id}><h3>{p.id.replaceAll('-', ' ')}</h3><p>{p.text}</p></section>)}</section>}
    </section>
  </main>;
}
