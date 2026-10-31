import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, MessageCircle, WifiOff, X } from 'lucide-react';
import type { AppConfig } from '../api';
import { Avatar, clearDraft, readDraft, Spinner, Transcript, writeDraft } from './shared';
import { useCustomerChat } from './useCustomerChat';

const samples = [
  { title: 'Where’s my order?', text: 'Hi, my order #4471 hasn’t arrived yet. Can I change the delivery address?' },
  { title: 'Can I return a product?', text: 'What is your return policy?' },
  { title: 'Do you deliver outside India?', text: 'Do you deliver to Dubai?' },
  { title: 'Can I pay on delivery?', text: 'Is cash on delivery available for a ₹3,500 order?' },
  { title: 'I have a product concern', text: 'I think I’m allergic to the serum I bought. What should I do?' },
];
export function CustomerView({ config }: { config: AppConfig }) {
  const [customerId, setCustomerId] = useState(() => {
    const saved = readDraft('verdant.customer');
    return config.customers.some(c => c.id === saved) ? saved : config.customers[0].id;
  });
  const [text, setText] = useState(() => readDraft(`verdant.customer-draft.${customerId}`));
  const textarea = useRef<HTMLTextAreaElement>(null), settings = useRef<HTMLDetailsElement>(null);
  const customer = config.customers.find(c => c.id === customerId)!;
  const draftKey = `verdant.customer-draft.${customerId}`;
  const chat = useCustomerChat(customerId);
  useEffect(() => { writeDraft('verdant.customer', customerId); }, [customerId]);
  useEffect(() => {
    const input = textarea.current;
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 132)}px`; }
  }, [text]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && settings.current) settings.current.open = false; };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, []);
  function updateText(value: string) { setText(value); writeDraft(draftKey, value); }
  function useSample(value: string) {
    updateText(value);
    if (settings.current) settings.current.open = false;
    textarea.current?.focus();
  }
  function changeCustomer(value: string) {
    setCustomerId(value); setText(readDraft(`verdant.customer-draft.${value}`));
    if (settings.current) settings.current.open = false;
  }
  function send(event: React.FormEvent) {
    event.preventDefault();
    if (!chat.send(text)) return;
    setText(''); clearDraft(draftKey);
    requestAnimationFrame(() => textarea.current?.focus());
  }
  return <main className="customer-page">
    <section className="customer-chat" aria-label="Customer conversation">
      <header className="chat-header">
        <Avatar name="Verdant" brand />
        <div className="chat-heading"><h1>Customer support</h1><p>Chatting as {customer.name}</p></div>
        <label className="customer-switcher" htmlFor="customer"><span>Test customer</span>
          <select id="customer" value={customerId} disabled={chat.busy || chat.loading} onChange={e => changeCustomer(e.target.value)}>{config.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <details className="demo-settings" ref={settings}>
          <summary><MessageCircle size={16} /><span>Sample messages</span><ChevronDown size={12} /></summary>
          <div className="demo-settings-menu">
            <header><strong>Sample messages</strong><button className="icon-button" onClick={() => { if (settings.current) settings.current.open = false; }} aria-label="Close sample messages"><X size={17} /></button></header>
            <p>Choose a question to add it to the message box. You can edit it before sending.</p>
            {samples.map(sample => <button className="demo-sample" key={sample.title} onClick={() => useSample(sample.text)}>{sample.title}</button>)}
          </div>
        </details>
      </header>
      {chat.connection === 'reconnecting' && <div className="connection-banner" role="status"><WifiOff size={16} /><span>Connection lost. Reconnecting…</span><button onClick={chat.reconnect}>Try now</button></div>}
      {chat.loading ? <div className="loading-space"><Spinner />Opening conversation…</div>
        : <Transcript key={customerId} messages={chat.messages} customerName={customer.name} onRetry={chat.retry} retryDisabled={chat.busy || !chat.canSend} emptyActions={<div className="starter-questions">{[samples[0], samples[1], samples[4]].map(sample => <button key={sample.title} onClick={() => useSample(sample.text)}>{sample.title}</button>)}</div>} />}
      <div className="customer-compose">
        <form className="message-composer" onSubmit={send}>
          <label className="sr-only" htmlFor="customer-message">Your message</label>
          <textarea ref={textarea} id="customer-message" rows={1} placeholder="Type your message…" maxLength={4000} value={text} onChange={e => updateText(e.target.value)} onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); send(e); }
          }} />
          <button className="send-button" disabled={!text.trim() || chat.busy || !chat.canSend} aria-label="Send message">{chat.busy ? <Spinner /> : <ArrowUp size={18} />}<span>Send</span></button>
        </form>
        <div className="composer-bottom"><span className="customer-reply-hint">Replies will appear in this conversation.</span><span className="keyboard-hint">Enter to send · Shift + Enter for a new line</span><span className="privacy-hint">Use fictional details</span></div>
      </div>
    </section>
  </main>;
}
