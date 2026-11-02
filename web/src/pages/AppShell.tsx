import { useEffect, useState } from 'react';
import { api, type MeResponse } from '../api';
import './AppShell.css';
import InboxPage from './InboxPage';
import AssistantPage from './AssistantPage';
import StatsPage from './StatsPage';
import ConnectionPage from './ConnectionPage';

type Tab = 'inbox' | 'assistant' | 'stats' | 'connection';

interface Props {
  user: MeResponse['user'];
  onSignedOut: () => void;
}

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'inbox', label: 'اینباکس', icon: '✉️' },
  { id: 'assistant', label: 'دستیار', icon: '✦' },
  { id: 'stats', label: 'آمار', icon: '◠' },
  { id: 'connection', label: 'اتصال', icon: '⇄' }
];

export default function AppShell({ user, onSignedOut }: Props) {
  const [tab, setTab] = useState<Tab>('inbox');
  const [me, setMe] = useState(user);

  useEffect(() => {
    const hash = (window.location.hash.replace('#', '') || '') as Tab;
    if (TABS.some(t => t.id === hash)) setTab(hash);
  }, []);

  useEffect(() => {
    if (window.location.hash.replace('#', '') !== tab) {
      window.location.hash = tab;
    }
  }, [tab]);

  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash.replace('#', '') as Tab;
      if (TABS.some(t => t.id === hash)) setTab(hash);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!me) return null;

  const logout = async () => {
    await api('/api/logout', { method: 'POST' });
    onSignedOut();
  };

  return (
    <div className="im-app-shell">
      <aside className="im-sidebar">
        <div className="im-brand">
          <div className="im-brand-mark">◈</div>
          <span>InstaMind</span>
        </div>

        {TABS.map(t => (
          <button
            key={t.id}
            className={`im-nav-item ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span aria-hidden="true">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}

        <div className="im-sidebar-footer">
          <div>
            <strong>@{me.username}</strong>
          </div>
          <div>
            پاسخ خودکار: <b>{me.autoReply ? 'روشن' : 'خاموش'}</b>
          </div>
          <button className="im-btn small ghost" onClick={logout}>
            خروج از حساب
          </button>
        </div>
      </aside>

      <main className="im-content">
        {tab === 'inbox' && <InboxPage />}
        {tab === 'assistant' && <AssistantPage />}
        {tab === 'stats' && <StatsPage />}
        {tab === 'connection' && (
          <ConnectionPage
            me={me}
            onMeChanged={setMe}
          />
        )}
      </main>
    </div>
  );
}
