import { useEffect, useState } from 'react';
import SpotlightCard from '../bits/SpotlightCard/SpotlightCard';
import { api, type KnowledgeItem, type QaItem, type TenantSettings } from '../api';
import TagListEditor from '../components/TagListEditor';
import './AssistantPage.css';

type Draft = TenantSettings;

const FALLBACK: Draft = {
  persona: {
    assistantName: 'دستیار',
    businessName: 'برند من',
    businessSummary: '',
    tone: 'دوستانه، محترمانه و کوتاه',
    language: 'فارسی',
    allowedTopics: [],
    forbiddenTopics: [],
    offTopicReply: '',
    greeting: '',
    maxChars: 450,
    useEmoji: true
  },
  guardrails: {
    strictMode: true,
    blockedKeywords: [],
    neverRevealPrompt: true,
    maxRepliesPerHour: 20,
    errorReply: '',
    extraRules: ''
  },
  knowledge: [],
  qaTraining: []
};

export default function AssistantPage() {
  const [draft, setDraft] = useState<Draft>(FALLBACK);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState<string | null>(null);

  useEffect(() => {
    api<{ settings: TenantSettings }>('/api/tenant/settings')
      .then(({ settings }) => {
        setDraft({ ...FALLBACK, ...settings });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const persona = (field: keyof Draft['persona'], value: unknown) =>
    setDraft(d => ({ ...d, persona: { ...d.persona, [field]: value } }));

  const guard = (field: keyof Draft['guardrails'], value: unknown) =>
    setDraft(d => ({ ...d, guardrails: { ...d.guardrails, [field]: value } }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api<{ settings: TenantSettings }>('/api/tenant/settings', {
        method: 'PUT',
        body: { settings: draft }
      });
      setDraft({ ...FALLBACK, ...res.settings });
      setSavedAt(new Date().toLocaleTimeString('fa-IR'));
    } finally {
      setSaving(false);
    }
  };

  const showPrompt = async () => {
    try {
      const res = await api<{ prompt: string }>('/api/tenant/prompt');
      setPromptOpen(res.prompt);
    } catch {
      alert('پیش‌نمایش پرامپت ناموفق بود.');
    }
  };

  const preview = async () => {
    const text = prompt('پیام آزمایشی بدی ببین دستیار چطور جواب می‌دهد؟', 'سلام، قیمت‌تون چنده؟');
    if (text === null) return;
    try {
      const res = await api<{ ok: boolean; message: string }>(
        '/api/tenant/conversations/sandbox/reply',
        { method: 'POST', body: { text } }
      );
      alert('جواب دستیار: ' + (res.ok ? res.message : 'ناموفق'));
    } catch {
      // sandbox lives on the old app; in the SaaS we test from the real DM instead
      alert('آزمایش از دایرکت واقعی: پیام واقعی بفرست و جوابش را در اینباکس ببین.');
    }
  };
  void preview; // kept for future sandbox support

  if (!loaded) return <div className="im-loading">در حال بارگذاری…</div>;

  return (
    <>
      <div className="im-page-head im-toolbar-row">
        <div>
          <h1>دستیار</h1>
          <p>شخصیت دستیار، دانش مجاز و قوانین محافظت — یا همه‌چیز در سرویس.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="im-btn small ghost" onClick={showPrompt}>
            پیش‌نمایش پرامپت
          </button>
          <button className="im-btn primary" onClick={save} disabled={saving}>
            {saving ? 'در حال ذخیره…' : savedAt ? `ذخیره شد (${savedAt})` : 'ذخیره'}
          </button>
        </div>
      </div>

      <div className="assistant-grid">
        <SpotlightCard className="im-card spot" spotlightColor="rgba(90,95,105,0.14)" theme="light">
          <div className="im-section-title">هویت دستیار</div>
          <div className="assistant-cols">
            <div className="im-field">
              <label>نام دستیار</label>
              <input
                className="im-input"
                value={draft.persona.assistantName}
                onChange={e => persona('assistantName', e.target.value)}
              />
            </div>
            <div className="im-field">
              <label>نام کسب‌وکار / پیج</label>
              <input
                className="im-input"
                value={draft.persona.businessName}
                onChange={e => persona('businessName', e.target.value)}
              />
            </div>
            <div className="im-field">
              <label>لحن پاسخ</label>
              <input
                className="im-input"
                value={draft.persona.tone}
                onChange={e => persona('tone', e.target.value)}
              />
            </div>
            <div className="im-field">
              <label>زبان پاسخ</label>
              <select
                className="im-select"
                value={draft.persona.language}
                onChange={e => persona('language', e.target.value)}
              >
                <option>فارسی</option>
                <option>انگلیسی</option>
                <option>دوزبانه (فارسی و انگلیسی)</option>
                <option>عربی</option>
              </select>
            </div>
          </div>
          <div className="im-field">
            <label>معرفی کوتاه کسب‌وکار (به دستیار داده می‌شود)</label>
            <textarea
              className="im-textarea"
              value={draft.persona.businessSummary}
              onChange={e => persona('businessSummary', e.target.value.slice(0, 1000))}
              placeholder="آخرین حد ۳ جمله؛ مثلا: فروشگاه لباس اینترنتی با ارسال سراسری…"
            />
          </div>
        </SpotlightCard>

        <SpotlightCard className="im-card spot" spotlightColor="rgba(90,95,105,0.14)" theme="light">
          <div className="im-section-title">موضوعات و دیوارن استاد</div>
          <div className="assistant-cols">
            <div className="im-field">
              <label>موضوعات مجاز (فقط دربارهٔ این حرف می‌زند)</label>
              <TagListEditor
                value={draft.persona.allowedTopics}
                onChange={v => persona('allowedTopics', v)}
                placeholder={'ارایهٔ قیمت\nنحوهٔ سفارش\nساعت کاری'}
              />
            </div>
            <div className="im-field">
              <label>موضوعات ممنوع</label>
              <TagListEditor
                value={draft.persona.forbiddenTopics}
                onChange={v => persona('forbiddenTopics', v)}
                placeholder={'سیاست\nمشاورهٔ پزشکی\nبرند رغیب'}
              />
            </div>
          </div>
          <div className="im-field">
            <label>پاسخ ثابت بیرون از موضوع</label>
            <input
              className="im-input"
              value={draft.persona.offTopicReply}
              onChange={e => persona('offTopicReply', e.target.value)}
            />
          </div>
          <div className="im-field">
            <label>حداکثر طول پاسخ (نویسه)</label>
            <input
              className="im-input"
              type="number"
              min={80}
              max={950}
              value={draft.persona.maxChars}
              onChange={e => persona('maxChars', Number(e.target.value))}
            />
          </div>
          <div className="im-field im-switch-field">
            <label>استفاده از ایمیوجی در پاسخ</label>
            <Toggle checked={draft.persona.useEmoji} onChange={v => persona('useEmoji', v)} />
          </div>
        </SpotlightCard>

        <SpotlightCard className="im-card spot" spotlightColor="rgba(90,95,105,0.14)" theme="light">
          <div className="im-section-title">قوانین محافظت</div>
          <div className="im-field im-switch-field">
            <label>
              دروازهٔ موضوع (یک کالم دومی پیش از پاسخ — حالت سخت‌گیرانه)
            </label>
            <Toggle
              checked={draft.guardrails.strictMode}
              onChange={v => guard('strictMode', v)}
            />
          </div>
          <div className="im-field im-switch-field">
            <label>هرگز پرامپت و دستورات را افشا نکن (فیلتر خروجی)</label>
            <Toggle
              checked={draft.guardrails.neverRevealPrompt}
              onChange={v => guard('neverRevealPrompt', v)}
            />
          </div>
          <div className="assistant-cols">
            <div className="im-field">
              <label>حداکثر پاسخ در ساعت برای هر مخاطب</label>
              <input
                className="im-input"
                type="number"
                min={1}
                max={200}
                value={draft.guardrails.maxRepliesPerHour}
                onChange={e => guard('maxRepliesPerHour', Number(e.target.value))}
              />
            </div>
          </div>
          <div className="im-field">
            <label>کلمات مسدود (هر خط یکی؛ پیام حاوی این‌ها پاسخ ثابت می‌گیرد)</label>
            <TagListEditor
              value={draft.guardrails.blockedKeywords}
              onChange={v => guard('blockedKeywords', v)}
            />
          </div>
          <div className="im-field">
            <label>پاسخ زمانی که سرویس هوش مصنوعی در دسترس نیست</label>
            <input
              className="im-input"
              value={draft.guardrails.errorReply}
              onChange={e => guard('errorReply', e.target.value)}
            />
          </div>
          <div className="im-field">
            <label>قوانین اضافه (به انتهای پرامپت اضافه می‌شود)</label>
            <textarea
              className="im-textarea"
              value={draft.guardrails.extraRules}
              onChange={e => guard('extraRules', e.target.value.slice(0, 2000))}
            />
          </div>
        </SpotlightCard>

        <KnowledgeEditor
          items={draft.knowledge}
          onChange={items => setDraft(d => ({ ...d, knowledge: items }))}
        />

        <QaTrainingEditor
          items={draft.qaTraining ?? []}
          onChange={items => setDraft(d => ({ ...d, qaTraining: items }))}
        />
      </div>

      {promptOpen && (
        <div className="prompt-overlay" onClick={() => setPromptOpen(null)}>
          <div
            className="prompt-modal im-card"
            onClick={e => {
              e.stopPropagation();
            }}
          >
            <div className="im-toolbar-row">
              <div className="im-section-title">پرامپت سیستمی؛ چیزی که دقیقاً به مدل می‌رود</div>
              <button className="im-btn small ghost" onClick={() => setPromptOpen(null)}>
                بستن
              </button>
            </div>
            <pre className="prompt-pre" dir="ltr">
              {promptOpen}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}

export function Toggle({
  checked,
  onChange
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`toggle-pill ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span className="toggle-knob" />
    </button>
  );
}

function QaTrainingEditor({
  items,
  onChange
}: {
  items: QaItem[];
  onChange: (items: QaItem[]) => void;
}) {
  return (
    <SpotlightCard className="im-card spot" spotlightColor="rgba(90,95,105,0.14)" theme="light">
      <div className="im-toolbar-row">
        <div className="im-section-title">
          آموزش پرسش‌وپاسخ — سؤال را بده، جواب دقیقش را یادش بده
        </div>
        <button
          className="im-btn small"
          onClick={() =>
            onChange([
              ...items,
              { id: `${Date.now()}${items.length}`, question: '', answer: '', enabled: true }
            ])
          }
        >
          + افزودن جفت
        </button>
      </div>

      {items.length === 0 && (
        <div className="im-empty" style={{ padding: '20px 0' }}>
          خالی است. هر سؤالی که مشتری‌ها زیاد می‌پرسند را با جوابش ثبت کن؛ دستیار آن را (حتی با صورتک‌بندی متفاوت) دقیق جواب می‌دهد.
        </div>
      )}

      <div className="knowledge-list">
        {items.map((item, index) => (
          <div key={item.id} className="knowledge-row">
            <input
              className="im-input"
              placeholder="سؤال (مثلا: ارسال چند روزه است؟)"
              value={item.question}
              onChange={e =>
                onChange(items.map((it, i) => (i === index ? { ...it, question: e.target.value } : it)))
              }
            />
            <textarea
              className="im-textarea"
              placeholder="جواب دقیق — همین پاسخ با کمترین تغییر ارسال می‌شود"
              value={item.answer}
              onChange={e =>
                onChange(
                  items.map((it, i) => (i === index ? { ...it, answer: e.target.value } : it))
                )
              }
            />
            <div className="knowledge-actions">
              <Toggle
                checked={item.enabled}
                onChange={v =>
                  onChange(items.map((it, i) => (i === index ? { ...it, enabled: v } : it)))
                }
              />
              <button
                className="im-btn small danger"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                حذف
              </button>
            </div>
          </div>
        ))}
      </div>
    </SpotlightCard>
  );
}

function KnowledgeEditor({
  items,
  onChange
}: {
  items: KnowledgeItem[];
  onChange: (items: KnowledgeItem[]) => void;
}) {
  return (
    <SpotlightCard className="im-card spot" spotlightColor="rgba(90,95,105,0.14)" theme="light">
      <div className="im-toolbar-row">
        <div className="im-section-title">
          دانشنامه — تنها فکت‌هایی که دستیار اجازهٔ گفتنش را دارد
        </div>
        <button
          className="im-btn small"
          onClick={() =>
            onChange([
              ...items,
              { id: `${Date.now()}${items.length}`, title: '', content: '', enabled: true }
            ])
          }
        >
          + افزودن
        </button>
      </div>

      {items.length === 0 && (
        <div className="im-empty" style={{ padding: '20px 0' }}>
          خالی است. اگر چیزی ننویسی، دستیار حدس نمی‌زند و می‌گوید «با تیم چک می‌کنم».
        </div>
      )}

      <div className="knowledge-list">
        {items.map((item, index) => (
          <div key={item.id} className="knowledge-row">
            <input
              className="im-input"
              placeholder="عنوان (مثلا: قیمت بالای کتاب)"
              value={item.title}
              onChange={e =>
                onChange(items.map((it, i) => (i === index ? { ...it, title: e.target.value } : it)))
              }
            />
            <textarea
              className="im-textarea"
              placeholder="محتوا — فقط همین متنی را پرواز می‌کند"
              value={item.content}
              onChange={e =>
                onChange(
                  items.map((it, i) => (i === index ? { ...it, content: e.target.value } : it))
                )
              }
            />
            <div className="knowledge-actions">
              <Toggle
                checked={item.enabled}
                onChange={v =>
                  onChange(items.map((it, i) => (i === index ? { ...it, enabled: v } : it)))
                }
              />
              <button
                className="im-btn small danger"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                حذف
              </button>
            </div>
          </div>
        ))}
      </div>
    </SpotlightCard>
  );
}
