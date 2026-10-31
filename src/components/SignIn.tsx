import { useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { api, type AppConfig } from '../api';
import { ErrorNotice, errorText, Spinner } from './shared';

export function SignIn({ config, onSignedIn }: { config: AppConfig; onSignedIn: (email: string) => void }) {
  const [email, setEmail] = useState(config.localEmail || ''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const session = await api<{ email: string }>('/agent/login', { email, password }); setPassword(''); onSignedIn(session.email); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <main className="signin-page"><form className="signin-form" onSubmit={submit}>
    <span className="signin-icon"><LockKeyhole size={23} strokeWidth={1.5} /></span>
    <h1>Agent sign in</h1><p>Open your inbox to review and reply to customers.</p>
    {error && <ErrorNotice text={error} />}
    <label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} disabled={busy} required />
    <label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} required />
    <button className="primary-button" disabled={busy}>{busy ? <Spinner /> : null}Sign in<ArrowRight size={16} /></button>
    {config.localAuth && <p className="local-note">Local demo account. Use the agent credentials in your .env file or setup guide.</p>}
  </form></main>;
}
