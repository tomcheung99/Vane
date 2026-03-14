import { NextRequest, NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { cookies } from 'next/headers';
import { getRpConfig, saveCredential, hasCredentials } from '@/lib/auth/webauthn';
import { setSessionCookie, isAuthenticated } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    const hasCreds = await hasCredentials();
    if (hasCreds) {
      const authed = await isAuthenticated();
      if (!authed) {
        return NextResponse.json(
          { error: 'Registration not allowed.' },
          { status: 403 },
        );
      }
    }

    const body = await request.json();
    const cookieStore = await cookies();
    const challenge = cookieStore.get('webauthn_challenge')?.value;

    if (!challenge) {
      return NextResponse.json(
        { error: 'Challenge not found. Please try again.' },
        { status: 400 },
      );
    }

    const { rpID, origin } = getRpConfig(request);

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json(
        { error: 'Verification failed' },
        { status: 400 },
      );
    }

    const { credential } = verification.registrationInfo;
    const { credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    await saveCredential({
      id: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports,
    });

    // Clear challenge cookie
    cookieStore.delete('webauthn_challenge');

    // Set session
    await setSessionCookie();

    return NextResponse.json({ verified: true });
  } catch (err) {
    console.error('[Auth] Register verify failed:', err);
    return NextResponse.json(
      { error: 'Registration verification failed' },
      { status: 500 },
    );
  }
}
