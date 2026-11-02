import type { Env, AiProviderConfig, MetaAppConfig, SubscriptionOrderRow, TenantRow, UserRow, ConversationRow, MessageRow, Direction } from './types';
import { defaultTenantSettings } from './tenant';
import { planById } from './plans';
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
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL DEFAULT '',
        password_hash TEXT,
        google_sub TEXT UNIQUE,
        avatar_url TEXT NOT NULL DEFAULT '',
        plan_id TEXT,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS subscription_orders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        period TEXT NOT NULL DEFAULT 'monthly',
        amount INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        decided_at INTEGER
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_user ON subscription_orders (user_id, created_at)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_users_google ON users (google_sub)`)
    ]).then(() => undefined);
    schemaPromise    .then(async () => {
      // opportunistic migration for databases created before account linking
      await linkTenantsColumn(env);
    })
    .catch(() => {
      schemaPromise = null;
    });
  }
  return schemaPromise;
}

let linkTenantsPromise: Promise<void> | null = null;

function linkTenantsColumn(env: Env): Promise<void> {
  linkTenantsPromise ??= env.DB.prepare('ALTER TABLE tenants ADD COLUMN user_id TEXT')
    .run()
    .then(() => undefined)
    .catch(() => undefined); // column already exists
  return linkTenantsPromise;
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
  /** Account (Google/email) to link this Instagram page to, when set. */
  userId?: string | null;
}

/** One tenant per Instagram account. Re-connects refresh token + username. */
export async function upsertTenant(env: Env, input: UpsertTenantInput): Promise<TenantRow | null> {
  const now = Date.now();
  const existing = await findTenantByIgId(env, input.igUserId);
  if (existing) {
    await env.DB.prepare(
      `UPDATE tenants SET username = ?, token_encrypted = ?, token_expires_at = ?, subscribed = ?, user_id = ?, last_login_at = ?
       WHERE id = ?`
    )
      .bind(
        input.username,
        input.tokenEncrypted,
        input.tokenExpiresAt,
        input.subscribed ? 1 : 0,
        input.userId ?? existing.user_id,
        now,
        existing.id
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO tenants
         (id, ig_user_id, username, token_encrypted, token_expires_at, subscribed, user_id, auto_reply, daily_reply_limit,
          usage_date, replies_today, tokens_today, tokens_total, replies_total, settings_json, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, '', 0, 0, 0, 0, ?, ?, ?)`
    )
      .bind(
        uid(),
        input.igUserId,
        input.username,
        input.tokenEncrypted,
        input.tokenExpiresAt,
        input.subscribed ? 1 : 0,
        input.userId ?? null,
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

// --------------------------------------------------------------------------
// Accounts (Google / email-password users)
// --------------------------------------------------------------------------

export async function findUserByEmail(env: Env, email: string): Promise<UserRow | null> {
  const row = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  return row ?? null;
}

export async function findUserByGoogleSub(env: Env, googleSub: string): Promise<UserRow | null> {
  const row = await env.DB.prepare('SELECT * FROM users WHERE google_sub = ?').bind(googleSub).first<UserRow>();
  return row ?? null;
}

export async function findUserById(env: Env, id: string): Promise<UserRow | null> {
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  return row ?? null;
}

export interface UpsertUserInput {
  email: string;
  name: string;
  passwordHash: string | null;
  googleSub: string | null;
  avatarUrl: string;
}

/** One account per email; Google sign-in attaches itself to the same email. */
export async function upsertAccount(env: Env, input: UpsertUserInput): Promise<UserRow> {
  const now = Date.now();
  const existing = await findUserByEmail(env, input.email);
  if (existing) {
    const googleSub = input.googleSub ?? existing.google_sub;
    const name = input.name.trim() || existing.name;
    const avatarUrl = input.avatarUrl || existing.avatar_url;
    await env.DB.prepare(
      'UPDATE users SET google_sub = ?, name = ?, avatar_url = ?, last_login_at = ? WHERE id = ?'
    )
      .bind(googleSub, name, avatarUrl, now, existing.id)
      .run();
  } else {
    await env.DB.prepare(
      'INSERT INTO users (id, email, name, password_hash, google_sub, avatar_url, plan_id, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)'
    )
      .bind(uid(), input.email, input.name, input.passwordHash, input.googleSub, input.avatarUrl, now, now)
      .run();
  }
  const user = (input.googleSub ? await findUserByGoogleSub(env, input.googleSub) : null) ?? (await findUserByEmail(env, input.email));
  if (!user) throw new Error('user-upsert-failed');
  return user;
}

export async function setUserPassword(env: Env, userId: string, passwordHash: string): Promise<void> {
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, userId).run();
}

