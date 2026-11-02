import { useEffect, useState } from 'react';
import Stepper from '../bits/Stepper/Stepper';
import AnimatedList from '../bits/AnimatedList/AnimatedList';
import SpotlightCard from '../bits/SpotlightCard/SpotlightCard';
import { api, type AdminMeta, type AdminOrder, type AdminTenant } from '../api';
import './AdminPage.css';
import { Toggle } from './AssistantPage';

interface GlobalStats {
  tenantCount: number;
  conversationCount: number;
  messageCount: number;
  aiReplyCount: number;
}

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [setups, setSetups] = useState<{ meta: boolean; provider: boolean; tenantCount: number } | null>(null);

  useEffect(() => {
    api<{ ok: boolean }>('/api/admin/session')
      .then(s => setAuthed(s.ok))
      .catch(() => setAuthed(false));
    fetch('/api/setup/status')
      .then(r => r.json())
      .then(s =>
        setSetups({
          meta: Boolean(s.metaConfigured),
          provider: Boolean(s.providerConfigured),
          tenantCount: s.tenantCount
        })
      )
      .catch(() => setSetups(null));
  }, []);

  if (authed === null) {
    return <div className="im-loading">در حال بارگذاری…</div>;
  }

  return authed ? <AdminPanel onSignedOut={() => setAuthed(false)} setups={setups} /> : <AdminLogin onOk={() => setAuthed(true)} />;
}

// ---------------------------------------------------------------------------

