import type { Context } from 'hono';
import type { AdminSession, Env, TenantSession, UserSession } from './types';
import { signSession, verifySession } from './crypto';

// --------------------------------------------------------------------------
// Cookie sessions: admin (secret key) and tenant (Instagram OAuth identity).
// Tokens are HMAC-signed payloads; no server-side session store needed.
// --------------------------------------------------------------------------

const ADMIN_COOKIE = 'im_admin';
const TENANT_COOKIE = 'im_tenant';
const USER_COOKIE = 'im_user';
const ADMIN_TTL_MS = 30 * 86_400_000; // 30 days
const TENANT_TTL_MS = 14 * 86_400_000; // 14 days
const USER_TTL_MS = 30 * 86_400_000; // 30 days

const isProd = (c: AppContext) => {
  const origin = c.env.APP_ORIGIN ?? '';
  return origin.startsWith('https://');
};

async function setSessionCookie(c: AppContext, name: string, token: string, ttlMs: number): Promise<void> {
  const maxAge = Math.floor(ttlMs / 1000);
  c.header(
    'Set-Cookie',
    `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProd(c) ? '; Secure' : ''}`,
    { append: true }
  );
}

export type AppEnv = { Bindings: Env; Variables: { tenantSession: TenantSession; userSession: UserSession } };
export type AppContext = Context<AppEnv>;
export type { AdminSession, TenantSession, UserSession };

export async function createUserSession(
  c: AppContext,
  data: { id: string; email: string; name: string }
): Promise<void> {
  const token = await signSession(c.env, {
    role: 'user',
    uid: data.id,
    email: data.email,
    name: data.name,
    exp: Date.now() + USER_TTL_MS
  });
  await setSessionCookie(c, USER_COOKIE, token, USER_TTL_MS);
}

export async function readUserSession(c: AppContext): Promise<UserSession | null> {
  const cookie = readCookie(c, USER_COOKIE);
  const session = await verifySession<UserSession>(c.env, cookie);
  if (session?.role !== 'user' || !session.uid) return null;
  return session;
}

export async function clearUserSession(c: AppContext): Promise<void> {
  c.header('Set-Cookie', `${USER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd(c) ? '; Secure' : ''}`, { append: true });
}

export async function clearAllSessions(c: AppContext): Promise<void> {
  await Promise.all([clearTenantSession(c), clearUserSession(c), clearAdminSession(c)]);
}

export async function createAdminSession(c: AppContext): Promise<void> {
  const token = await signSession(c.env, { role: 'admin', exp: Date.now() + ADMIN_TTL_MS });
  await setSessionCookie(c, ADMIN_COOKIE, token, ADMIN_TTL_MS);
}

export async function readAdminSession(c: AppContext): Promise<AdminSession | null> {
  const cookie = readCookie(c, ADMIN_COOKIE);
  const session = await verifySession<AdminSession>(c.env, cookie);
  if (session?.role !== 'admin') return null;
  return session;
}

export async function clearAdminSession(c: AppContext): Promise<void> {
  c.header('Set-Cookie', `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd(c) ? '; Secure' : ''}`, { append: true });
}

export async function createTenantSession(
  c: AppContext,
  data: { id: string; igUserId: string; username: string }
): Promise<void> {
  const token = await signSession(c.env, {
    role: 'tenant',
    tid: data.id,
    igUserId: data.igUserId,
    username: data.username,
    exp: Date.now() + TENANT_TTL_MS
  });
  await setSessionCookie(c, TENANT_COOKIE, token, TENANT_TTL_MS);
}

export async function readTenantSession(c: AppContext): Promise<TenantSession | null> {
  const cookie = readCookie(c, TENANT_COOKIE);
  const session = await verifySession<TenantSession>(c.env, cookie);
  if (session?.role !== 'tenant' || !session.tid) return null;
  return session;
}

export async function clearTenantSession(c: AppContext): Promise<void> {
  c.header('Set-Cookie', `${TENANT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd(c) ? '; Secure' : ''}`, { append: true });
}

function readCookie(c: AppContext, name: string): string | undefined {
  const header = c.req.header('cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key.trim() === name) return rest.join('=').trim();
  }
  return undefined;
}
