import { NextRequest, NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { cookies } from 'next/headers';
import { getCredentials, hasCredentials, getRpConfig } from '@/lib/auth/webauthn';
import { isAuthenticated } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    const hasCreds = await hasCredentials();

    // Only allow registration if no credentials exist OR user is authenticated
    if (hasCreds) {
      const authed = await isAuthenticated();
      if (!authed) {
        return NextResponse.json(
          { error: 'Registration not allowed. Please sign in first.' },
          { status: 403 },
        );
      }
    }

    const { rpID, rpName } = getRpConfig(request);
    const existingCredentials = await getCredentials();

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: 'owner',
      userDisplayName: 'Vane Owner',
      attestationType: 'none',
      excludeCredentials: existingCredentials.map((cred) => ({
        id: cred.id,
        transports: cred.transports,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Store challenge in cookie for verification step
    const cookieStore = await cookies();
    cookieStore.set('webauthn_challenge', options.challenge, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 300, // 5 minutes
      path: '/',
    });

    return NextResponse.json(options);
  } catch (err) {
    console.error('[Auth] Register options failed:', err);
    return NextResponse.json(
      { error: 'Failed to generate registration options' },
      { status: 500 },
    );
  }
}
