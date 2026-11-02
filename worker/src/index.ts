import { Hono } from 'hono';
import type { AiProviderConfig, Env, TenantSettings } from './types';
import type { AppEnv } from './sessions';
import * as db from './db';
import { parseTenantSettings } from './tenant';
import { normalizeTenantSettings } from './settings';
import {
  clearAdminSession,
  clearTenantSession,
  createAdminSession,
  createTenantSession,
  readAdminSession,
  readTenantSession
} from './sessions';
import {
  buildAuthorizeUrl,
  completeOAuth,
  refreshToken,
  resolveRedirectUri,
  sendDirectMessage,
  testPageToken
} from './instagram';
import { openJson, sealJson, sha256Hex, randomToken, timingSafeHashEquals, todayTehran } from './crypto';
import { handleIncomingWebhook, parseWebhookMessages, getTenantToken } from './webhook';
import { generateReply } from './ai';
import { buildSystemPrompt } from './prompt';

const app = new Hono<AppEnv>();

// Boot: create the schema once per isolate.
app.use('*', async (c, next) => {
  await db.ensureSchema(c.env);
  await next();
});

// Static SPA assets ------------------------------------------------------
app.get('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/') || path.startsWith('/oauth/') || path.startsWith('/webhook/')) {
    return next();
  }
  const asset = await c.env.ASSETS.fetch(new URL(path, c.req.url));
  if (asset.status !== 404) return asset;
  return c.env.ASSETS.fetch(new URL('/index.html', c.req.url));
});

function originOf(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

function todayKey(): string {
  return todayTehran();
}

// ---------------------------------------------------------------------
// @@@ PUBLIC
// ---------------------------------------------------------------------

app.get('/api/health', c => c.json({ ok: true, at: new Date().toISOString() }));

app.get('/api/setup/status', async c => {
  const [meta, provider] = await Promise.all([db.getMetaApp(c.env), db.getProvider(c.env)]);
  const tenants = await db.listTenants(c.env);
  const envProvider = envProviderFrom(c.env);
  return c.json({
    metaConfigured: Boolean(meta?.appId),
    providerConfigured: Boolean(provider?.apiKey || envProvider?.apiKey),
    environmentProviderPresent: Boolean(envProvider?.apiKey),
    tenantCount: tenants.length,
    redirectUri: meta ? resolveRedirectUri(originOf(c), meta.redirectUri) : null
  });
});

// ---------------------------------------------------------------------
// @@@ ADMIN AUTH — one owner secret key
// ---------------------------------------------------------------------

app.post('/api/admin/login', async c => {
  const body = (await c.req.json().catch(() => ({}))) as { key?: string };
  const provided = (body.key ?? '').trim();
  if (!provided) return c.json({ ok: false, error: 'کلید را وارد کنید.' }, 400);

  const adminKey = c.env.ADMIN_KEY;
  if (!adminKey) return c.json({ ok: false, error: 'کلید مدیر روی سرور تنظیم نشده است (ADMIN_KEY).' }, 500);

  if (!(await timingSafeHashEquals(provided, await sha256Hex(adminKey)))) {
    return c.json({ ok: false, error: 'کلید اشتباه است.' }, 401);
  }
  await createAdminSession(c);
  return c.json({ ok: true });
});

app.post('/api/admin/logout', async c => {
  await clearAdminSession(c);
  return c.json({ ok: true });
});

app.get('/api/admin/session', async c => {
  const session = await readAdminSession(c);
  return c.json({ ok: Boolean(session) });
});

// Everything under /api/admin/* but /login requires an admin session.
app.use('/api/admin/*', async (c, next) => {
  if (c.req.path === '/api/admin/login') return next();
  const session = await readAdminSession(c);
  if (!session) return c.json({ ok: false, error: 'دسترسی مدیر لازم است.' }, 401);
  await next();
});

// ---------------------------------------------------------------------
// @@@ ADMIN: Meta app + AI provider (the two one-time setups)
// ---------------------------------------------------------------------

app.get('/api/admin/meta', async c => {
  const meta = await db.getMetaApp(c.env);
  if (!meta) return c.json({ ok: true, meta: null });
  const appSecret = await metaAppSecretOf(c.env, meta.appSecretEncrypted);
  return c.json({
    ok: true,
    meta: appSecret
      ? configuredMeta(c, meta.appId, mask(appSecret), meta.verifyToken, meta.redirectUri)
      : configuredMeta(c, meta.appId, '', meta.verifyToken, meta.redirectUri)
  });
});

function configuredMeta(
  c: { req: { url: string } },
  appId: string,
  appSecret: string,
  verifyToken: string,
  redirectUri: string
) {
  return {
    appId,
    appSecret,
    verifyToken,
    redirectUri,
    webhookUrl: `${originOf(c).replace(/\/+$/, '')}/webhook/instagram`,
    generatedRedirectUri: resolveRedirectUri(originOf(c), redirectUri)
  };
}

function mask(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 6) return '••••••';
  return secret.slice(0, 3) + '•'.repeat(Math.max(4, secret.length - 6)) + secret.slice(-3);
}

