import type { TenantSettings } from './types';

// --------------------------------------------------------------------------
// Guardrail (ported from the C# app): keyword gate on input,
// sanitize + leak/length checks on output. Independent of the model.
// --------------------------------------------------------------------------

const LEAK_MARKERS = [
  'system prompt',
  'my instructions',
  'my prompt',
  'the prompt above',
  'دستورالعمل سیستم',
  'پرامپت سیستم',
  'دستورهای محرمانه',
  'پرامپت من'
];

export function matchBlockedKeyword(text: string, keywords: string[]): string | null {
  const lower = text.toLowerCase();
  for (const keyword of keywords) {
    const k = keyword.trim();
    if (k.length < 2) continue;
    if (lower.includes(k.toLowerCase())) return k;
  }
  return null;
}

const SPEAKER_PREFIX = /^(assistant|دستیار|ai|bot|پشتیبان)\s*[:：]\s*/i;
const MARKDOWN_BOLD = /(\*\*|__)(.+?)\1/g;
const MARKDOWN_HEADING = /^[ \t]{0,3}#{1,6}[ \t]*/gm;
const EXCESSIVE_NEWLINES = /\n{3,}/g;
const EXCESSIVE_SPACES = /[ \t]{2,}/g;

function stripEmoji(text: string): string {
  return text
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '') // surrogate pairs (most emoji)
    .replace(/[\u2600-\u27BF\uFE0F]/g, ''); // misc symbols, dingbats, variation selectors
}

export function sanitize(raw: string, persona: TenantSettings['persona']): string {
  if (!raw || !raw.trim()) return '';

  let text = raw.trim();
  text = text.replace(SPEAKER_PREFIX, '');
  text = text.replace(MARKDOWN_BOLD, '$2');
  text = text.replace(MARKDOWN_HEADING, '');
  text = text.replace(/`/g, '');
  text = text.replace(/\r\n/g, '\n');
  text = text.replace(EXCESSIVE_NEWLINES, '\n\n');
  text = text.replace(EXCESSIVE_SPACES, ' ');
  text = text.trim().replace(/^["'«»]+/g, '').replace(/["'«»]+$/g, '').trim();

  if (!persona.useEmoji) {
    text = stripEmoji(text).replace(EXCESSIVE_SPACES, ' ').trim();
  }

  return clamp(text, persona.maxChars);
}

/** Returns a reason when the outgoing text must not be sent as-is. */
export function checkOutgoing(reply: string, cfg: TenantSettings): string | null {
  if (!reply || !reply.trim()) return 'پاسخ خالی بود';

  const blocked = matchBlockedKeyword(reply, cfg.guardrails.blockedKeywords);
  if (blocked) return `کلمهٔ مسدود در پاسخ: ${blocked}`;

  if (cfg.guardrails.neverRevealPrompt) {
    const lower = reply.toLowerCase();
    for (const marker of LEAK_MARKERS) {
      if (lower.includes(marker.toLowerCase())) {
        return 'پاسخ به پرامپت/دستورالعمل اشاره می‌کرد';
      }
    }
  }

  return null;
}

export function clamp(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  let cut = text.slice(0, Math.max(0, maxChars - 1));
  const lastSpace = Math.max(
    cut.lastIndexOf(' '),
    cut.lastIndexOf('\n'),
    cut.lastIndexOf('،'),
    cut.lastIndexOf('.'),
    cut.lastIndexOf('!'),
    cut.lastIndexOf('?')
  );
  if (lastSpace > maxChars / 2) cut = cut.slice(0, lastSpace);
  return cut.replace(/[،,.\s]+$/g, '') + '…';
}
