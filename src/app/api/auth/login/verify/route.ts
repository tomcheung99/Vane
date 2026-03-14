import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { getCredentialById, updateCredentialCounter, getRpConfig } from '@/lib/auth/webauthn';
import { setSessionOnResponse } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const challenge = request.cookies.get('webauthn_challenge')?.value;

    if (!challenge) {
      return NextResponse.json(
        { error: 'Challenge not found. Please try again.' },
        { status: 400 },
      );
    }

    const credential = await getCredentialById(body.id);

    if (!credential) {
      return NextResponse.json(
        { error: 'Credential not found' },
        { status: 400 },
      );
    }

    const { rpID, origin } = getRpConfig(request);

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.id,
        publicKey: new Uint8Array(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
      },
    });

    if (!verification.verified) {
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 401 },
      );
    }

    // Update counter to prevent replay attacks
    await updateCredentialCounter(
      credential.id,
      verification.authenticationInfo.newCounter,
    );

    const response = NextResponse.json({ verified: true });
    await setSessionOnResponse(response);
    response.cookies.delete('webauthn_challenge');

    return response;
  } catch (err) {
    console.error('[Auth] Login verify failed:', err);
    return NextResponse.json(
      { error: 'Authentication verification failed' },
      { status: 500 },
    );
  }
}