async function metaAppSecretOf(env: Env, encrypted: string): Promise<string> {
  try {
    const sealed = await openJson<{ secret: string }>(env, encrypted);
    return sealed.secret;
  } catch {
    return '';
  }
}

app.put('/api/admin/meta', async c => {
  const body = (await c.req.json().catch(() => ({}))) as {
    appId?: string;
    appSecret?: string;
    verifyToken?: string;
    redirectUri?: string;
  };
  const appId = (body.appId ?? '').trim();
  const appSecret = (body.appSecret ?? '').trim();
  const existing = await db.getMetaApp(c.env);

  if (!appId) return c.json({ ok: false, error: 'App ID را وارد کنید.' }, 400);
  if (!existing && !appSecret) return c.json({ ok: false, error: 'App Secret را وارد کنید.' }, 400);

  let appSecretEncrypted: string;
  if (appSecret) {
    appSecretEncrypted = await sealJson(c.env, { secret: appSecret });
  } else {
    if (!(await metaAppSecretOf(c.env, existing!.appSecretEncrypted))) {
      return c.json({ ok: false, error: 'رمز ذخیره‌شده قابل خواندن نیست؛ App Secret را دوباره وارد کنید.' }, 400);
    }
    appSecretEncrypted = existing!.appSecretEncrypted;
  }

  const verifyToken = (body.verifyToken ?? '').trim() || existing?.verifyToken || `im-${randomToken(9)}`;
  const redirectUri = (body.redirectUri ?? '').trim();

  await db.setMetaApp(c.env, { appId, appSecretEncrypted, verifyToken, redirectUri });
  return c.json({ ok: true });
});

app.get('/api/admin/provider', async c => {
  const provider = await db.getProvider(c.env);
  const envProvider = envProviderFrom(c.env);
  if (provider) {
    return c.json({
      ok: true,
      provider: { ...provider, apiKey: mask(provider.apiKey) },
      source: 'panel'
    });
  }
  if (envProvider) {
    return c.json({ ok: true, provider: { ...envProvider, apiKey: mask(envProvider.apiKey) }, source: 'env' });
  }
  return c.json({ ok: true, provider: null, source: null });
});

app.put('/api/admin/provider', async c => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<AiProviderConfig> & { apiKey?: string };
  const apiKey = (body.apiKey ?? '').trim();
  const baseUrl = (body.baseUrl ?? '').trim() || 'https://api.openai.com/v1';
  const model = (body.model ?? '').trim() || 'gpt-4o-mini';
  const existing = await db.getProvider(c.env);

  const finalKey = apiKey || (await db.getProvider(c.env))?.apiKey || envProviderFrom(c.env)?.apiKey || '';
  if (!finalKey) {
    return c.json({ ok: false, error: 'API Key را وارد کنید (یا متغیر OPENAI_API_KEY را روی سرور بدهید).' }, 400);
  }

  const provider: AiProviderConfig = {
    name: (body.name ?? '').trim() || existing?.name || 'سرویس هوش مصنوعی',
    baseUrl,
    model,
    temperature: clampNumber(body.temperature ?? existing?.temperature ?? 0.5, 0, 2),
    maxTokens: Math.round(clampNumber(body.maxTokens ?? existing?.maxTokens ?? 400, 20, 2000)),
    timeoutSeconds: Math.round(clampNumber(body.timeoutSeconds ?? existing?.timeoutSeconds ?? 45, 5, 120)),
    scopeCheckEnabled: body.scopeCheckEnabled !== false,
    scopeCheckModel: (body.scopeCheckModel ?? '').trim(),
    apiKey: finalKey
  };
  await db.setProvider(c.env, provider);
  return c.json({ ok: true });
});

