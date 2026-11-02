import type { Env, TenantRow } from './types';
import type { AiProviderConfig } from './types';
import { generateReply, type AiMessage } from './ai';
import * as db from './db';
import { parseTenantSettings } from './tenant';
import { sendDirectMessage } from './instagram';
import { todayTehran } from './crypto';

// --------------------------------------------------------------------------
// Webhook message processing: Meta needs a fast 200, so the AI pipeline runs
// in waitUntil. This module is the heart of the SaaS reply engine.
// --------------------------------------------------------------------------

export interface ParsedMessage {
  senderId: string;
  username: string;
  text: string;
  messageId: string | null;
  entryPageId: string | null;
}

export function parseWebhookMessages(raw: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  let doc: {
    entry?: Array<{
      id?: string;
      messaging?: Array<{
        message?: { text?: string; mid?: string; is_echo?: boolean };
        sender?: { id?: string; username?: string };
      }>;
    }>;
  };
  try {
    doc = JSON.parse(raw);
  } catch {
    return messages; // malformed payload: Meta gets its 200 and stops retrying
  }

  const entries = doc?.entry ?? [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const entryPageId = typeof entry?.id === 'string' ? entry.id : null;
    const events = entry?.messaging ?? [];
    for (const evt of events) {
      const message = evt.message;
      if (!message || message.is_echo === true) continue;
      const text = (message.text ?? '').trim();
      if (!text) continue;
      const senderId = evt.sender?.id;
      if (!senderId) continue;
      messages.push({
        senderId,
        username: evt.sender?.username ?? '',
        text,
        messageId: message.mid ?? null,
        entryPageId
      });
    }
  }
  return messages;
}

async function processMessage(env: Env, message: ParsedMessage): Promise<void> {
  // Resolve the tenant by the instagram id the event arrived for.
  const tenant = message.entryPageId ? await db.findTenantByIgId(env, message.entryPageId) : null;
  if (!tenant) return; // unknown account — ignore silently

  const settings = parseTenantSettings(tenant.settings_json);
  const conversation = await db.upsertConversation(env, tenant.id, message.senderId, message.username);
  if (!conversation) return;

  // Always persist the incoming message, even when we do not reply.
  await db.insertMessage(env, tenant.id, conversation.id, 'in', message.senderId, message.text, '');

  // ---- decide whether to reply at all ------------------------------------
  if (!tenant.auto_reply) return;
  if (conversation.ai_paused) return;

  // Daily limit for this tenant (0 = no cap).
  const dayKey = todayTehran();
  const usedToday = tenant.usage_date === dayKey ? tenant.replies_today : 0;
  if (tenant.daily_reply_limit > 0 && usedToday >= tenant.daily_reply_limit) {
    await db.insertMessage(env, tenant.id, conversation.id, 'out', 'system', '', 'blocked:سقف روزانهٔ پاسخ پر شده است');
    return;
  }

  // Rolling hourly cap per conversation (guardrail layer 0).
  const perHour = settings.guardrails.maxRepliesPerHour;
  const aiRepliesLastHour = perHour > 0 ? await db.countAiRepliesLastHour(env, tenant.id, message.senderId) : 0;
  if (perHour > 0 && aiRepliesLastHour >= perHour) {
    await db.insertMessage(env, tenant.id, conversation.id, 'out', 'system', '', 'blocked:محدودیت نرخ ساعتی');
    return;
  }

  // Token expired?
  if (tenant.token_expires_at && tenant.token_expires_at < Date.now()) {
    await db.insertMessage(env, tenant.id, conversation.id, 'out', 'system', '', 'blocked:توکن منقضی شده — دوباره وارد شوید');
    return;
  }

  const provider = await db.getProvider(env);
  if (!provider) {
    await db.insertMessage(env, tenant.id, conversation.id, 'out', 'system', '', 'blocked:سرویس هوش مصنوعی تنظیم نشده است');
    return;
  }

  // Paywall: accounts (Google/email) must hold an active plan. Instagram-only
  // tenants created before the account system keep working unchanged.
  const planId = tenant.user_id ? await db.userPlanPlanId(env, tenant.user_id) : 'legacy';
  if (planId === null) {
    await db.insertMessage(env, tenant.id, conversation.id, 'out', 'system', '', 'blocked:برای پاسخ هوشمند، اشتراک فعال لازم است');
    return;
  }
  void planId;

  // ---- guardrail + AI pipeline --------------------------------------------
  const history: AiMessage[] = (await db.recentHistory(env, conversation.id, 10))
    .filter(m => m.text)
    .map(m => ({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.text }));

  let outcome;
  try {
    outcome = await generateReply(provider, settings, history, message.text);
  } catch (error) {
    outcome = {
      sent: true,
      blocked: true,
      reason: error instanceof Error ? error.message.slice(0, 200) : 'خطای ناشناخته در موتور پاسخ',
      reply: settings.guardrails.errorReply,
      tokens: 0,
      stage: 'error'
    };
  }

  // ---- deliver -------------------------------------------------------------
  const token = await getTenantToken(env, tenant);
  const send = await sendDirectMessage(env, token, tenant.ig_user_id, message.senderId, outcome.reply);

  if (!send.ok && send.error) {
    console.error('send failed:', send.error);
  }

  await db.insertMessage(
    env,
    tenant.id,
    conversation.id,
    'out',
    outcome.blocked ? 'fallback' : 'ai',
    send.ok ? outcome.reply : '',
    send.ok ? (outcome.blocked ? `fallback:${outcome.reason ?? ''}` : `ai${outcome.tokens ? `:${outcome.tokens}t` : ''}`) : `failed:${(send.error ?? 'خطای نامشخص').slice(0, 200)}`
  );

  if (send.ok) {
    await db.recordTenantReply(env, tenant.id, outcome.tokens, dayKey);
  }
}

export async function getTenantToken(env: Env, tenant: TenantRow): Promise<string> {
  const { openJson } = await import('./crypto');
  try {
    const stored = await openJson<{ token: string }>(env, tenant.token_encrypted);
    return stored.token;
  } catch {
    return '';
  }
}

/** Entry point from the webhook route (runs inside waitUntil). */
export async function handleIncomingWebhook(env: Env, raw: string): Promise<void> {
  const messages = parseWebhookMessages(raw);
  for (const message of messages) {
    try {
      await processMessage(env, message);
    } catch (error) {
      console.error('Failed to handle DM:', error instanceof Error ? error.message : error);
    }
  }
}

export type { AiProviderConfig };
