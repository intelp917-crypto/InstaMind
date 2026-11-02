import { useEffect, useState } from 'react';
import DecryptedText from '../bits/DecryptedText/DecryptedText';
import './LoginPage.css';

interface Props {
  intent?: 'login' | 'register';
}

const ERROR_TEXTS: Record<string, string> = {
  'plan-page-limit:1': 'سقف پیج‌های پلن فعلی شما ۱ پیج است؛ برای اتصال پیج دیگر، پلن بالاتر بخرید.',
  'plan-page-limit:2': 'سقف پیج‌های پلن فعلی شما ۲ پیج است؛ برای اتصال بیشتر، پلن بالاتر بخرید.',
  'plan-page-limit:5': 'سقف پیج‌های پلن فعلی شما ۵ پیج است؛ برای اتصال بیشتر، پلن بالاتر بخرید.',
  'plan-page-limit:20': 'سقف پیج‌های پلن فعلی شما ۲۰ پیج است؛ برای سقف اختصاصی با ما تماس بگیرید.',
  'meta-not-configured': 'اتصال اینستاگرام هنوز توسط مدیر نصب نشده است. بعداً دوباره امتحان کنید.',
  'google-not-configured': 'ورود با گوگل هنوز توسط مدیر تنظیم نشده است؛ از فرم ایمیل استفاده کنید.',
  'missing-code': 'کد مجوز از گوگل دریافت نشد.',
  'invalid-state': 'درخواست ورود منقضی شده است؛ دوباره امتحان کنید.',
  'google-token-failed': 'تبدیل کد گوگل به نشست ناموفق بود؛ دوباره امتحان کنید.',
  'google-profile-failed': 'اطلاعات حساب گوگل تأیید نشد؛ دوباره امتحان کنید.',
  'tenant-failed': 'ساخت حساب شما ناموفق بود؛ دوباره امتحان کنید.'
};

export default function LoginPage({ intent = 'login' }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleReady, setGoogleReady] = useState<boolean | null>(null);
  const [igReady, setIgReady] = useState<boolean>(true);

  // form state
  const [mode, setMode] = useState<'login' | 'register'>(intent);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) {
      setError(ERROR_TEXTS[err] ?? decodeURIComponent(err).slice(0, 160));
      window.history.replaceState(null, '', '/');
    }

    fetch('/api/setup/status')
      .then(r => r.json())
      .then(s => {
        setGoogleReady(Boolean(s.googleConfigured));
        setIgReady(Boolean(s.metaConfigured));
      })
      .catch(() => setGoogleReady(null));
  }, []);

  const demoLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch('/api/dev/demo-login', { method: 'POST' });
      if (r.ok) {
        window.location.href = '/app';
        return;
      }
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? 'ورود دمو ناموفق بود؛ دوباره امتحان کنید.');
    } catch {
      setError('ورود دمو ناموفق بود؛ دوباره امتحان کنید.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ name, email, password })
        }).then(async r => {
          const data = await r.json().catch(() => ({} as { error?: string }));
          if (!r.ok) throw new Error(data.error ?? 'ثبت‌نام ناموفق بود.');
        });
      } else {
        await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email, password })
        }).then(async r => {
          const data = await r.json().catch(() => ({} as { error?: string }));
          if (!r.ok) throw new Error(data.error ?? 'ورود ناموفق بود.');
        });
      }
      window.location.href = '/dashboard';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطای نامشخص.');
      setBusy(false);
    }
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
              text="حساب بساز، اشتراکت را انتخاب کن و دایرکتت خودش جواب می‌دهد."
              animateOn="view"
              speed={30}
              maxIterations={3}
            />
          </span>
        </h1>

        <div className="login-card">
          <button
            className="login-ig-btn"
            onClick={() => {
              setBusy(true);
              window.location.href = '/oauth/google/start';
            }}
            disabled={busy || googleReady === false}
          >
            <GoogleGlyph />
            <span>{googleReady === false ? 'ورود با گوگل (فعال نیست)' : 'ورود با گوگل'}</span>
          </button>

          <div className="login-or">یا با ایمیل</div>

          <div className="login-tabs">
            <button
              type="button"
              className={mode === 'login' ? 'active' : ''}
              onClick={() => setMode('login')}
            >
              ورود
            </button>
            <button
              type="button"
              className={mode === 'register' ? 'active' : ''}
              onClick={() => setMode('register')}
            >
              ثبت‌نام
            </button>
          </div>

          <form
            className="login-form"
            onSubmit={e => {
              e.preventDefault();
              void submit();
            }}
          >
            {mode === 'register' && (
              <input
                className="im-input"
                placeholder="نام شما"
                value={name}
                onChange={e => setName(e.target.value)}
                autoComplete="name"
              />
            )}
            <input
              className="im-input"
              type="email"
              placeholder="ایمیل"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              dir="ltr"
            />
            <input
              className="im-input"
              type="password"
              placeholder={mode === 'register' ? 'رمز عبور (حداقل ۸ کاراکتر)' : 'رمز عبور'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              dir="ltr"
            />
            <button className="im-btn primary" type="submit" disabled={busy}>
              {busy ? 'لطفاً صبر کنید…' : mode === 'register' ? 'ساخت حساب' : 'ورود'}
            </button>
          </form>

          {error && <div className="login-error">{error}</div>}
          {googleReady === false && (
            <div className="login-hint">ورود با گوگل هنوز پیکربندی نشده؛ با ایمیل وارد شوید.</div>
          )}
          {igReady === false && (
            <button type="button" className="login-demo-btn" disabled={busy} onClick={demoLogin}>
              ورود دمو (بدون ثبت‌نام) — دیدن همهٔ صفحه‌ها
            </button>
          )}
          {igReady === false && (
            <div className="login-hint">اتصال اینستاگرام هنوز توسط مدیر تنظیم نشده است.</div>
          )}

          <ul className="login-points">
            <li>
              <b>پاسخ هوشمند:</b> فقط دربارهٔ موضوعاتی که خودت تعریف می‌کنی جواب می‌دهد.
            </li>
            <li>
              <b>آموزش پرسش‌وپاسخ:</b> جواب‌های آماده را یک بار آموزش بده، همیشه همان را بگوید.
            </li>
            <li>
              <b>کنترل کامل:</b> اینباکس، توقف هوش مصنوعی، پاسخ دستی و گزارش مصرف.
            </li>
          </ul>

          {igReady !== false && (
            <div className="login-footnote">
              پیج اینستاگرام داری و نمی‌خواهی اول حساب بسازی؟{' '}
              <a href="/oauth/instagram/start">ورود مستقیم با اینستاگرام</a>
            </div>
          )}
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

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.1.1 3.5 2.7.2.1c2.2-2.1 3.8-5.1 3.8-8.6z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.8-2.9l-3.7-2.9c-1 .7-2.3 1.1-4.1 1.1-3.1 0-5.8-2.1-6.7-5l-.1.1-3.6 2.8-.1.2C3.4 21.3 7.4 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.3 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3l-.1-.2L1.6 6.7l-.1.1C.5 8.8 0 10.4 0 12s.5 3.2 1.5 5.2l3.8-2.9z"
      />
      <path
        fill="#EB4335"
        d="M12 4.7c2.2 0 3.7.9 4.5 1.7l3.3-3.2C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.7 1.5 6.7l3.8 2.9c.9-2.8 3.6-4.9 6.7-4.9z"
      />
    </svg>
  );
}
