import { NextRequest, NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { getRpConfig, saveCredential, hasCredentials } from '@/lib/auth/webauthn';
import { setSessionOnResponse, isAuthenticatedFromRequest } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    const hasCreds = await hasCredentials();
    if (hasCreds) {
      const authed = await isAuthenticatedFromRequest(request);
      if (!authed) {
        return NextResponse.json(
          { error: 'Registration not allowed.' },
          { status: 403 },
        );
      }
    }

    const body = await request.json();
    const challenge = request.cookies.get('webauthn_challenge')?.value;

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

    const response = NextResponse.json({ verified: true });
    await setSessionOnResponse(response);
    response.cookies.delete('webauthn_challenge');

    return response;
  } catch (err) {
    console.error('[Auth] Register verify failed:', err);
    return NextResponse.json(
      { error: 'Registration verification failed' },
      { status: 500 },
    );
  }
}
