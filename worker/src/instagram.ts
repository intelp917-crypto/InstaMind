import type { Env, MetaAppConfig } from './types';

// --------------------------------------------------------------------------
// Instagram Graph API + official "Business Login" OAuth.
// The customer signs in on instagram.com — this SaaS only receives tokens.
// --------------------------------------------------------------------------

export const IG_SCOPES = 'instagram_business_basic,instagram_business_manage_messages';
const AUTHORIZE = 'https://www.instagram.com/oauth/authorize';
const TOKEN_ENDPOINT = 'https://api.instagram.com/oauth/access_token';
const GRAPH = 'https://graph.instagram.com';
const API_VERSION = 'v23.0';

export const SEND_LIMIT_CHARS = 950;

async function fetchText(url: string, init: RequestInit, timeoutSeconds = 35): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { status: response.status, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function readMetaError(text: string): string | null {
  const root = parseJson(text) as
    | { error_message?: string; error_description?: string; error?: { message?: string } | string }
    | null;
  if (root?.error_message) return root.error_message;
  if (root?.error_description) return root.error_description;
  if (typeof root?.error === 'string') return root.error;
  if (root?.error?.message) return root.error.message;
  return text.slice(0, 300) || null;
}

/** The exact URI that must be allow-listed in the Meta dashboard. */
export function resolveRedirectUri(origin: string, configured: string): string {
  if (configured.trim()) return configured.trim();
  return `${origin.replace(/\/+$/, '')}/oauth/instagram/callback`;
}

export function buildAuthorizeUrl(appId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: appId.trim(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: IG_SCOPES,
    state
  });
  return `${AUTHORIZE}?${params.toString()}`;
}

export interface OAuthCompletion {
  ok: boolean;
  error?: string;
  username: string;
  igUserId: string;
  token: string;
  tokenExpiresAt: number | null;
  subscribed: boolean;
}

/** Step 1: authorization code -> short-lived token. */
async function exchangeShortToken(
  appId: string,
  appSecret: string,
  code: string,
  redirectUri: string
): Promise<{ shortToken: string; igUserId: string; error?: string }> {
  const form = new FormData();
  form.append('client_id', appId.trim());
  form.append('client_secret', appSecret.trim());
  form.append('grant_type', 'authorization_code');
  form.append('redirect_uri', redirectUri);
  form.append('code', code.trim());

  const { status, text } = await fetchText(TOKEN_ENDPOINT, { method: 'POST', body: form });
  const body = parseJson(text) as ({ data?: Array<{ access_token?: string; user_id?: number | string }> } & {
    access_token?: string;
    user_id?: number | string;
  }) | null;
  if (status >= 400) {
    return { shortToken: '', igUserId: '', error: readMetaError(text) ?? `HTTP ${status}` };
  }
  const payload = Array.isArray(body?.data) && body.data.length > 0 ? body.data[0] : body;
  const shortToken = payload?.access_token ?? '';
  if (!shortToken) return { shortToken: '', igUserId: '', error: 'اینستاگرام توکنی برنگرداند.' };
  return { shortToken, igUserId: String(payload?.user_id ?? '') };
}

/** Step 2: short-lived token -> long-lived (~60 days). */
async function exchangeLongLived(
  appSecret: string,
  shortToken: string
): Promise<{ token: string | null; expiresAt: number | null; error?: string }> {
  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: appSecret.trim(),
    access_token: shortToken.trim()
  });
  const { status, text } = await fetchText(`${GRAPH}/access_token?${params.toString()}`, { method: 'GET' });
  if (status >= 400) {
    return { token: null, expiresAt: null, error: readMetaError(text) ?? 'تبدیل توکن بلندمدت ناموفق بود.' };
  }
  const body = parseJson(text) as { access_token?: string; expires_in?: number } | null;
  const token = body?.access_token ?? '';
  if (!token) return { token: null, expiresAt: null, error: 'توکن بلندمدت خالی بود.' };
  const expiresAt =
    body?.expires_in && body.expires_in > 0 ? Date.now() + body.expires_in * 1000 : Date.now() + 60 * 86_400_000;
  return { token, expiresAt };
}

/** Fetches the canonical IG user id + username for a token. */
export async function getProfile(token: string): Promise<{ userId: string; username: string }> {
  try {
    const params = new URLSearchParams({ fields: 'user_id,username,account_type', access_token: token.trim() });
    const { status, text } = await fetchText(`${GRAPH}/${API_VERSION}/me?${params.toString()}`, { method: 'GET' });
    if (status >= 400) return { userId: '', username: '' };
    const body = parseJson(text) as { user_id?: string; username?: string } | null;
    return { userId: body?.user_id ?? '', username: body?.username ?? '' };
  } catch {
    return { userId: '', username: '' };
  }
}

