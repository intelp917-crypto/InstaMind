import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ConvoItem, type MsgItem } from '../api';

const PAUSE = 20_000;

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'همین حالا';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ساعت پیش`;
  return new Date(ts).toLocaleDateString('fa-IR');
}

function msgTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
}

function statusBadge(status: string): { label: string; cls: string } | null {
  if (!status) return null;
  if (status === 'manual') return { label: 'دستی', cls: '' };
  if (status.startsWith('manual')) return { label: 'دستی', cls: '' };
  if (status.startsWith('ai')) return { label: 'هوش مصنوعی', cls: '' };
  if (status.startsWith('fallback')) return { label: 'خارج از موضوع', cls: 'im-badge warn' };
  if (status.startsWith('failed')) return { label: 'ارسال ناموفق', cls: 'im-badge bad' };
  if (status.startsWith('blocked')) {
    return { label: 'مسدود', cls: 'im-badge warn' };
  }
  return null;
}

export default function InboxPage() {
  const [convos, setConvos] = useState<ConvoItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<MsgItem[]>([]);
  const [convo, setConvo] = useState<ConvoItem | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadedAll, setLoadedAll] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { conversations } = await api<{ conversations: ConvoItem[] }>('/api/tenant/conversations');
    setConvos(conversations);
    return conversations;
  }, []);

  const loadThread = useCallback(async (id: string) => {
    const data = await api<{ conversation: ConvoItem; messages: MsgItem[] }>(
      `/api/tenant/conversations/${id}`
    );
    setConvo(data.conversation);
    setMessages(data.messages);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await load();
        if (!cancelled && !selected && list.length > 0) {
          setSelected(list[0].id);
          await loadThread(list[0].id);
        }
        if (!cancelled) setLoadedAll(true);
      } catch {
        if (!cancelled) setLoadedAll(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Light polling so replies that arrive from the AI show up live.
  useEffect(() => {
    const timer = setInterval(() => {
      if (selected) {
        load().catch(() => undefined);
        loadThread(selected).catch(() => undefined);
      }
    }, PAUSE);
    return () => clearInterval(timer);
  }, [selected, load, loadThread]);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages]);

  const select = async (id: string) => {
    setSelected(id);
    setMessages([]);
    try {
      await loadThread(id);
    } catch {
      /* keep the list */
    }
  };

  const send = async () => {
    if (!selected || !draft.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; message?: string }>(
        `/api/tenant/conversations/${selected}/reply`,
        { method: 'POST', body: { text: draft.trim() } }
      );
      if (res.ok) {
        setDraft('');
        await loadThread(selected);
        await load();
      } else {
        alert(res.message ?? 'ارسال ناموفق بود.');
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'ارسال ناموفق بود.');
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async () => {
    if (!convo) return;
    await api(`/api/tenant/conversations/${convo.id}/pause`, {
      method: 'POST',
      body: { paused: !convo.ai_paused }
    });
    await loadThread(convo.id);
  };

  const remove = async () => {
    if (!convo) return;
    if (!confirm('این گفتگو و همهٔ پیام‌هایش حذف شود؟')) return;
    await api(`/api/tenant/conversations/${convo.id}`, { method: 'DELETE' });
    setSelected(null);
    setConvo(null);
    setMessages([]);
    await load();
  };

  return (
    <>
      <div className="im-page-head">
        <h1>اینباکس</h1>
        <p>گفتگوهای دایرکت، پاسخ‌های هوش مصنوعی و ارسال دستی.</p>
      </div>

      <div className="im-inbox-grid">
        <div className="im-card plain">
          <div className="im-section-title">گفتگوها</div>
          {!loadedAll && <div className="im-loading">در حال بارگذاری…</div>}
          {loadedAll && convos.length === 0 && (
            <div className="im-empty">
              هنوز پیامی نرسیده. از یک اکانت دیگر به پیجت دایرکت بده تا اینجا ببینی‌اش.
            </div>
          )}
          <div className="im-list-scroll">
            {convos.map(c => (
              <div
                key={c.id}
                className={`im-convo-item ${c.id === selected ? 'active' : ''}`}
                onClick={() => select(c.id)}
              >
                <div className="im-convo-top">
                  <span className="im-convo-user">@{c.username || c.sender_id}</span>
                  {c.ai_paused === 1 && <span className="im-badge warn">توقف AI</span>}
                  <span className="im-sync-meta">{timeAgo(c.last_message_at)}</span>
                </div>
                <div className="im-convo-preview">
                  {c.last_direction === 'out' ? 'شما: ' : ''}
                  {c.last_text || '—'}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="im-card">
          {!convo ? (
            <div className="im-empty">یک گفتگو را از سمت راست انتخاب کن.</div>
          ) : (
            <>
              <div className="im-toolbar-row">
                <div>
                  <span className="im-convo-user" style={{ fontSize: 15 }}>
                    @{convo.username || convo.sender_id}
                  </span>
                  <span className="im-sync-meta" style={{ marginInlineStart: 10 }}>
                    {messages.length} پیام
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="im-btn small" onClick={togglePause}>
                    {convo.ai_paused === 1 ? 'فعال‌سازی AI' : 'توقف AI'}
                  </button>
                  <button className="im-btn small danger" onClick={remove}>
                    حذف گفتگو
                  </button>
                </div>
              </div>

              <div className="im-thread" ref={threadRef}>
                {messages.map(m => {
                  const badge = statusBadge(m.status);
                  const isOut = m.direction === 'out';
                  return (
                    <div key={m.id} className={`im-bubble ${isOut ? 'out' : 'in'} ${isOut ? (m.status.startsWith('fallback') ? 'fallback' : m.status.startsWith('failed') ? 'failed' : '') : ''}`}>
                      {m.text}
                      <div className="im-msg-meta">
                        {msgTime(m.created_at)}
                        {badge && <span style={{ marginInlineStart: 6 }}>{badge.label}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="im-composer">
                <input
                  className="im-input"
                  placeholder="پیام دستی بنویس…"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <button className="im-btn primary" onClick={send} disabled={busy || !draft.trim()}>
                  ارسال
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
