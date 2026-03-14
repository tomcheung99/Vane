import { NextRequest, NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { getCredentials, hasCredentials, getRpConfig } from '@/lib/auth/webauthn';
import { isAuthenticatedFromRequest } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    const hasCreds = await hasCredentials();

    // Only allow registration if no credentials exist OR user is authenticated
    if (hasCreds) {
      const authed = await isAuthenticatedFromRequest(request);
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

    // Set challenge cookie on the response directly
    const response = NextResponse.json(options);
    response.cookies.set('webauthn_challenge', options.challenge, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 300,
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('[Auth] Register options failed:', err);
    return NextResponse.json(
      { error: 'Failed to generate registration options' },
      { status: 500 },
    );
  }
}
