import { useEffect, useState } from 'react';
import DecryptedText from '../bits/DecryptedText/DecryptedText';
import './LoginPage.css';

interface Props {
  error?: string;
}

const ERROR_TEXTS: Record<string, string> = {
  'meta-not-configured': 'اتصال اینستاگرام هنوز توسط مدیر نصب نشده است. بعداً دوباره امتحان کنید.',
  'missing-code': 'کد مجوز از اینستاگرام دریافت نشد.',
  'invalid-state': 'درخواست ورود منقضی شده است؛ دوباره امتحان کنید.',
  'tenant-failed': 'ساخت حساب شما ناموفق بود؛ دوباره امتحان کنید.'
};

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [setupReady, setSetupReady] = useState<boolean | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('error');
    if (code) {
      setError(ERROR_TEXTS[code] ?? decodeURIComponent(code).slice(0, 160));
      window.history.replaceState(null, '', '/');
    }

    fetch('/api/setup/status')
      .then(r => r.json())
      .then(s => setSetupReady(Boolean(s.metaConfigured)))
      .catch(() => setSetupReady(null));
  }, []);

  const start = () => {
    setBusy(true);
    window.location.href = '/oauth/instagram/start';
  };

  return (
    <div className="login-page">
      <div className="login-aurora" aria-hidden="true" />

      <main className="login-main">
        <div className="login-brand">
          <div className="login-brand-mark">◈</div>
          <span>InstaMind</span>
        </div>

        <h1 className="login-headline">
          <DecryptedText
            text="دستیار هوشمند دایرکت اینستاگرام"
            animateOn="view"
            speed={38}
          />
          <span className="login-headline-sub">
            <DecryptedText
              text="یک‌بار با اینستاگرام وارد شو، دایرکتت خودش جواب می‌دهد."
              animateOn="view"
              speed={30}
              maxIterations={3}
            />
          </span>
        </h1>

        <div className="login-card">
          <button className="login-ig-btn" onClick={start} disabled={busy || setupReady === false}>
            <InstagramGlyph />
            <span>{busy ? 'در حال انتقال…' : 'ورود با اینستاگرام'}</span>
          </button>

          {error && <div className="login-error">{error}</div>}
          {setupReady === false && (
            <div className="login-error">پنل مدیر هنوز راه‌اندازی نشده است؛ لطفاً بعداً سر بزنید.</div>
          )}

          <ul className="login-points">
            <li>
              <b>ورود رسمی:</b> پسوردت داخل keypad اینستاگرام می‌ماند و به ما هیچ‌وقت نمی‌رسد.
            </li>
            <li>
              <b>پاسخ هوشمند:</b> فقط دربارهٔ موضوعاتی که خودت تعریف می‌کنی جواب می‌دهد.
            </li>
            <li>
              <b>کنترل کامل:</b> اینباکس، توقف هوش مصنوعی، پاسخ دستی و گزارش مصرف.
            </li>
          </ul>
        </div>

        <footer className="login-footer">
          <span>InstaMind SaaS</span>
          <a href="/admin" className="login-admin-link">
            پنل مدیر
          </a>
        </footer>
      </main>
    </div>
  );
}

function InstagramGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zm0 1.8c-3.1 0-3.5 0-4.8.1-1.1.1-1.7.2-2.1.4-.5.2-.9.4-1.2.8-.4.4-.6.8-.8 1.2-.2.4-.3 1-.4 2.1-.1 1.3-.1 1.7-.1 4.8s0 3.5.1 4.8c.1 1.1.2 1.7.4 2.1.2.5.4.9.8 1.2.4.4.8.6 1.2.8.4.2 1 .3 2.1.4 1.3.1 1.7.1 4.8.1s3.5 0 4.8-.1c1.1-.1 1.7-.2 2.1-.4.5-.2.9-.4 1.2-.8.4-.4.6-.8.8-1.2.2-.4.3-1 .4-2.1.1-1.3.1-1.7.1-4.8s0-3.5-.1-4.8c-.1-1.1-.2-1.7-.4-2.1-.2-.5-.4-.9-.8-1.2-.4-.4-.8-.6-1.2-.8-.4-.2-1-.3-2.1-.4-1.3-.1-1.7-.1-4.8-.1zm0 3.1a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8zm0 8.1a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zm6.2-8.3a1.14 1.14 0 1 1-2.28 0 1.14 1.14 0 0 1 2.28 0z" />
    </svg>
  );
}
