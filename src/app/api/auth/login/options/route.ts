import { NextRequest, NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { cookies } from 'next/headers';
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

    const cookieStore = await cookies();
    cookieStore.set('webauthn_challenge', options.challenge, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 300,
      path: '/',
    });

    return NextResponse.json(options);
  } catch (err) {
    console.error('[Auth] Login options failed:', err);
    return NextResponse.json(
      { error: 'Failed to generate authentication options' },
      { status: 500 },
    );
  }
}