export async function countTenantsOfUser(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM tenants WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Active plan of an account (via users.plan_id) or null when none. */
export async function userPlanPlanId(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT plan_id FROM users WHERE id = ?').bind(userId).first<{ plan_id: string | null }>();
  return row?.plan_id ?? null;
}

export async function tenantOfUser(env: Env, userId: string): Promise<TenantRow | null> {
  const row = await env.DB.prepare('SELECT * FROM tenants WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(userId)
    .first<TenantRow>();
  return row ?? null;
}

// --------------------------------------------------------------------------
// Subscription orders
// --------------------------------------------------------------------------

export async function createOrder(env: Env, userId: string, planId: string): Promise<SubscriptionOrderRow> {
  const plan = planById(planId);
  if (!plan) throw new Error('unknown-plan');
  const now = Date.now();
  const row: SubscriptionOrderRow = {
    id: uid(),
    user_id: userId,
    plan_id: plan.id,
    status: 'pending',
    period: 'monthly',
    amount: plan.monthlyPrice,
    created_at: now,
    decided_at: null
  };
  await env.DB.prepare(
    'INSERT INTO subscription_orders (id, user_id, plan_id, status, period, amount, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(row.id, row.user_id, row.plan_id, row.status, row.period, row.amount, row.created_at, row.decided_at)
    .run();
  return row;
}

export async function findPendingOrder(env: Env, userId: string, planId: string): Promise<SubscriptionOrderRow | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM subscription_orders WHERE user_id = ? AND plan_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
  )
    .bind(userId, planId)
    .first<SubscriptionOrderRow>();
  return row ?? null;
}

export async function getOrder(env: Env, orderId: string): Promise<SubscriptionOrderRow | null> {
  const row = await env.DB.prepare('SELECT * FROM subscription_orders WHERE id = ?').bind(orderId).first<SubscriptionOrderRow>();
  return row ?? null;
}

export async function listOrdersOfUser(env: Env, userId: string): Promise<SubscriptionOrderRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM subscription_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  )
    .bind(userId)
    .all<SubscriptionOrderRow>();
  return results;
}

export interface OrderWithMeta extends SubscriptionOrderRow {
  user_email: string | null;
  user_name: string | null;
}

export async function listAllOrders(env: Env): Promise<OrderWithMeta[]> {
  const { results } = await env.DB.prepare(
    `SELECT o.*, u.email AS user_email, u.name AS user_name
     FROM subscription_orders o LEFT JOIN users u ON u.id = o.user_id
     ORDER BY o.created_at DESC LIMIT 200`
  ).all<OrderWithMeta>();
  return results;
}

/** Approve/reject an order. Approving sets the user's plan and applies plan limits to the linked Instagram page. */
export async function decideOrder(env: Env, orderId: string, status: 'active' | 'rejected'): Promise<SubscriptionOrderRow | null> {
  const order = await getOrder(env, orderId);
  if (!order) return null;
  if (order.status !== 'pending') return order;
  await env.DB.prepare('UPDATE subscription_orders SET status = ?, decided_at = ? WHERE id = ?')
    .bind(status, Date.now(), orderId)
    .run();
  if (status === 'active') {
    const plan = planById(order.plan_id);
    await env.DB.prepare('UPDATE users SET plan_id = ? WHERE id = ?').bind(order.plan_id, order.user_id).run();
    if (plan) {
      // Applies plan limits to the linked Instagram pages. The `subscribed` flag
      // stays untouched: it means "Meta webhook subscription", not plan state.
      await env.DB.prepare(
        'UPDATE tenants SET daily_reply_limit = ? WHERE user_id = ?'
      )
        .bind(plan.dailyReplies, order.user_id)
        .run();
    }
  }
  return getOrder(env, orderId);
}

/** Only pending orders owned by the user can be cancelled. */
export async function cancelPendingOrder(env: Env, userId: string, orderId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE subscription_orders SET status = 'cancelled', decided_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'"
  )
    .bind(Date.now(), orderId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
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
