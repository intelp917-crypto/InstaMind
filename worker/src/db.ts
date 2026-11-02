import type { Env, AiProviderConfig, MetaAppConfig, TenantRow, ConversationRow, MessageRow, Direction } from './types';
import { defaultTenantSettings } from './tenant';
import { sealJson, openJson, uid } from './crypto';

// --------------------------------------------------------------------------
// D1 access layer. Schema is created lazily, once per isolate.
// --------------------------------------------------------------------------

let schemaPromise: Promise<void> | null = null;

export function ensureSchema(env: Env): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        ig_user_id TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL DEFAULT '',
        token_encrypted TEXT NOT NULL,
        token_expires_at INTEGER,
        subscribed INTEGER NOT NULL DEFAULT 0,
        auto_reply INTEGER NOT NULL DEFAULT 1,
        daily_reply_limit INTEGER NOT NULL DEFAULT 0,
        usage_date TEXT,
        replies_today INTEGER NOT NULL DEFAULT 0,
        tokens_today INTEGER NOT NULL DEFAULT 0,
        tokens_total INTEGER NOT NULL DEFAULT 0,
        replies_total INTEGER NOT NULL DEFAULT 0,
        settings_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        last_login_at INTEGER NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        username TEXT NOT NULL DEFAULT '',
        ai_paused INTEGER NOT NULL DEFAULT 0,
        last_message_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (tenant_id, sender_id)
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages (conversation_id, created_at)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_conversations_tenant
        ON conversations (tenant_id, last_message_at)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      )`)
    ]).then(() => undefined);
    schemaPromise.catch(() => {
      schemaPromise = null;
    });
  }
  return schemaPromise;
}

// --------------------------------------------------------------------------
// app_meta (single row each)
// --------------------------------------------------------------------------

const KEY_META = 'meta_app';
const KEY_PROVIDER = 'ai_provider';

export interface StoredMetaApp extends MetaAppConfig {}

export async function getMetaApp(env: Env): Promise<StoredMetaApp | null> {
  const row = await env.DB.prepare('SELECT value FROM app_meta WHERE key = ?').bind(KEY_META).first<{ value: string }>();
  if (!row) return null;
  return openJson<StoredMetaApp>(env, row.value);
}

export async function setMetaApp(env: Env, value: StoredMetaApp): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  )
    .bind(KEY_META, await sealJson(env, value), Date.now())
    .run();
}

export async function getProvider(env: Env): Promise<AiProviderConfig | null> {
  const row = await env.DB.prepare('SELECT value FROM app_meta WHERE key = ?').bind(KEY_PROVIDER).first<{ value: string }>();
  if (!row) return null;
  return openJson<AiProviderConfig>(env, row.value);
}

export async function setProvider(env: Env, value: AiProviderConfig): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  )
    .bind(KEY_PROVIDER, await sealJson(env, value), Date.now())
    .run();
}

// --------------------------------------------------------------------------
// OAuth states
// --------------------------------------------------------------------------

export async function putOAuthState(env: Env, state: string): Promise<void> {
  await env.DB.prepare('INSERT INTO oauth_states (state, created_at) VALUES (?, ?)').bind(state, Date.now()).run();
  // opportunistic cleanup of states older than 30 minutes
  await env.DB.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(Date.now() - 30 * 60_000).run();
}

export async function consumeOAuthState(env: Env, state: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT state FROM oauth_states WHERE state = ?').bind(state).first();
  if (!row) return false;
  await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
  return true;
}

// --------------------------------------------------------------------------
// Tenants
// --------------------------------------------------------------------------

export async function findTenantByIgId(env: Env, igUserId: string): Promise<TenantRow | null> {
  const row = await env.DB.prepare('SELECT * FROM tenants WHERE ig_user_id = ?').bind(igUserId).first<TenantRow>();
  return row ?? null;
}

export async function findTenantById(env: Env, id: string): Promise<TenantRow | null> {
  const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first<TenantRow>();
  return row ?? null;
}

export interface UpsertTenantInput {
  igUserId: string;
  username: string;
  tokenEncrypted: string;
  tokenExpiresAt: number | null;
  subscribed: boolean;
}

/** One tenant per Instagram account. Re-connects refresh token + username. */
export async function upsertTenant(env: Env, input: UpsertTenantInput): Promise<TenantRow | null> {
  const now = Date.now();
  const existing = await findTenantByIgId(env, input.igUserId);
  if (existing) {
    await env.DB.prepare(
      `UPDATE tenants SET username = ?, token_encrypted = ?, token_expires_at = ?, subscribed = ?, last_login_at = ?
       WHERE id = ?`
    )
      .bind(input.username, input.tokenEncrypted, input.tokenExpiresAt, input.subscribed ? 1 : 0, now, existing.id)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO tenants
         (id, ig_user_id, username, token_encrypted, token_expires_at, subscribed, auto_reply, daily_reply_limit,
          usage_date, replies_today, tokens_today, tokens_total, replies_total, settings_json, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, '', 0, 0, 0, 0, ?, ?, ?)`
    )
      .bind(
        uid(),
        input.igUserId,
        input.username,
        input.tokenEncrypted,
        input.tokenExpiresAt,
        input.subscribed ? 1 : 0,
        JSON.stringify(defaultTenantSettings()),
        now,
        now
      )
      .run();
  }
  return findTenantByIgId(env, input.igUserId);
}

