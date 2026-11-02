import { useEffect, useState } from 'react';
import { api, type MeResponse } from './api';
import LoginPage from './pages/LoginPage';
import AppShell from './pages/AppShell';
import AdminPage from './pages/AdminPage';

type Screen = 'loading' | 'login' | 'app' | 'admin';

function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, '') || '/';
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [user, setUser] = useState<MeResponse['user']>(null);

  useEffect(() => {
    let cancelled = false;

    if (currentPath() === '/admin') {
      setScreen('admin');
      return () => {
        cancelled = true;
      };
    }

    api<MeResponse>('/api/me')
      .then(me => {
        if (cancelled) return;
        if (me.user) {
          setUser(me.user);
          setScreen('app');
        } else {
          setScreen('login');
        }
      })
      .catch(() => {
        if (!cancelled) setScreen('login');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // navigation after login/logout
  useEffect(() => {
    if (screen === 'login' && currentPath() !== '/') {
      window.history.replaceState(null, '', '/');
    }
    if (screen === 'app' && currentPath() !== '/app') {
      window.history.replaceState(null, '', '/app');
    }
  }, [screen]);

  if (screen === 'loading') {
    return (
      <div className="im-hero-center">
        <div className="im-hint">در حال بارگذاری…</div>
      </div>
    );
  }

  if (screen === 'admin') {
    return <AdminPage />;
  }

  if (screen === 'login') {
    return <LoginPage />;
  }

  return <AppShell user={user} onSignedOut={() => setScreen('login')} />;
}