app.post('/api/admin/provider/test', async c => {
  let provider = await db.getProvider(c.env);
  provider ??= envProviderFrom(c.env);
  if (!provider?.apiKey) return c.json({ ok: false, message: 'کلید سرویس هوش مصنوعی تنظیم نشده است.' });
  if (!provider) return c.json({ ok: false, message: 'کلید سرویس هوش مصنوعی تنظیم نشده است.' });

  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  const result = await generateReply(provider, testSettings(), [], body.text ?? 'سلام!');
  return c.json({
    ok: !result.blocked && Boolean(result.reply),
    message: result.blocked ? `مسدود شد: ${result.reason ?? ''}` : result.reply,
    tokens: result.tokens
  });
});

function testSettings(): TenantSettings {
  return normalizeTenantSettings({
    persona: {
      assistantName: 'دستیار تست',
      businessName: 'InstaMind',
      businessSummary: '',
      tone: 'دوستانه و کوتاه',
      language: 'فارسی',
      allowedTopics: ['سلام و احوالپرسی', 'آزمایش اتصال'],
      forbiddenTopics: [],
      offTopicReply: 'سؤال شما ارتباطی با موضوعات بازداشت ما ندارد.',
      greeting: '',
      maxChars: 200,
      useEmoji: false
    },
    guardrails: { strictMode: false, neverRevealPrompt: true, maxRepliesPerHour: 20, blockedKeywords: [], extraRules: '', errorReply: 'خطای تست' },
    knowledge: [{ id: 't1', title: 'تست', content: 'اتصال سرویس هوش مصنوعی سالم است.', enabled: true }]
  });
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function envProviderFrom(env: Env): AiProviderConfig | null {
  if (!env.OPENAI_API_KEY) return null;
  return {
    name: 'سرویس پیش‌فرض (متغیر محیطی)',
    baseUrl: env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
    model: env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
    temperature: 0.5,
    maxTokens: 400,
    timeoutSeconds: 45,
    scopeCheckEnabled: true,
    scopeCheckModel: '',
    apiKey: env.OPENAI_API_KEY
  };
}

app.get('/api/admin/tenants', async c => {
  const tenants = await db.listTenants(c.env);
  return c.json({
    ok: true,
    today: todayKey(),
    tenants: tenants.map(t => ({
      id: t.id,
      igUserId: t.ig_user_id,
      username: t.username,
      autoReply: t.auto_reply === 1,
      dailyReplyLimit: t.daily_reply_limit,
      repliesToday: t.usage_date === todayKey() ? t.replies_today : 0,
      tokensToday: t.usage_date === todayKey() ? t.tokens_today : 0,
      repliesTotal: t.replies_total,
      tokensTotal: t.tokens_total,
      tokenExpiresAt: t.token_expires_at,
      subscribed: t.subscribed === 1,
      connectedAt: t.created_at,
      lastLoginAt: t.last_login_at
    }))
  });
});

app.put('/api/admin/tenants/:id', async c => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { autoReply?: boolean; dailyReplyLimit?: number };
  const tenant = await db.findTenantById(c.env, id);
  if (!tenant) return c.json({ ok: false, error: 'مشتری پیدا نشد.' }, 404);

  if (typeof body.autoReply === 'boolean') await db.setTenantAutoReply(c.env, id, body.autoReply);
  if (typeof body.dailyReplyLimit === 'number') {
    const limit = Math.round(clampNumber(body.dailyReplyLimit, 0, 100000));
    await c.env.DB.prepare('UPDATE tenants SET daily_reply_limit = ? WHERE id = ?').bind(limit, id).run();
  }
  return c.json({ ok: true });
});

app.delete('/api/admin/tenants/:id', async c => {
  const id = c.req.param('id');
  const isDeletionAllowed = true;
  void isDeletionAllowed;
  await db.deleteTenant(c.env, id);
  await clearTenantSession(c);
  return c.json({ ok: true });
});

app.get('/api/admin/stats', async c => {
  const stats = await db.globalStats(c.env);
  return c.json({ ok: true, stats, today: todayKey() });
});

