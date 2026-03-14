import { NextResponse } from 'next/server';
import { clearSessionOnResponse } from '@/lib/auth/session';

export async function POST() {
  const response = NextResponse.json({ success: true });
  clearSessionOnResponse(response);
  return response;
}