export async function listTenants(env: Env): Promise<TenantRow[]> {
  const { results } = await env.DB.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all<TenantRow>();
  return results;
}

export async function updateTenantSettingsJson(env: Env, tenantId: string, settingsJson: string): Promise<void> {
  await env.DB.prepare('UPDATE tenants SET settings_json = ? WHERE id = ?').bind(settingsJson, tenantId).run();
}

export async function setTenantAutoReply(env: Env, tenantId: string, enabled: boolean): Promise<void> {
  await env.DB.prepare('UPDATE tenants SET auto_reply = ? WHERE id = ?').bind(enabled ? 1 : 0, tenantId).run();
}

export async function recordTenantReply(env: Env, tenantId: string, tokens: number, dayKey: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE tenants SET
       replies_today = CASE WHEN usage_date = ? THEN replies_today + 1 ELSE 1 END,
       tokens_today = CASE WHEN usage_date = ? THEN tokens_today + ? ELSE ? END,
       tokens_total = tokens_total + ?,
       replies_total = replies_total + 1,
       usage_date = ?
     WHERE id = ?`
  )
    .bind(dayKey, dayKey, tokens, tokens, tokens, dayKey, tenantId)
    .run();
}

export async function deleteTenant(env: Env, tenantId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM messages WHERE tenant_id = ?').bind(tenantId),
    env.DB.prepare('DELETE FROM conversations WHERE tenant_id = ?').bind(tenantId),
    env.DB.prepare('DELETE FROM tenants WHERE id = ?').bind(tenantId)
  ]);
}

// --------------------------------------------------------------------------
// Conversations & messages
// --------------------------------------------------------------------------

export async function findConversation(env: Env, tenantId: string, senderId: string): Promise<ConversationRow | null> {
  const row = await env.DB.prepare(
    'SELECT * FROM conversations WHERE tenant_id = ? AND sender_id = ?'
  )
    .bind(tenantId, senderId)
    .first<ConversationRow>();
  return row ?? null;
}

export async function upsertConversation(env: Env, tenantId: string, senderId: string, username: string): Promise<ConversationRow | null> {
  const existing = await findConversation(env, tenantId, senderId);
  const now = Date.now();
  if (existing) {
    const wantsRename = username && username !== existing.username;
    await env.DB.prepare(
      `UPDATE conversations SET last_message_at = ?${wantsRename ? ', username = ?' : ''} WHERE id = ?`
    )
      .bind(wantsRename ? [now, username, existing.id] : [now, existing.id])
      .run();
  } else {
    await env.DB.prepare(
      'INSERT INTO conversations (id, tenant_id, sender_id, username, ai_paused, last_message_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
    )
      .bind(uid(), tenantId, senderId, username, now, now)
      .run();
  }
  return findConversation(env, tenantId, senderId);
}

export async function insertMessage(
  env: Env,
  tenantId: string,
  conversationId: string,
  direction: Direction,
  author: string,
  text: string,
  status: string
): Promise<MessageRow> {
  const row: MessageRow = {
    id: uid(),
    conversation_id: conversationId,
    tenant_id: tenantId,
    direction,
    author,
    text,
    status,
    created_at: Date.now()
  };
  await env.DB.prepare(
    'INSERT INTO messages (id, conversation_id, tenant_id, direction, author, text, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(row.id, conversationId, tenantId, direction, author, text, status, row.created_at)
    .run();
  return row;
}

export async function listConversations(env: Env, tenantId: string): Promise<Array<ConversationRow & { last_text: string; last_direction: string; last_author: string; last_status: string; message_count: number }>> {
  const rows = await env.DB.prepare(
    `SELECT c.*, m.text AS last_text, m.direction AS last_direction, m.author AS last_author, m.status AS last_status
     FROM conversations c
     LEFT JOIN messages m ON m.rowid = (
       SELECT rowid FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
     )
     WHERE c.tenant_id = ?
     ORDER BY c.last_message_at DESC
     LIMIT 200`
  )
    .bind(tenantId)
    .all<ConversationRow & { last_text: string | null; last_direction: string | null; last_author: string | null; last_status: string | null }>();
  const counts = new Map(
    (
      await env.DB.prepare(
        'SELECT conversation_id, COUNT(*) AS count FROM messages WHERE tenant_id = ? GROUP BY conversation_id'
      )
        .bind(tenantId)
        .all<{ conversation_id: string; count: number }>()
    ).results.map(r => [r.conversation_id, r.count])
  );
  return rows.results.map(r => ({
    ...r,
    last_text: r.last_text ?? '',
    last_direction: r.last_direction ?? 'in',
    last_author: r.last_author ?? '',
    last_status: r.last_status ?? '',
    message_count: counts.get(r.id) ?? 0
  }));
}

export async function getConversation(env: Env, tenantId: string, conversationId: string): Promise<ConversationRow | null> {
  const row = await env.DB.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?')
    .bind(conversationId, tenantId)
    .first<ConversationRow>();
  return row ?? null;
}

export async function listMessages(env: Env, conversationId: string, limit = 100): Promise<MessageRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?'
  )
    .bind(conversationId, limit)
    .all<MessageRow>();
  return results;
}

export async function countAiRepliesLastHour(env: Env, tenantId: string, senderId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM messages
     WHERE tenant_id = ? AND direction = 'out' AND author = 'ai' AND created_at > ?
     AND conversation_id IN (SELECT id FROM conversations WHERE tenant_id = ? AND sender_id = ?)`
  )
    .bind(tenantId, Date.now() - 3600_000, tenantId, senderId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function recentHistory(env: Env, conversationId: string, limit = 10): Promise<MessageRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC'
  )
    .bind(conversationId, limit)
    .all<MessageRow>();
  return results;
}

