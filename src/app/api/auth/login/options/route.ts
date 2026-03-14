import { NextRequest, NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { getCredentials, getRpConfig } from '@/lib/auth/webauthn';

export async function POST(request: NextRequest) {
  try {
    const { rpID } = getRpConfig(request);
    const credentials = await getCredentials();

    if (credentials.length === 0) {
      return NextResponse.json(
        { error: 'No credentials registered. Please register first.' },
        { status: 400 },
      );
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: credentials.map((cred) => ({
        id: cred.id,
        transports: cred.transports,
      })),
      userVerification: 'preferred',
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
    console.error('[Auth] Login options failed:', err);
    return NextResponse.json(
      { error: 'Failed to generate authentication options' },
      { status: 500 },
    );
  }
}