function AdminLogin({ onOk }: { onOk: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/login', { method: 'POST', body: { key } });
      onOk();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ورود ناموفق بود.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-hero-center">
      <div className="login-brand" style={{ margin: '10px 0 26px' }}>
        <div className="login-brand-mark" style={{ width: 32, height: 32 }}>
          ◈
        </div>
        <span style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>پنل مدیر InstaMind</span>
      </div>

      <SpotlightCard className="admin-login-card" spotlightColor="rgba(90,95,105,0.18)" theme="light">
        <p className="admin-login-note">
          کلید مدیر را وارد کن. این کلید یک‌بار هنگام استقرار روی سرور تنظیم شده
          (<code>ADMIN_KEY</code>) و همین‌جا به‌عنوان رمز ورود پنل استفاده می‌شود.
        </p>
        <input
          className="im-input"
          type="password"
          placeholder="کلید مدیر…"
          value={key}
          onChange={e => setKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          autoFocus
          dir="ltr"
        />
        {error && <div className="login-error" style={{ marginTop: 10 }}>{error}</div>}
        <button className="im-btn primary" style={{ marginTop: 14, width: '100%' }} onClick={submit} disabled={busy || !key.trim()}>
          {busy ? 'در حال بررسی…' : 'ورود به پنل'}
        </button>
        <a href="/" className="admin-back-link">
          ← بازگشت به صفحهٔ ورود مشتری
        </a>
      </SpotlightCard>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AdminPanel({
  onSignedOut,
  setups
}: {
  onSignedOut: () => void;
  setups: { meta: boolean; provider: boolean; tenantCount: number } | null;
}) {
  const [tab, setTab] = useState<'setup' | 'tenants' | 'orders' | 'global'>('setup');

  // If setup is incomplete, force the setup tab.
  useEffect(() => {
    if (setups && (!setups.meta || !setups.provider)) setTab('setup');
  }, [setups]);

  const logout = async () => {
    await api('/api/admin/logout', { method: 'POST' });
    onSignedOut();
  };

  return (
    <div className="im-app-shell">
      <aside className="im-sidebar">
        <div className="im-brand">
          <div className="im-brand-mark">◈</div>
          <span>
            InstaMind <small style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>مدیر</small>
          </span>
        </div>
        {(
          [
            ['setup', 'راه‌اندازی', '✦'],
            ['tenants', 'مشتریان', '❂'],
            ['orders', 'سفارش اشتراک', '▦'],
            ['global', 'آمار کل', '◠']
          ] as Array<[typeof tab, string, string]>
        ).map(([id, label, icon]) => (
          <button key={id} className={`im-nav-item ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            <span aria-hidden="true">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
        <div className="im-sidebar-footer">
          <button className="im-btn small ghost" onClick={logout}>
            خروج پنل
          </button>
          <a className="im-btn small ghost" href="/">
            صفحهٔ مشتری
          </a>
        </div>
      </aside>

      <main className="im-content">
        {tab === 'setup' && <SetupSection setups={setups} />}
        {tab === 'tenants' && <TenantsSection />}
        {tab === 'orders' && <OrdersSection />}
        {tab === 'global' && <GlobalSection />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SetupSection({ setups }: { setups: { meta: boolean; provider: boolean; tenantCount: number } | null }) {
  const metaReady = setups?.meta ?? false;
  const aiReady = setups?.provider ?? false;

  return (
    <>
      <div className="im-page-head">
        <h1>راه‌اندازی یک‌بارهٔ سرویس</h1>
        <p>دو چیز را بده تا مشتری‌ها فقط با دکمهٔ «ورود با اینستاگرام» داخل بیایند.</p>
      </div>

      <div className="admin-setup-status">
        <span className={`im-badge ${metaReady ? 'ok' : 'warn'}`}>
          <span className="im-dot" />
          اپ متا {metaReady ? 'تنظیم شده' : 'تنظیم نشده'}
        </span>
        <span className={`im-badge ${aiReady ? 'ok' : 'warn'}`}>
          <span className="im-dot" />
          سرویس هوش مصنوعی {aiReady ? 'فعال' : 'تنظیم نشده'}
        </span>
        {setups && <span className="im-badge">{setups.tenantCount} مشتری متصل</span>}
      </div>

      <Stepper step={(metaReady ? 1 : 0) + (aiReady ? 1 : 0)} linear>
        <MetaStep done={metaReady} />
        <ProviderStep done={aiReady} />
      </Stepper>
    </>
  );
}

function MetaStep({ done }: { done: boolean }) {
  const [saved, setSaved] = useState<AdminMeta | null>(null);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api<{ meta: AdminMeta | null }>('/api/admin/meta').then(({ meta }) => {
      setSaved(meta);
      if (meta) {
        setAppId(meta.appId);
        setRedirectUri(meta.redirectUri ?? meta.generatedRedirectUri ?? '');
      }
    });
  }, []);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api('/api/admin/meta', {
        method: 'PUT',
        body: { appId, appSecret: appSecret || undefined, redirectUri }
      });
      const { meta } = await api<{ meta: AdminMeta }>('/api/admin/meta');
      setSaved(meta);
      setAppSecret('');
      setMsg('ذخیره شد.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'ذخیره ناموفق بود.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="im-card spot">
      <div className="im-toolbar-row">
        <div className="im-section-title" style={{ marginBottom: 0 }}>
          اپ متا (انستاگرام Business Login)
        </div>
        {done && <span className="im-badge ok">تکمیل</span>}
      </div>
      <p className="im-hint">
        در developers.facebook.com یک اپ بساز و محصول‌های <b>Instagram</b> را فعال کن؛ در Business login
        settings لینک بازگشتی زیر را ثبت کن. App Secret را فقط خود سرور می‌داند (رمزنگاری‌شده ذخیره می‌شود).
      </p>
      <p className="admin-formula" dir="auto">{saved?.generatedRedirectUri ?? 'https://دامنه‌شما/oauth/instagram/callback'}</p>

      <div className="admin-cols">
        <div className="im-field">
          <label>Instagram App ID</label>
          <input className="im-input" dir="ltr" value={appId} onChange={e => setAppId(e.target.value)} placeholder="1234567890" />
        </div>
        <div className="im-field">
          <label>App Secret {saved && <small>(خالی بماند تا قبلی حفظ شود)</small>}</label>
          <input className="im-input" dir="ltr" type="password" value={appSecret} onChange={e => setAppSecret(e.target.value)} placeholder="••••••••" />
        </div>
      </div>
      <div className="im-field">
        <label>Redirect URI ثبت‌شده در پنل متا (خالی = آدرس همین سرور)</label>
        <input className="im-input" dir="ltr" value={redirectUri} onChange={e => setRedirectUri(e.target.value)} />
      </div>

      {saved && (
        <div className="admin-meta-readout">
          <div>
            Webhook callback: <code dir="ltr">{saved.webhookUrl}</code>
          </div>
          <div>
            Verify token: <code dir="ltr">{saved.verifyToken}</code>
          </div>
        </div>
      )}

      <div className="admin-actions-row">
        <button className="im-btn primary" onClick={save} disabled={busy || !appId.trim()}>
          {busy ? 'در حال ذخیره…' : 'ذخیرهٔ اپ متا'}
        </button>
        {msg && <span className="im-sync-meta">{msg}</span>}
      </div>
    </div>
  );
}

function ProviderStep({ done }: { done: boolean }) {
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [strict, setStrict] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    api<{ provider: { baseUrl: string; model: string; scopeCheckEnabled: boolean } | null }>('/api/admin/provider').then(({ provider }) => {
      if (provider) {
        setBaseUrl(provider.baseUrl);
        setModel(provider.model);
        setStrict(provider.scopeCheckEnabled);
      }
    });
  }, []);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api('/api/admin/provider', {
        method: 'PUT',
        body: { baseUrl, apiKey: apiKey || undefined, model, scopeCheckEnabled: strict }
      });
      const { provider } = await api<{ provider: { baseUrl: string; model: string; apiKey: string } | null }>('/api/admin/provider');
      if (provider) {
        setBaseUrl(provider.baseUrl);
        setModel(provider.model);
      }
      setApiKey('');
      setMsg({ text: 'ذخیره شد.', ok: true });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'ذخیره ناموفق بود.', ok: false });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ ok: boolean; message: string; tokens: number }>('/api/admin/provider/test', {
        method: 'POST',
        body: {}
      });
      setMsg({ text: `${res.ok ? 'سالم' : 'خطا'}: ${res.message}`, ok: res.ok });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'تست ناموفق بود.', ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="im-card spot">
      <div className="im-toolbar-row">
        <div className="im-section-title" style={{ marginBottom: 0 }}>
          سرویس هوش مصنوعی (کلید خودت — هزینه روی تو، سرویس برای همهٔ مشتری‌ها)
        </div>
        {done && <span className="im-badge ok">فعال</span>}
      </div>
      <p className="im-hint">
        هر سرویس سازگار با OpenAI کار می‌کند (OpenAI، OpenRouter، Groq و…). کلید رمزنگاری‌شده در دیتابیس
        ذخیره می‌شود و فقط سرور می‌خوانَدش؛ مشتری‌ها هرگز کلید نمی‌بینند.
      </p>

      <div className="admin-cols">
        <div className="im-field">
          <label>Base URL</label>
          <input className="im-input" dir="ltr" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
        </div>
        <div className="im-field">
          <label>مدل</label>
          <input className="im-input" dir="ltr" value={model} onChange={e => setModel(e.target.value)} />
        </div>
      </div>
      <div className="im-field">
        <label>API Key {msg?.ok && !apiKey && <small>(ذخیره‌شده؛ خالی بگذار تا عوض نشود)</small>}</label>
        <input className="im-input" dir="ltr" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-…" />
      </div>
      <div className="im-field im-switch-field">
        <label>دروازهٔ موضوع (کال دوم پیش از پاسخ؛ ضد حاشیه‌زنی)</label>
        <Toggle checked={strict} onChange={setStrict} />
      </div>

      <div className="admin-actions-row">
        <button className="im-btn primary" onClick={save} disabled={busy}>
          ذخیرهٔ سرویس
        </button>
        <button className="im-btn" onClick={test} disabled={busy}>
          تست اتصال
        </button>
        {msg && <span className={`im-badge ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TenantsSection() {
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    const { tenants: list } = await api<{ tenants: AdminTenant[] }>('/api/admin/tenants');
    setTenants(list);
    setLoaded(true);
  };

  useEffect(() => {
    load().catch(() => setLoaded(true));
    const t = setInterval(() => load().catch(() => undefined), 30_000);
    return () => clearInterval(t);
  }, []);

  const update = async (tenant: AdminTenant, patch: { autoReply?: boolean; dailyReplyLimit?: number }) => {
    setTenants(list => list.map(t => (t.id === tenant.id ? { ...t, ...patch } : t)));
    await api(`/api/admin/tenants/${tenant.id}`, { method: 'PUT', body: patch });
  };

  const remove = async (tenant: AdminTenant) => {
    if (!confirm(`حساب @${tenant.username}ลบ شود؟ همهٔ گفتگوها و تنظیماتش حذف می‌شود.`)) return;
    await api(`/api/admin/tenants/${tenant.id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <>
      <div className="im-page-head">
        <h1>مشتریان متصل</h1>
        <p>هر ردیف یک پیج اینستاگرام است که با لاگین رسمی وصل شده.</p>
      </div>

      {loaded && tenants.length === 0 && (
        <div className="im-card">
          <div className="im-empty">هنوز مشتری‌ای متصل نشده. اولین نفر با دکمهٔ «ورود با اینستاگرام» می‌آید.</div>
        </div>
      )}

      <div className="admin-tenants-wrap">
        {tenants.map(t => (
          <TenantRow key={t.id} tenant={t} onUpdate={update} onDelete={remove} />
        ))}
      </div>
    </>
  );
}

function TenantRow({
  tenant,
  onUpdate,
  onDelete
}: {
  tenant: AdminTenant;
  onUpdate: (t: AdminTenant, patch: { autoReply?: boolean; dailyReplyLimit?: number }) => Promise<void>;
  onDelete: (t: AdminTenant) => Promise<void>;
}) {
  const [limit, setLimit] = useState(String(tenant.dailyReplyLimit));
  useEffect(() => setLimit(String(tenant.dailyReplyLimit)), [tenant.dailyReplyLimit]);

  const expired = Boolean(tenant.tokenExpiresAt && tenant.tokenExpiresAt < Date.now());

  return (
    <div className="im-card admin-tenant-row">
      <div className="tenant-main">
        <div>
          <div className="conn-user">@{tenant.username || tenant.igUserId}</div>
          <div className="conn-meta">
            پاسخ امروز: {tenant.repliesToday} · توکن امروز: {tenant.tokensToday.toLocaleString('fa-IR')} ·
            کل پاسخ‌ها: {tenant.repliesTotal}
          </div>
          <div className="conn-meta">
            توکن: {expired ? 'منقضی' : tenant.tokenExpiresAt ? `~${Math.max(0, Math.floor((tenant.tokenExpiresAt - Date.now()) / 86_400_000))} روز` : 'نامعلوم'} ·
            وبهوک: {tenant.subscribed ? 'فعال' : 'غیرفعال'}
          </div>
        </div>
        <div className="tenant-controls">
          <div className="im-switch-field" style={{ gap: 10 }}>
            <span className="stats-label">پاسخ خودکار</span>
            <Toggle checked={tenant.autoReply} onChange={v => void onUpdate(tenant, { autoReply: v })} />
          </div>
          <div className="tenant-limit">
            <span className="stats-label">سقف روزانه</span>
            <input
              className="im-input admin-limit-input"
              dir="ltr"
              type="number"
              min={0}
              value={limit}
              onChange={e => setLimit(e.target.value)}
              onBlur={() => void onUpdate(tenant, { dailyReplyLimit: Math.max(0, Number(limit) || 0) })}
            />
          </div>
          <button className="im-btn small danger" onClick={() => void onDelete(tenant)}>
            حذف
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const ADMIN_ORDER_STATUS: Record<AdminOrder['status'], string> = {
  pending: 'در انتظار پرداخت',
  active: 'فعال',
  rejected: 'رد شده',
  cancelled: 'لغو شده'
};

function OrdersSection() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    api<{ orders: AdminOrder[] }>('/api/admin/orders')
      .then(({ orders: list }) => {
        setOrders(list);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  };

  useEffect(load, []);

  const decide = async (order: AdminOrder, status: 'active' | 'rejected') => {
    await api(`/api/admin/orders/${order.id}/decide`, { method: 'POST', body: { status } });
    load();
  };

  return (
    <>
      <div className="im-page-head">
        <h1>سفارش‌های اشتراک</h1>
        <p>سفارش‌های ثبت‌شدهٔ مشتری‌ها؛ پرداخت را در حساب بانکی/درگاه چک کن و تأیید یا رد کن.</p>
      </div>

      {loaded && orders.length === 0 && <div className="im-empty">سفارشی ثبت نشده است.</div>}

      <div className="admin-tenants-wrap">
        {orders.map(o => (
          <div key={o.id} className="im-card admin-tenant-row">
            <div className="tenant-main">
              <div>
                <div className="global-user">
                  {o.planName} — <span style={{ fontWeight: 500 }} dir="ltr">{o.userEmail ?? '?'}</span>
                </div>
                <div className="global-stat">
                  {o.amount.toLocaleString('fa-IR')} تومان / ماه · {new Date(o.createdAt).toLocaleDateString('fa-IR')}
                </div>
              </div>
              <span className={`order-status ${o.status}`}>{ADMIN_ORDER_STATUS[o.status]}</span>
            </div>
            {o.status === 'pending' && (
              <div className="tenant-controls" style={{ marginTop: 12 }}>
                <button className="im-btn small primary" onClick={() => decide(o, 'active')}>
                  تأیید و فعال‌سازی
                </button>
                <button className="im-btn small danger" onClick={() => decide(o, 'rejected')}>
                  رد
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function GlobalSection() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [tenants, setTenants] = useState<AdminTenant[]>([]);

  useEffect(() => {
    api<{ stats: GlobalStats }>('/api/admin/stats').then(({ stats }) => setStats(stats)).catch(() => undefined);
    api<{ tenants: AdminTenant[] }>('/api/admin/tenants').then(({ tenants }) => setTenants(tenants)).catch(() => undefined);
  }, []);

  if (!stats) return <div className="im-loading">در حال بارگذاری…</div>;

  const top = [...tenants].sort((a, b) => b.repliesTotal - a.repliesTotal).slice(0, 6);

  return (
    <>
      <div className="im-page-head">
        <h1>آمار کل سرویس</h1>
        <p>همهٔ حساب‌ها روی هم؛ دید کلی برای مدیریت ظرفیت.</p>
      </div>

      <div className="im-stat-grid" style={{ marginBottom: 22 }}>
        <div className="im-stat">
          <span className="num">{stats.tenantCount.toLocaleString('fa-IR')}</span>
          <div className="label">مشتری متصل</div>
        </div>
        <div className="im-stat">
          <span className="num">{stats.conversationCount.toLocaleString('fa-IR')}</span>
          <div className="label">گفتگو</div>
        </div>
        <div className="im-stat">
          <span className="num">{stats.messageCount.toLocaleString('fa-IR')}</span>
          <div className="label">پیام</div>
        </div>
        <div className="im-stat">
          <span className="num">{stats.aiReplyCount.toLocaleString('fa-IR')}</span>
          <div className="label">پاسخ هوش مصنوعی</div>
        </div>
      </div>

      <AnimatedList
        enableArrowNavigation={false}
        animation="slide"
        showGradients={false}
        renderItem={(item, _index, selected) => {
          void selected;
          const entry = typeof item === 'string' ? { title: item } : item;
          return (
            <div className="global-row">
              <span className="global-user">@{entry.title}</span>
              <span className="global-stat">{String(entry.description ?? "").slice(0, 60)}</span>
            </div>
          );
        }}
        items={top.map((t, i) => ({
          id: t.id,
          title: t.username || t.igUserId,
          description: `${t.repliesTotal.toLocaleString('fa-IR')} پاسخ · ${t.tokensTotal.toLocaleString('fa-IR')} توکن`,
          meta: `#${i + 1}`
        }))}
      />
    </>
  );
}
