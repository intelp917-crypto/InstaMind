import { useEffect, useState } from 'react';
import { api, type MeResponse } from '../api';
import GlassSurface from '../bits/GlassSurface/GlassSurface';
import './ConnectionPage.css';

interface Props {
  me: NonNullable<MeResponse['user']>;
  onMeChanged: (me: NonNullable<MeResponse['user']>) => void;
}

function formatExpiry(ts: number | null): string {
  if (!ts) return 'نامعلوم';
  const days = Math.floor((ts - Date.now()) / 86_400_000);
  if (days <= 0) return 'منقضی شده';
  return `~${days} روز باقی‌مانده`;
}

export default function ConnectionPage({ me, onMeChanged }: Props) {
  const [message, setMessage] = useState<{ text: string; cls: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const test = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ ok: boolean; message: string; username: string }>('/api/tenant/connect/test', { method: 'POST' });
      setMessage({ text: res.message, cls: res.ok ? 'ok' : 'bad' });
      if (res.ok) onMeChanged({ ...me, username: res.username || me.username });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'تست ناموفق بود.', cls: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ ok: boolean; error?: string }>('/api/tenant/connect/refresh', { method: 'POST' });
      setMessage({ text: res.ok ? 'توکن تمدید شد.' : res.error ?? '', cls: res.ok ? 'ok' : 'bad' });
    } finally {
      setBusy(false);
    }
  };

  const toggleAutomation = async () => {
    setBusy(true);
    try {
      const res = await api<{ enabled: boolean }>('/api/tenant/automation', {
        method: 'POST',
        body: { enabled: !me.autoReply }
      });
      onMeChanged({ ...me, autoReply: res.enabled });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (message?.cls === 'ok' || message?.cls === 'bad') {
      const t = setTimeout(() => setMessage(null), 6000);
      return () => clearTimeout(t);
    }
  }, [message]);

  const expired = Boolean(me.tokenExpiresAt && me.tokenExpiresAt < Date.now());

  return (
    <>
      <div className="im-page-head">
        <h1>اتصال اینستاگرام</h1>
        <p>وضعیت حساب متصل، سینی خودکار و تمدید توکن رسمی.</p>
      </div>

      <div className="conn-wrap">
        <GlassSurface
          className="conn-card"
          borderRadius={20}
          backgroundOpacity={0.86}
          blur={6}
          displace={0}
          distortionScale={0}
          saturation={0}
        >
          <div className="conn-row">
            <div>
              <div className="conn-user">@{me.username}</div>
              <div className="conn-meta">شناسهٔ اینستاگرام: {me.igUserId}</div>
            </div>
            <div className="conn-badges">
              <span className={`im-badge ${me.subscribed ? 'ok' : 'warn'}`}>
                <span className="im-dot" />
                {me.subscribed ? 'به‌کرب‌همهٔ پیام (وبهوک فعال)' : 'اشتراک وبهوک برقرار نشد'}
              </span>
              <span className={`im-badge ${expired ? 'bad' : 'ok'}`}>
                <span className="im-dot" />
                توکن: {formatExpiry(me.tokenExpiresAt)}
              </span>
            </div>
          </div>

          {message && <div className={`conn-msg ${message.cls}`}>{message.text}</div>}

          <div className="conn-actions">
            <button className="im-btn" onClick={test} disabled={busy}>
              تست اتصال
            </button>
            <button className="im-btn" onClick={refresh} disabled={busy}>
              تمدید توکن (۶۰ روزه)
            </button>
            <a className="im-btn primary" href="/oauth/instagram/start">
              ورود مجدد با اینستاگرام
            </a>
          </div>
        </GlassSurface>

        <GlassSurface
          className="conn-card"
          borderRadius={20}
          backgroundOpacity={0.86}
          blur={6}
          displace={0}
          distortionScale={0}
          saturation={0}
        >
          <div className="conn-row">
            <div>
              <div className="conn-user">پاسخ خودکار</div>
              <div className="conn-meta">
                {me.autoReply
                  ? 'پیام‌های دایرکت بلافاصله از سوی هوش مصنوعی پاسخ می‌گیرند.'
                  : 'هوش مصنوعی خاموش است؛ پیام‌ها فقط آرشیو می‌شوند و تو دستی جواب می‌دهی.'}
              </div>
              <div className="conn-meta" style={{ marginTop: 6 }}>
                سقف روزانه: {me.dailyReplyLimit === 0 ? 'بدون محدودیت' : `${me.dailyReplyLimit} پاسخ`}
              </div>
            </div>
            <button
              className={`toggle-pill ${me.autoReply ? 'on' : ''}`}
              onClick={toggleAutomation}
              disabled={busy}
              aria-pressed={me.autoReply}
            >
              <span className="toggle-knob" />
            </button>
          </div>
        </GlassSurface>
      </div>
    </>
  );
}
