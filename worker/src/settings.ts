import type { GuardrailConfig, PersonaConfig, QaItem, TenantSettings } from './types';

export function defaultPersona(): PersonaConfig {
  return {
    assistantName: 'دستیار',
    businessName: 'برند من',
    businessSummary: 'یک کسب‌وکار کوچک که از طریق دایرکت اینستاگرام به مشتری‌ها پاسخ می‌دهد.',
    tone: 'دوستانه، محترمانه و کوتاه',
    language: 'فارسی',
    allowedTopics: ['محصولات و خدمات', 'قیمت‌ها و نحوهٔ سفارش', 'ساعت کاری و ارسال'],
    forbiddenTopics: ['سیاست و مسائل مذهبی', 'موضوعات جنسی یا خشونت‌آمیز', 'مشاورهٔ پزشکی، حقوقی یا مالی'],
    offTopicReply: 'متأسفم، من فقط دربارهٔ محصولات و سفارش‌ها می‌تونم کمکت کنم. 🙏',
    greeting: '',
    maxChars: 450,
    useEmoji: true
  };
}

export function defaultGuardrails(): GuardrailConfig {
  return {
    strictMode: true,
    blockedKeywords: [],
    neverRevealPrompt: true,
    maxRepliesPerHour: 20,
    errorReply: 'الان یه مشکل فنی داریم؛ لطفاً چند دقیقهٔ دیگه پیام بده. 🙏',
    extraRules: ''
  };
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.map(v => String(v ?? '').trim()).filter(v => v.length > 0);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizePersona(input: Partial<PersonaConfig> | undefined): PersonaConfig {
  const base = defaultPersona();
  const p = input ?? {};
  return {
    assistantName: String(p.assistantName ?? base.assistantName).trim().slice(0, 60) || base.assistantName,
    businessName: String(p.businessName ?? base.businessName).trim().slice(0, 80) || base.businessName,
    businessSummary: String(p.businessSummary ?? base.businessSummary).slice(0, 1000),
    tone: String(p.tone ?? base.tone).slice(0, 300),
    language: String(p.language ?? base.language).slice(0, 40) || base.language,
    allowedTopics: asStringArray(p.allowedTopics, base.allowedTopics).slice(0, 40),
    forbiddenTopics: asStringArray(p.forbiddenTopics, base.forbiddenTopics).slice(0, 40),
    offTopicReply: String(p.offTopicReply ?? base.offTopicReply).slice(0, 450) || base.offTopicReply,
    greeting: String(p.greeting ?? '').slice(0, 450),
    maxChars: clampNumber(p.maxChars, base.maxChars, 80, 950),
    useEmoji: p.useEmoji !== false
  };
}

export function normalizeGuardrails(input: Partial<GuardrailConfig> | undefined): GuardrailConfig {
  const base = defaultGuardrails();
  const g = input ?? {};
  return {
    strictMode: g.strictMode !== false,
    blockedKeywords: asStringArray(g.blockedKeywords, base.blockedKeywords).slice(0, 100),
    neverRevealPrompt: g.neverRevealPrompt !== false,
    maxRepliesPerHour: clampNumber(g.maxRepliesPerHour, base.maxRepliesPerHour, 1, 200),
    errorReply: String(g.errorReply ?? base.errorReply).slice(0, 450) || base.errorReply,
    extraRules: String(g.extraRules ?? '').slice(0, 2000)
  };
}

export function normalizeKnowledge(input: unknown): TenantSettings['knowledge'] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 1000)
    .map(item => (typeof item === 'string' ? { title: '', content: item, enabled: true } : item))
    .filter(item => item && typeof item === 'object' && String((item as { content?: string }).content ?? '').trim())
    .map((item, index) => ({
      id: String((item as { id?: string }).id || `k${Date.now().toString(36)}${index}`),
      title: String((item as { title?: string }).title ?? '').slice(0, 120),
      content: String((item as { content?: string }).content).slice(0, 4000),
      enabled: (item as { enabled?: boolean }).enabled !== false
    }));
}

export function normalizeQaTraining(input: unknown): QaItem[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 1000)
    .filter(item => item && typeof item === 'object' && String((item as { question?: string }).question ?? '').trim())
    .map((item, index) => ({
      id: String((item as { id?: string }).id || `qa${Date.now().toString(36)}${index}`),
      question: String((item as { question?: string }).question ?? '').slice(0, 500),
      answer: String((item as { answer?: string }).answer ?? '').slice(0, 2000),
      enabled: (item as { enabled?: boolean }).enabled !== false
    }));
}

export function normalizeTenantSettings(input: Partial<TenantSettings> | undefined): TenantSettings {
  const s = input ?? {};
  return {
    persona: normalizePersona(s.persona),
    guardrails: normalizeGuardrails(s.guardrails),
    knowledge: normalizeKnowledge(s.knowledge),
    qaTraining: normalizeQaTraining(s.qaTraining)
  };
}