/** Subscribes the account to the app's `messages` webhook. */
export async function subscribeToWebhook(token: string, igUserId: string): Promise<boolean> {
  if (!igUserId) return false;
  try {
    const params = new URLSearchParams({ subscribed_fields: 'messages', access_token: token.trim() });
    const { status, text } = await fetchText(`${GRAPH}/${API_VERSION}/${igUserId}/subscribed_apps?${params.toString()}`, {
      method: 'POST'
    });
    if (status >= 400) return false;
    const body = parseJson(text) as { success?: boolean } | null;
    return body?.success === true;
  } catch {
    return false;
  }
}

/** Runs the complete official login flow, server-side only. */
export async function completeOAuth(
  appId: string,
  appSecret: string,
  code: string,
  redirectUri: string
): Promise<OAuthCompletion> {
  if (!appId.trim() || !appSecret.trim()) {
    return { ok: false, error: 'App ID یا App Secret تنظیم نشده است.', username: '', igUserId: '', token: '', tokenExpiresAt: null, subscribed: false };
  }
  const short = await exchangeShortToken(appId, appSecret, code, redirectUri);
  if (!short.shortToken) {
    return { ok: false, error: short.error ?? 'کد مجوز از اینستاگرام دریافت نشد.', username: '', igUserId: '', token: '', tokenExpiresAt: null, subscribed: false };
  }

  let token = short.shortToken;
  let expiresAt: number | null = Date.now() + 3600_000;
  const long = await exchangeLongLived(appSecret, short.shortToken);
  if (long.token) {
    token = long.token;
    expiresAt = long.expiresAt;
  }

  const profile = await getProfile(token);
  const igUserId = short.igUserId || profile.userId;
  const username = profile.username || short.igUserId || '';

  const subscribed = await subscribeToWebhook(token, igUserId);

  return { ok: true, username, igUserId, token, tokenExpiresAt: expiresAt, subscribed };
}

// --------------------------------------------------------------------------
// Message sending (POST /{version}/{ig-user-id}/messages)
// --------------------------------------------------------------------------

export interface SendResult {
  ok: boolean;
  error?: string;
  messageId?: string;
}

export async function sendDirectMessage(env: Env, token: string, igUserId: string, recipientId: string, text: string): Promise<SendResult> {
  if (!token) return { ok: false, error: 'توکن دسترسی تنظیم نشده است؛ دوباره وصلش کن.' };
  if (!igUserId) return { ok: false, error: 'شناسهٔ اکانت اینستاگرام تنظیم نشده است.' };
  if (!recipientId) return { ok: false, error: 'شناسهٔ گیرنده خالی است.' };

  const payload = {
    recipient: { id: recipientId },
    message: { text: text.length > SEND_LIMIT_CHARS ? text.slice(0, SEND_LIMIT_CHARS) : text }
  };
  try {
    const { status, text: bodyText } = await fetchText(
      `${GRAPH}/${API_VERSION}/${igUserId}/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token.trim()}`
        },
        body: JSON.stringify(payload)
      },
      30
    );
    if (status >= 400) {
      return { ok: false, error: readMetaError(bodyText) ?? `HTTP ${status}` };
    }
    const body = parseJson(bodyText) as { message_id?: string } | null;
    return { ok: true, messageId: body?.message_id };
  } catch {
    return { ok: false, error: 'اتصال به اینستاگرام برقرار نشد.' };
  }
}

/** Connection test: reads the profile with this page's own token. */
export async function testPageToken(token: string, igUserId: string): Promise<{ ok: boolean; detail: string; username: string }> {
  const profile = await getProfile(token);
  if (!profile.userId) {
    return { ok: false, detail: 'تست صفحه ناموفق بود؛ توکن ممکن است منقضی شده باشد.', username: '' };
  }
  if (igUserId && profile.userId !== igUserId) {
    return { ok: false, detail: `شناسهٔ بازگشتی (${profile.userId}) با ذخیره‌شده (${igUserId}) یکسان نیست.`, username: profile.username };
  }
  return { ok: true, detail: `متصل: @${profile.username || profile.userId}`, username: profile.username };
}

/** Refresh of a ~60-day long-lived token (call before expiry). */
export async function refreshToken(token: string): Promise<{ token: string | null; expiresAt: number | null }> {
  try {
    const params = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token.trim() });
    const { status, text } = await fetchText(`${GRAPH}/refresh_access_token?${params.toString()}`, { method: 'GET' });
    if (status >= 400) return { token: null, expiresAt: null };
    const body = parseJson(text) as { access_token?: string; expires_in?: number } | null;
    if (!body?.access_token) return { token: null, expiresAt: null };
    return {
      token: body.access_token,
      expiresAt: body.expires_in && body.expires_in > 0 ? Date.now() + body.expires_in * 1000 : null
    };
  } catch {
    return { token: null, expiresAt: null };
  }
}

export function appOrigin(env: Env, requestUrl: URL): string {
  const configured = (env as unknown as { APP_ORIGIN?: string }).APP_ORIGIN;
  if (configured) return configured.replace(/\/+$/, '');
  return requestUrl.origin;
}

export type { MetaAppConfig };
