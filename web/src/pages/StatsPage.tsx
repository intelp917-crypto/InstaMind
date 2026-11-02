import { useEffect, useState } from 'react';
import { api, type TenantStats } from '../api';
import './StatsPage.css';

export default function StatsPage() {
  const [stats, setStats] = useState<TenantStats | null>(null);

  useEffect(() => {
    api<{ stats: TenantStats }>('/api/tenant/stats')
      .then(({ stats }) => setStats(stats))
      .catch(() => setStats(null));
  }, []);

  if (!stats) return <div className="im-loading">در حال بارگذاری…</div>;

  const replyRatio = stats.repliesTotal > 0 ? Math.round((stats.aiReplies / stats.repliesTotal) * 100) : 0;
  const dailyLimit = stats.dailyReplyLimit > 0 ? stats.dailyReplyLimit : 0;

  return (
    <>
      <div className="im-page-head">
        <h1>آمار و گزارش</h1>
        <p>نگاه سریع به رفتار دستیار روی پیج تو.</p>
      </div>

      <div className="stats-grids">
        <section className="stats-section">
          <div className="im-section-title">گفتگو و پیام</div>
          <div className="im-stat-grid">
            <StatCard value={stats.conversations} label="مخاطب‌ها" />
            <StatCard value={stats.incomingMessages} label="پیام دریافتی" />
            <StatCard value={stats.repliesTotal} label="کل پاسخ‌های ارسالی" />
          </div>
        </section>

        <section className="stats-section">
          <div className="im-section-title">کی جواب داده؟</div>
          <div className="im-stat-grid">
            <StatCard value={stats.aiReplies} label="پاسخ هوش مصنوعی" />
            <StatCard value={stats.manualReplies} label="پاسخ دستی" />
            <StatCard value={stats.fallbackReplies} label="پاسخ ثابت (خارج از موضوع)" />
            <StatCard value={stats.skippedReplies} label="مسدود / ناموفق" />
          </div>
          <div className="ratio-row">
            <span className="stats-label">سهم هوش مصنوعی از پاسخ‌ها</span>
            <div className="ratio-bar">
              <div className="ratio-fill" style={{ width: `${replyRatio}%` }} />
            </div>
            <span className="stats-label stat-strong">٪{replyRatio}</span>
          </div>
        </section>

        <section className="stats-section">
          <div className="im-section-title">مصرف امروز</div>
          <div className="im-stat-grid">
            <StatCard value={stats.repliesToday} label="پاسخ امروز" />
            <StatCard value={stats.tokensToday} label="توکن امروز" />
            <StatCard value={stats.tokensTotal} label="توکن کل" />
          </div>
          {dailyLimit > 0 && (
            <div className="ratio-row">
              <span className="stats-label">سقف روزانه</span>
              <div className="ratio-bar">
                <div
                  className="ratio-fill"
                  style={{ width: `${Math.min(100, Math.round((stats.repliesToday / dailyLimit) * 100))}%` }}
                />
              </div>
              <span className="stats-label stat-strong">
                {stats.repliesToday} از {dailyLimit}
              </span>
            </div>
          )}
          {dailyLimit === 0 && (
            <div className="im-hint" style={{ marginTop: 10 }}>
              سقف روزانه‌ای برای این حساب تعیین نشده (بدون محدودیت). مدیر می‌تواند از پنل تعیین کند.
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="im-stat">
      <span className="num">{value.toLocaleString('fa-IR')}</span>
      <div className="label">{label}</div>
    </div>
  );
}
