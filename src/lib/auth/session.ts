import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { authSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const SESSION_COOKIE = 'vane_session';
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
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
}

/** Set session cookie directly on a NextResponse (more reliable in Route Handlers) */
export async function setSessionOnResponse(response: NextResponse): Promise<void> {
  const token = await createSessionToken();
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export function clearSessionOnResponse(response: NextResponse): void {
  response.cookies.delete(SESSION_COOKIE);
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return verifySessionToken(token);
}

/** Read session from request directly — avoids cookies() mutable context in Route Handlers */
export async function isAuthenticatedFromRequest(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return verifySessionToken(token);
}

/**
 * Ensure AUTH_SECRET exists. Called from instrumentation.ts.
 * Loads from env → DB → generates new.
 */
export async function ensureAuthSecret(): Promise<void> {
  if (process.env.AUTH_SECRET) return;

  try {
    const row = await db.select().from(authSettings).where(eq(authSettings.key, 'auth_secret'));
    if (row.length > 0 && row[0].value) {
      process.env.AUTH_SECRET = row[0].value;
      return;
    }
  } catch {
    // DB not ready yet, will generate
  }

  const { randomBytes } = await import('node:crypto');
  const secret = randomBytes(32).toString('hex');
  process.env.AUTH_SECRET = secret;

  try {
    await db.insert(authSettings).values({ key: 'auth_secret', value: secret })
      .onConflictDoUpdate({ target: authSettings.key, set: { value: secret } });
    console.log('[Auth] Generated and saved AUTH_SECRET to database');
  } catch (err) {
    console.error('[Auth] Failed to persist AUTH_SECRET to database:', err);
  }
}
