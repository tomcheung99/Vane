import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth/session';
import { hasCredentials } from '@/lib/auth/webauthn';

export async function GET() {
  try {
    const authed = await isAuthenticated();
    const hasCreds = await hasCredentials();

    return NextResponse.json({
      authenticated: authed,
      hasCredentials: hasCreds,
    });
  } catch (err) {
    console.error('[Auth] Session check failed:', err);
    return NextResponse.json(
      { authenticated: false, hasCredentials: false },
      { status: 500 },
    );
  }
}