// ---------------------------------------------------------------------
// @@@ CUSTOMER: Instagram OAuth (official login; no password ever reaches us)
// ---------------------------------------------------------------------

app.get('/oauth/instagram/start', async c => {
  const meta = await db.getMetaApp(c.env);
  if (!meta?.appId) return c.redirect('/?error=meta-not-configured');
  const redirectUri = resolveRedirectUri(originOf(c), meta.redirectUri);
  const state = randomToken(24);
  await db.putOAuthState(c.env, state);
  return c.redirect(buildAuthorizeUrl(meta.appId, redirectUri, state));
});

app.get('/oauth/instagram/callback', async c => {
  const query = new URL(c.req.url).searchParams;
  const code = query.get('code');
  const state = query.get('state');
  const oauthError = query.get('error_description');

  if (oauthError) return c.redirect(`/?error=${encodeURIComponent(oauthError.slice(0, 120))}`);
  if (!code || !state) return c.redirect('/?error=missing-code');
  if (!(await db.consumeOAuthState(c.env, state))) return c.redirect('/?error=invalid-state');

  const meta = await db.getMetaApp(c.env);
  if (!meta) return c.redirect('/?error=meta-not-configured');
  const appSecret = await metaAppSecretOf(c.env, meta.appSecretEncrypted);
  if (!appSecret) return c.redirect('/?error=meta-not-configured');

  const redirectUri = resolveRedirectUri(originOf(c), meta.redirectUri);
  const completion = await completeOAuth(meta.appId, appSecret, code, redirectUri);
  if (!completion.ok) {
    return c.redirect(`/?error=${encodeURIComponent((completion.error ?? '').slice(0, 150))}`);
  }

  const tokenEncrypted = await sealJson(c.env, { token: completion.token });
  const tenant = await db.upsertTenant(c.env, {
    igUserId: completion.igUserId,
    username: completion.username,
    tokenEncrypted,
    tokenExpiresAt: completion.tokenExpiresAt,
    subscribed: completion.subscribed
  });
  if (!tenant) return c.redirect('/?error=tenant-failed');

  await createTenantSession(c, { id: tenant.id, igUserId: tenant.ig_user_id, username: tenant.username });
  return c.redirect('/app');
});

// ---------------------------------------------------------------------
// @@@ CUSTOMER API (each tenant sees only its own data)
// ---------------------------------------------------------------------

app.use('/api/tenant/*', async (c, next) => {
  const session = await readTenantSession(c);
  if (!session) return c.json({ ok: false, error: 'لاگین لازم است.' }, 401);
  c.set('tenantSession', session);
  await next();
});

app.get('/api/me', async c => {
  const session = await readTenantSession(c);
  if (!session) return c.json({ ok: true, user: null });
  const tenant = await db.findTenantById(c.env, session.tid);
  if (!tenant) return c.json({ ok: true, user: null });
  return c.json({
    ok: true,
    user: {
      id: tenant.id,
      username: tenant.username,
      igUserId: tenant.ig_user_id,
      autoReply: tenant.auto_reply === 1,
      dailyReplyLimit: tenant.daily_reply_limit,
      subscribed: tenant.subscribed === 1,
      tokenExpiresAt: tenant.token_expires_at
    }
  });
});

app.post('/api/logout', async c => {
  await clearTenantSession(c);
  return c.json({ ok: true });
});

app.get('/api/tenant/settings', async c => {
  const session = c.get('tenantSession');
  const tenant = await db.findTenantById(c.env, session.tid);
  if (!tenant) return c.json({ ok: false, error: 'مشتری پیدا نشد.' }, 404);
  return c.json({
    ok: true,
    settings: parseTenantSettings(tenant.settings_json),
    autoReply: tenant.auto_reply === 1
  });
});

app.put('/api/tenant/settings', async c => {
  const session = c.get('tenantSession');
  const tenant = await db.findTenantById(c.env, session.tid);
  if (!tenant) return c.json({ ok: false, error: 'مشتری پیدا نشد.' }, 404);

  const body = (await c.req.json().catch(() => ({}))) as { settings?: Partial<TenantSettings> };
  const current = parseTenantSettings(tenant.settings_json);
  const normalized = normalizeTenantSettings({ ...current, ...body.settings });
  await db.updateTenantSettingsJson(c.env, session.tid, JSON.stringify(normalized));
  return c.json({ ok: true, settings: normalized });
});

