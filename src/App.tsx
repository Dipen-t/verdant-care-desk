import { useEffect, useState } from 'react';
import { api, type AppConfig } from './api';
import { AgentView } from './components/AgentView';
import { CustomerView } from './components/CustomerView';
import { ErrorNotice, errorText, Spinner } from './components/shared';

export function App() {
  const [mode, setMode] = useState<'customer' | 'agent'>('customer');
  const [config, setConfig] = useState<AppConfig | null>(null), [error, setError] = useState('');
  useEffect(() => { void api<AppConfig>('/config').then(setConfig).catch(e => setError(errorText(e))); }, []);
  useEffect(() => {
    // Mobile visual viewports shrink when the software keyboard opens.
    const resize = () => document.documentElement.style.setProperty('--app-height', `${window.visualViewport?.height ?? window.innerHeight}px`);
    resize(); window.visualViewport?.addEventListener('resize', resize); window.addEventListener('resize', resize);
    return () => { window.visualViewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize); document.documentElement.style.removeProperty('--app-height'); };
  }, []);
  return <div className="app-shell">
    <header className="app-header">
      <a className="wordmark" href="/" aria-label="Verdant and Co home">verdant<span>& co.</span></a>
      <nav className="view-toggle" aria-label="Choose a view">
        <button aria-pressed={mode === 'customer'} onClick={() => setMode('customer')}>Customer</button>
        <button aria-pressed={mode === 'agent'} onClick={() => setMode('agent')}>Agent</button>
      </nav>
      <span className="sandbox-label"><span />Verdant support</span>
    </header>
    {error ? <main className="boot-error"><ErrorNotice text={`${error} Check that the API server is running.`} /><button className="secondary-button" onClick={() => window.location.reload()}>Try again</button></main>
      : config ? mode === 'customer' ? <CustomerView config={config} /> : <AgentView config={config} />
        : <main className="loading-space"><Spinner />Loading support…</main>}
  </div>;
}