export async function deleteConversation(env: Env, tenantId: string, conversationId: string): Promise<boolean> {
  const convo = await getConversation(env, tenantId, conversationId);
  if (!convo) return false;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(conversationId),
    env.DB.prepare('DELETE FROM conversations WHERE id = ?').bind(conversationId)
  ]);
  return true;
}

export async function clearConversations(env: Env, tenantId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM messages WHERE tenant_id = ?').bind(tenantId),
    env.DB.prepare('DELETE FROM conversations WHERE tenant_id = ?').bind(tenantId)
  ]);
}

export async function setPaused(env: Env, tenantId: string, conversationId: string, paused: boolean): Promise<boolean> {
  const result = await env.DB.prepare('UPDATE conversations SET ai_paused = ? WHERE id = ? AND tenant_id = ?')
    .bind(paused ? 1 : 0, conversationId, tenantId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

// Global stats for the admin panel.
export interface GlobalStats {
  tenantCount: number;
  conversationCount: number;
  messageCount: number;
  aiReplyCount: number;
}

export async function globalStats(env: Env): Promise<GlobalStats> {
  const [conversations, messages] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM conversations').first<{ n: number }>(),
    env.DB.prepare(`SELECT
        COUNT(*) AS n,
        SUM(CASE WHEN direction = 'out' AND author = 'ai' THEN 1 ELSE 0 END) AS aiReplies
      FROM messages`).first<{ n: number; aiReplies: number | null }>()
  ]);
  const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM tenants').all<{ n: number }>();
  return {
    tenantCount: results[0]?.n ?? 0,
    conversationCount: conversations?.n ?? 0,
    messageCount: messages?.n ?? 0,
    aiReplyCount: messages?.aiReplies ?? 0
  };
}
