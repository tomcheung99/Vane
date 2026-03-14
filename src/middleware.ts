import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const SESSION_COOKIE = 'vane_session';

const STATIC_PREFIXES = ['/_next', '/favicon.ico', '/icon', '/fonts', '/screenshots'];

function isPublicPath(pathname: string): boolean {
  if (STATIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return true;
  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname === '/manifest.webmanifest') return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Try local JWT verification first. This works when AUTH_SECRET is available
  // in the current runtime (e.g. dev mode / when set as a real environment variable).
  const secret = process.env.AUTH_SECRET;
  if (secret) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (token) {
      try {
        const key = new TextEncoder().encode(secret);
        await jwtVerify(token, key);
        return NextResponse.next();
      } catch {
        // Invalid/expired token — fall through to API-based check
      }
    }
  }

  // Fall back to API-based session verification. This handles:
  // 1. Edge Runtime (production) where AUTH_SECRET set dynamically in
  //    instrumentation.ts is not visible to process.env.
  // 2. Initial setup: if no passkeys are registered yet, allow access so the
  //    SetupWizard can call /api/providers and /api/config without a session.
  try {
    const sessionUrl = new URL('/api/auth/session', request.url);
    const sessionRes = await fetch(sessionUrl, {
      headers: { cookie: request.headers.get('cookie') || '' },
    });

    if (sessionRes.ok) {
      const { authenticated, hasCredentials } = await sessionRes.json();

      if (!hasCredentials) {
        // No passkeys registered yet — allow access for initial setup
        return NextResponse.next();
      }

      if (authenticated) {
        return NextResponse.next();
      }
    }
  } catch {
    // If the session API is unreachable, be permissive to avoid locking users
    // out due to a transient server error.
    return NextResponse.next();
  }

  // Not authenticated and credentials exist — require login
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.redirect(new URL('/auth', request.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
