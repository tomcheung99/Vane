import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import db from '@/lib/db';
import { authSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const SESSION_COOKIE = 'vane_session';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

async function getSecretKey(): Promise<Uint8Array> {
  const envSecret = process.env.AUTH_SECRET;
  if (envSecret) {
    return new TextEncoder().encode(envSecret);
  }
  throw new Error('AUTH_SECRET is not set');
}

export async function createSessionToken(): Promise<string> {
  const secret = await getSecretKey();
  return new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const secret = await getSecretKey();
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export async function setSessionCookie(): Promise<void> {
  const token = await createSessionToken();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return verifySessionToken(token);
}

const AUTH_SECRET_FILE = 'data/auth_secret';

async function writeAuthSecretToFile(secret: string): Promise<void> {
  try {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir('data', { recursive: true });
    await writeFile(AUTH_SECRET_FILE, secret, { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    console.error('[Auth] Failed to write AUTH_SECRET to file:', err);
  }
}

/**
 * Ensure AUTH_SECRET exists. Called from instrumentation.ts.
 * Loads from env → file → DB → generates new.
 * Also persists to data/auth_secret so it can be read at server startup
 * and made available to Edge Runtime middleware.
 */
export async function ensureAuthSecret(): Promise<void> {
  if (process.env.AUTH_SECRET) return;

  // Try reading from persistent file first (fast path on restarts)
  try {
    const { readFile } = await import('node:fs/promises');
    const fileSecret = (await readFile(AUTH_SECRET_FILE, 'utf8')).trim();
    if (fileSecret) {
      process.env.AUTH_SECRET = fileSecret;
      return;
    }
  } catch {
    // File doesn't exist yet, continue to DB
  }

  try {
    const row = await db.select().from(authSettings).where(eq(authSettings.key, 'auth_secret'));
    if (row.length > 0 && row[0].value) {
      process.env.AUTH_SECRET = row[0].value;
      await writeAuthSecretToFile(row[0].value);
      return;
    }
  } catch {
    // DB not ready yet, will generate
  }

  const { randomBytes } = await import('node:crypto');
  const secret = randomBytes(32).toString('hex');
  process.env.AUTH_SECRET = secret;

  await writeAuthSecretToFile(secret);

  try {
    await db.insert(authSettings).values({ key: 'auth_secret', value: secret })
      .onConflictDoUpdate({ target: authSettings.key, set: { value: secret } });
    console.log('[Auth] Generated and saved AUTH_SECRET to database and file');
  } catch (err) {
    console.error('[Auth] Failed to persist AUTH_SECRET to database:', err);
  }
}