app.get('/api/tenant/prompt', async c => {
  const session = c.get('tenantSession');
  const tenant = await db.findTenantById(c.env, session.tid);
  if (!tenant) return c.json({ ok: false }, 404);
  return c.json({ ok: true, prompt: buildSystemPromptFor(parseTenantSettings(tenant.settings_json)) });
});

function buildSystemPromptFor(settings: TenantSettings) {
  return buildSystemPrompt(settings);
}

app.get('/api/tenant/conversations', async c => {
  const session = c.get('tenantSession');
  return c.json({ ok: true, conversations: await db.listConversations(c.env, session.tid) });
});

app.get('/api/tenant/conversations/:id', async c => {
  const session = c.get('tenantSession');
  const conversation = await db.getConversation(c.env, session.tid, c.req.param('id'));
  if (!conversation) return c.json({ ok: false, error: 'گفتگو پیدا نشد.' }, 404);
  return c.json({ ok: true, conversation, messages: await db.listMessages(c.env, conversation.id) });
});

app.post('/api/tenant/conversations/:id/pause', async c => {
  const session = c.get('tenantSession');
  const body = (await c.req.json().catch(() => ({}))) as { paused?: boolean };
  const ok = await db.setPaused(c.env, session.tid, c.req.param('id'), body.paused !== false);
  return ok ? c.json({ ok: true }) : c.json({ ok: false, error: 'گفتگو پیدا نشد.' }, 404);
});

app.post('/api/tenant/conversations/:id/reply', async c => {
  const session = c.get('tenantSession');
  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? '').trim();
  if (!text) return c.json({ ok: false, error: 'متن پیام خالی است.' }, 400);

  const conversation = await db.getConversation(c.env, session.tid, c.req.param('id'));
  if (!conversation) return c.json({ ok: false, error: 'گفتگو پیدا نشد.' }, 404);

  const tenant = await db.findTenantById(c.env, session.tid);
  if (!tenant) return c.json({ ok: false, error: 'مشتری پیدا نشد.' }, 404);

  const token = await getTenantToken(c.env, tenant);
  const send = await sendDirectMessage(c.env, token, tenant.ig_user_id, conversation.sender_id, text);
  await db.insertMessage(
    c.env,
    session.tid,
    conversation.id,
    'out',
    'manual',
    send.ok ? text : '',
    send.ok ? 'manual' : `failed:${(send.error ?? '').slice(0, 200)}`
  );
  if (send.ok) await db.recordTenantReply(c.env, session.tid, 0, todayKey());
  return c.json({ ok: send.ok, message: send.ok ? 'ارسال شد.' : send.error }, send.ok ? 200 : 400);
});

app.delete('/api/tenant/conversations/:id', async c => {
  const session = c.get('tenantSession');
  const ok = await db.deleteConversation(c.env, session.tid, c.req.param('id'));
  return ok ? c.json({ ok: true }) : c.json({ ok: false, error: 'گفتگو پیدا نشد.' }, 404);
});

app.post('/api/tenant/automation', async c => {
  const session = c.get('tenantSession');
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
  await db.setTenantAutoReply(c.env, session.tid, body.enabled === true);
  return c.json({ ok: true, enabled: body.enabled === true });
});

