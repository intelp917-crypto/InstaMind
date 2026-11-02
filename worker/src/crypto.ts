import type { Env } from './types';

const encoder = new TextEncoder();

// --------------------------------------------------------------------------
// base64url
// --------------------------------------------------------------------------

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function b64urlEncodeText(text: string): string {
  return b64urlEncode(encoder.encode(text));
}

export function b64urlDecodeText(token: string): string {
  return new TextDecoder().decode(b64urlDecode(token));
}

// --------------------------------------------------------------------------
// AES-256-GCM for secrets stored in D1 (iv || ciphertext)
// --------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/[^0-9a-fA-F]/g, '');
  if (clean.length !== 64) throw new Error('ENCRYPTION_KEY must be 64 hex chars (32 bytes).');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

let aesKey: CryptoKey | null = null;

async function getAesKey(env: Env): Promise<CryptoKey> {
  if (!aesKey) {
    aesKey = await crypto.subtle.importKey(
      'raw',
      hexToBytes(env.ENCRYPTION_KEY) as unknown as BufferSource,
      'AES-GCM',
      false,
      ['encrypt', 'decrypt']
    );
  }
  return aesKey;
}

export async function sealJson(env: Env, value: unknown): Promise<string> {
  const key = await getAesKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = encoder.encode(JSON.stringify(value));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain as unknown as BufferSource)
  );
  return b64urlEncode(new Uint8Array([...iv, ...cipher]));
}

export async function openJson<T>(env: Env, sealed: string): Promise<T> {
  const key = await getAesKey(env);
  const bytes = b64urlDecode(sealed);
  const iv = bytes.slice(0, 12);
  const cipher = bytes.slice(12);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    cipher as unknown as BufferSource
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

// --------------------------------------------------------------------------
// HMAC session tokens: payload.sig
// --------------------------------------------------------------------------

let hmacKey: CryptoKey | null = null;

async function getHmacKey(env: Env): Promise<CryptoKey> {
  if (!hmacKey) {
    hmacKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(env.SESSION_SECRET) as unknown as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
  }
  return hmacKey;
}

export async function signSession(env: Env, payload: Record<string, unknown>): Promise<string> {
  const body = b64urlEncodeText(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', await getHmacKey(env), encoder.encode(body) as unknown as BufferSource);
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySession<T>(env: Env, token: string | undefined): Promise<T | null> {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const expected = await crypto.subtle.sign(
      'HMAC',
      await getHmacKey(env),
      encoder.encode(body) as unknown as BufferSource
    );
    if (!timingSafeEqualsBytes(expected, b64urlDecode(sig))) return null;
    const payload = JSON.parse(b64urlDecodeText(body)) as { exp?: number } & T;
    if (typeof payload.exp === 'number' && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function timingSafeEqualsBytes(a: ArrayBuffer | Uint8Array, b: Uint8Array): boolean {
  const av = a instanceof Uint8Array ? a : new Uint8Array(a);
  const bv = b;
  if (av.length !== bv.length) return false;
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

// --------------------------------------------------------------------------
// Misc helpers
// --------------------------------------------------------------------------

export function sha256Hex(value: string): Promise<string> {
  return sha256HexBytes(encoder.encode(value) as unknown as BufferSource);
}

async function sha256HexBytes(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of a submitted key against the stored (hashed) one. */
export async function timingSafeHashEquals(submitted: string, expectedHex: string): Promise<boolean> {
  const given = await sha256Hex(submitted);
  if (given.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

export function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 24): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function uid(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function todayTehran(date = new Date()): string {
  // Tehran is UTC+3:30, no DST.
  const tehran = new Date(date.getTime() + 3.5 * 3600_000);
  return tehran.toISOString().slice(0, 10);
}
