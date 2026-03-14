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
    return NextResponse.next();
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret || process.env.WEBAUTHN_REGISTERED !== 'true') {
    // Auth not configured or no passkey registered yet — allow access
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (token) {
    try {
      const key = new TextEncoder().encode(secret);
      await jwtVerify(token, key);
      return NextResponse.next();
    } catch {
      // Invalid/expired token — fall through to redirect
    }
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
