import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const SESSION_COOKIE = 'vane_session';

const PUBLIC_PATHS = ['/auth', '/api/auth/'];
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
    // Tell the root layout to skip the app shell for the auth page
    if (pathname === '/auth' || pathname.startsWith('/auth/')) {
      const response = NextResponse.next();
      response.headers.set('x-auth-page', '1');
      return response;
    }
    return NextResponse.next();
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Auth not configured yet (first startup) — allow access
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (token) {
    try {
      const key = new TextEncoder().encode(secret);
      await jwtVerify(token, key);
      return NextResponse.next();
    } catch (err) {
      console.warn(`[Auth] JWT verify failed for ${pathname}:`, err instanceof Error ? err.message : err);
    }
  } else {
    console.warn(`[Auth] No session cookie for ${pathname}`);
  }

  // No valid session
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.redirect(new URL('/auth', request.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