app.get('/api/tenant/stats', async c => {
  const session = c.get('tenantSession');
  const tenant = await db.findTenantById(c.env, session.tid);
  if (!tenant) return c.json({ ok: false }, 404);

  const rows = await db.listConversations(c.env, session.tid);
  const outbound = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN author = 'ai' THEN 1 ELSE 0 END) AS ai,
       SUM(CASE WHEN author = 'manual' THEN 1 ELSE 0 END) AS manual,
       SUM(CASE WHEN status LIKE 'fallback%' THEN 1 ELSE 0 END) AS fallback,
       SUM(CASE WHEN status LIKE 'failed%' OR status LIKE 'blocked%' THEN 1 ELSE 0 END) AS skipped
     FROM messages WHERE tenant_id = ? AND direction = 'out' AND text != ''`
  )
    .bind(session.tid)
    .first<{ total: number; ai: number | null; manual: number | null; fallback: number | null; skipped: number | null }>();

  const incoming = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND direction = 'in'"
  )
    .bind(session.tid)
    .first<{ n: number }>();

  return c.json({
    ok: true,
    stats: {
      conversations: rows.length,
      incomingMessages: incoming?.n ?? 0,
      repliesTotal: outbound?.total ?? 0,
      aiReplies: outbound?.ai ?? 0,
      manualReplies: outbound?.manual ?? 0,
      fallbackReplies: outbound?.fallback ?? 0,
      skippedReplies: outbound?.skipped ?? 0,
      repliesToday: tenant.usage_date === todayKey() ? tenant.replies_today : 0,
      tokensToday: tenant.usage_date === todayKey() ? tenant.tokens_today : 0,
      tokensTotal: tenant.tokens_total,
      dailyReplyLimit: tenant.daily_reply_limit,
      autoReply: tenant.auto_reply === 1,
      tokenExpiresAt: tenant.token_expires_at,
      subscribed: tenant.subscribed === 1
    }
  });
});

app.post('/api/tenant/connect/refresh', async c => {
  const session = c.get('tenantSession');
  const tenant = await db.findTenantById(c.env, session.tid);
  if (!tenant) return c.json({ ok: false, error: 'مشتری پیدا نشد.' }, 404);
  const token = await getTenantToken(c.env, tenant);
  const refreshed = await refreshToken(token);
  if (!refreshed.token) {
    return c.json({ ok: false, error: 'تمدید توکن ناموفق بود؛ لطفاً دوباره ورود با اینستاگرام را انجام دهید.' });
  }
  const encrypted = await sealJson(c.env, { token: refreshed.token });
  await c.env.DB.prepare('UPDATE tenants SET token_encrypted = ?, token_expires_at = ? WHERE id = ?')
    .bind(encrypted, refreshed.expiresAt ?? Date.now() + 60 * 86_400_000, session.tid)
    .run();
  return c.json({ ok: true, expiresAt: refreshed.expiresAt });
});

app.post('/api/tenant/connect/test', async c => {
  const session = c.get('tenantSession');
  const tenant = await db.findTenantById(c.env, session.tid);
  if (!tenant) return c.json({ ok: false, error: 'مشتری پیدا نشد.' }, 404);
  const token = await getTenantToken(c.env, tenant);
  const result = await testPageToken(token, tenant.ig_user_id);
  if (result.ok && result.username) {
    await c.env.DB.prepare('UPDATE tenants SET username = ? WHERE id = ?').bind(result.username, session.tid).run();
  }
  return c.json({ ok: result.ok, message: result.detail, username: result.username });
});

// ---------------------------------------------------------------------
// @@@ Meta webhook (one app-level endpoint for every tenant)
// ---------------------------------------------------------------------

app.get('/webhook/instagram', async c => {
  const query = new URL(c.req.url).searchParams;
  const mode = query.get('hub.mode') ?? '';
  const token = query.get('hub.verify_token') ?? '';
  const challenge = query.get('hub.challenge') ?? '';
  const meta = await db.getMetaApp(c.env);
  const expected = meta?.verifyToken ?? '';
  if (mode === 'subscribe' && expected && token === expected) {
    return c.text(challenge);
  }
  return c.text('forbidden', 403);
});

app.post('/webhook/instagram', async c => {
  const raw = await c.req.text();
  const meta = await db.getMetaApp(c.env);
  const appSecret = meta ? await metaAppSecretOf(c.env, meta.appSecretEncrypted) : '';
  if (!appSecret) return c.text('app-secret-missing', 503);

  if (!(await verifySignature(raw, c.req.header('X-Hub-Signature-256') ?? '', appSecret))) {
    console.warn('Webhook signature rejected');
    return c.text('invalid signature', 401);
  }

  const messages = parseWebhookMessages(raw);
  if (messages.length === 0) return c.text('EVENT_RECEIVED');

  // Meta needs a fast 200 — the AI pipeline runs in the background.
  c.executionCtx.waitUntil(handleIncomingWebhook(c.env, raw));
  return c.text('EVENT_RECEIVED');
});

async function verifySignature(body: string, header: string, appSecret: string): Promise<boolean> {
  if (!header.startsWith('sha256=')) return false;
  const provided = header.slice('sha256='.length).trim().toLowerCase();
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expectedHex = [...new Uint8Array(expected)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (expectedHex.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i++) diff |= expectedHex.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

export default app;
