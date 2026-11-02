import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type AccountMe, type OrderInfo, type PlanInfo } from '../api';
import './DashboardPage.css';

const STATUS_LABELS: Record<OrderInfo['status'], string> = {
  pending: 'در انتظار پرداخت',
  active: 'فعال',
  rejected: 'رد شده',
  cancelled: 'لغو شده'
};

export default function DashboardPage() {
  const [me, setMe] = useState<AccountMe | null>(null);
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [gotMe, setGotMe] = useState(false);

  const loadMe = useCallback(() => {
    api<AccountMe>('/api/account/me')
      .then(m => {
        setMe(m);
        setGotMe(true);
      })
      .catch(() => {
        window.location.href = '/';
      });
  }, []);

  useEffect(() => {
    loadMe();
    api<{ plans: PlanInfo[] }>('/api/plans')
      .then(({ plans: p }) => setPlans(p))
      .catch(() => setPlans([]));
  }, [loadMe]);

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  };

  const [profileName, setProfileName] = useState('');
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNext, setPwNext] = useState('');
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  useEffect(() => {
    if (me?.user) setProfileName(me.user.name ?? '');
  }, [me?.user?.id]);

  const saveName = async () => {
    setProfileMsg(null);
    try {
      const res = await api<{ ok: boolean; name: string }>('/api/account/profile', {
        method: 'POST',
        body: { name: profileName }
      });
      setProfileMsg(`ذخیره شد (${res.name})`);
      loadMe();
    } catch {
      setProfileMsg('ذخیره ناموفق بود.');
    }
  };

  const changePassword = async () => {
    setPwMsg(null);
    try {
      await api('/api/account/password', {
        method: 'POST',
        body: { current: pwCurrent, next: pwNext }
      });
      setPwMsg('رمز عوض شد.');
      setPwCurrent('');
      setPwNext('');
    } catch (e) {
      setPwMsg(e instanceof Error ? e.message : 'تغییر رمز ناموفق بود.');
    }
  };

  const subscribe = async (plan: PlanInfo) => {
    setBusyPlan(plan.id);
    setNote(null);
    try {
      const res = await api<{ order: { status: string } }>('/api/account/subscribe', {
        method: 'POST',
        body: { planId: plan.id }
      });
      setNote(
        res.order.status === 'pending'
          ? `درخواست اشتراک ${plan.name} ثبت شد؛ وضعیت: در انتظار پرداخت.`
          : `درخواست اشتراک ${plan.name} ثبت شد.`
      );
      loadMe();
    } catch {
      setNote('ثبت درخواست ناموفق بود.');
    } finally {
      setBusyPlan(null);
    }
  };

  const cancelOrder = async (id: string) => {
    setBusyPlan(id);
    try {
      await api(`/api/account/orders/${id}/cancel`, { method: 'POST' });
      loadMe();
    } catch {
      setNote('لغو سفارش ناموفق بود.');
    } finally {
      setBusyPlan(null);
    }
  };

  const openOrders = useMemo(() => (me?.orders ?? []).filter(o => o.status === 'pending'), [me]);

  if (!gotMe || !me) {
    return <div className="im-loading">در حال بارگذاری داشبورد…</div>;
  }

  const formatToman = (n: number) => `${(n / 1_000_000).toLocaleString('fa-IR')} میلیون تومان`;

  return (
    <div className="dash-page">
      <header className="dash-top">
        <div className="dash-brand">
          <div className="dash-mark">◈</div>
          <span>InstaMind</span>
        </div>
        <div className="dash-user">
          <span className="dash-email" dir="ltr">
            {me.user.email}
          </span>
          <button className="im-btn small ghost" onClick={logout}>
            خروج
          </button>
        </div>
      </header>

      <main className="dash-main">
        <h1 className="dash-hello">
          خوش آمدی{me.user.name ? `، ${me.user.name}` : ''} 👋
        </h1>
        <p className="dash-sub">از اینجا پیجت را وصل کن، دستیار را آموزش بده و اشتراک انتخاب کن.</p>

        <div className="dash-cards">
          <section className="im-card dash-card">
            <div className="dash-card-label">اشتراک فعلی</div>
            {me.user.planId ? (
              <>
                <div className="dash-card-value">{me.user.planName}</div>
                <div className="dash-card-hint">فعال و محدودیت‌های پلن اعمال شده است.</div>
              </>
            ) : (
              <>
                <div className="dash-card-value muted">بدون اشتراک</div>
                <div className="dash-card-hint">از لیست پلن‌های پایین یکی را انتخاب کن.</div>
              </>
            )}
          </section>

          <section className="im-card dash-card">
            <div className="dash-card-label">اتصال اینستاگرام</div>
            {me.instagram.connected ? (
              <>
                <div className="dash-card-value" dir="ltr">
                  @{me.instagram.username}
                </div>
                <a className="im-btn small" href="/app">
                  رفتن به پنل اتوماسیون
                </a>
              </>
            ) : (
              <>
                <div className="dash-card-value muted">وصل نیست</div>
                <a className="im-btn small primary" href="/oauth/instagram/start">
                  اتصال پیج اینستاگرام
                </a>
              </>
            )}
          </section>

          <section className="im-card dash-card">
            <div className="dash-card-label">مصرف پیج متصل</div>
            {me.instagram.connected && me.usage ? (
              <>
                <div className="dash-card-value">
                  {toLocale(me.usage.repliesToday)} / {me.usage.dailyReplyLimit ? toLocale(me.usage.dailyReplyLimit) : '∞'} پاسخ امروز
                </div>
                <div className="dash-card-hint">
                  مجموع: {toLocale(me.usage.repliesTotal)} پاسخ · {toLocale(me.usage.tokensTotal)} توکن
                </div>
              </>
            ) : (
              <div className="dash-card-value muted">پیج متصل نیست</div>
            )}
          </section>

          <section className="im-card dash-card">
            <div className="dash-card-label">دستیار هوش مصنوعی</div>
            <div className="dash-card-value muted">مدیر مدل را بعداً وصل می‌کند</div>
            <div className="dash-card-hint">
              شخصیت، دانش و پرسش‌وپاسخ‌ها الان قابل آماده‌سازی است؛ از صفحهٔ «دستیار» در پنل اتوماسیون.
            </div>
          </section>
        </div>

        {note && <div className="dash-note">{note}</div>}

        <section id="plans" className="dash-plans">
          <div className="dash-section-head">
            <h2>پلن‌های اشتراک — ماهانه</h2>
            <p>از ۹۹۹ هزار تا ۹ میلیون تومان؛ هر پلن سقف مصرف و امکانات خودش را دارد.</p>
          </div>
          <div className="dash-tiers">
            {plans.map(plan => {
              const ordered = openOrders.some(o => o.planId === plan.id);
              return (
                <div key={plan.id} className={`im-card tier-card ${plan.popular ? 'popular' : ''}`}>
                  {plan.popular && <div className="tier-badge">پرطرفدارترین</div>}
                  <div className="tier-name">{plan.name}</div>
                  <div className="tier-tag">{plan.tagline}</div>
                  <div className="tier-price">
                    {formatToman(plan.monthlyPrice)}
                    <span> / ماه</span>
                  </div>
                  <div className="tier-aimo">{plan.aiTier}</div>
                  <ul className="tier-features">
                    {plan.features.map(f => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <button
                    className="im-btn primary tier-buy"
                    disabled={busyPlan === plan.id}
                    onClick={() => subscribe(plan)}
                  >
                    {ordered ? 'درخواست ثبت شده' : busyPlan === plan.id ? 'در حال ثبت…' : 'خرید اشتراک'}
                  </button>
                  <div className="tier-support">{plan.support}</div>
                </div>
              );
            })}
          </div>
          <p className="dash-plans-note">
            ثبت درخواست یعنی سفارش شما در سامانه قید می‌شود و پس از پرداخت و تأیید مدیر، پلن فعال می‌شود.
          </p>
        </section>

        <section className="dash-orders">
          <div className="dash-section-head">
            <h2>سفارش‌های من</h2>
          </div>
          {me.orders.length === 0 ? (
            <div className="im-empty">هنوز سفارشی ثبت نکرده‌ای.</div>
          ) : (
            <div className="dash-orders-list">
              {me.orders.map(o => (
                <div key={o.id} className="im-card dash-order">
                  <div className="dash-order-plan">{plans.find(p => p.id === o.planId)?.name ?? o.planId}</div>
                  <div className="dash-order-meta">{toLocale(o.amount)} تومان / ماه</div>
                  <div className={`dash-order-status ${o.status}`}>{STATUS_LABELS[o.status]}</div>
                  {o.status === 'pending' && (
                    <button
                      className="im-btn small danger"
                      disabled={busyPlan === o.id}
                      onClick={() => cancelOrder(o.id)}
                    >
                      لغو
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="dash-orders">
          <div className="dash-section-head">
            <h2>پروفایل و امنیت</h2>
          </div>
          <div className="dash-profile-grid">
            <div className="im-card dash-card">
              <div className="dash-card-label">نام نمایشی</div>
              <input
                className="im-input"
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                placeholder="نام شما"
              />
              {profileMsg && <div className="dash-card-hint">{profileMsg}</div>}
              <button className="im-btn small primary" onClick={saveName}>
                ذخیره نام
              </button>
            </div>
            <div className="im-card dash-card">
              <div className="dash-card-label">تغییر رمز عبور</div>
              {me.user.googleLinked && !me.user.planId && (
                <div className="dash-card-hint">حساب گوگلی: می‌توانید همین‌جا رمز تعیین کنید تا ورود با ایمیل هم فعال شود.</div>
              )}
              <input
                className="im-input"
                type="password"
                dir="ltr"
                value={pwCurrent}
                onChange={e => setPwCurrent(e.target.value)}
                placeholder="رمز فعلی (اگر دارید)"
                autoComplete="current-password"
              />
              <input
                className="im-input"
                type="password"
                dir="ltr"
                value={pwNext}
                onChange={e => setPwNext(e.target.value)}
                placeholder="رمز تازه (حداقل ۸ کاراکتر)"
                autoComplete="new-password"
              />
              {pwMsg && <div className="dash-card-hint">{pwMsg}</div>}
              <button className="im-btn small primary" onClick={changePassword}>
                تغییر رمز
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function toLocale(n: number): string {
  return n.toLocaleString('fa-IR');
}
