import { useEffect, useState } from 'react';
import { api, type AccountMe, type MeResponse } from './api';
import LoginPage from './pages/LoginPage';
import AppShell from './pages/AppShell';
import DashboardPage from './pages/DashboardPage';
import AdminPage from './pages/AdminPage';

type Screen = 'loading' | 'login' | 'app' | 'dashboard' | 'admin';

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

    // Load the automation (Instagram) session and the account (Google/email)
    // session in parallel; whichever exists decides the first screen.
    const tenantPromise = api<MeResponse>('/api/me').catch(() => null as unknown as MeResponse);
    const accountPromise = api<AccountMe>('/api/account/me').catch(() => null as unknown as AccountMe);

    Promise.all([tenantPromise, accountPromise]).then(([tenant, account]) => {
      if (cancelled) return;

      const wantsApp = currentPath() === '/app';
      if (tenant?.user && wantsApp) {
        setUser(tenant.user);
        setScreen('app');
        return;
      }
      if (account?.user) {
        setScreen('dashboard');
        return;
      }
      if (tenant?.user) {
        setUser(tenant.user);
        setScreen('app');
        return;
      }
      setScreen('login');
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
    if (screen === 'dashboard' && currentPath() !== '/dashboard') {
      window.history.replaceState(null, '', '/dashboard');
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

  if (screen === 'dashboard') {
    return <DashboardPage />;
  }

  return <AppShell user={user} onSignedOut={() => setScreen('dashboard')} />;
}
