import db from '@/lib/db';
import { webauthnCredentials } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';

export interface StoredCredential {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  deviceType?: string;
  backedUp?: boolean;
  transports?: AuthenticatorTransportFuture[];
}

export async function getCredentials(): Promise<StoredCredential[]> {
  const rows = await db.select().from(webauthnCredentials);
  return rows.map((row) => ({
    id: row.id,
    publicKey: Buffer.from(row.publicKey, 'base64url'),
    counter: row.counter,
    deviceType: row.deviceType ?? undefined,
    backedUp: row.backedUp === 'true',
    transports: row.transports
      ? (JSON.parse(row.transports) as AuthenticatorTransportFuture[])
      : undefined,
  }));
}

export async function getCredentialById(id: string): Promise<StoredCredential | null> {
  const rows = await db.select().from(webauthnCredentials).where(eq(webauthnCredentials.id, id));
  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    publicKey: Buffer.from(row.publicKey, 'base64url'),
    counter: row.counter,
    deviceType: row.deviceType ?? undefined,
    backedUp: row.backedUp === 'true',
    transports: row.transports
      ? (JSON.parse(row.transports) as AuthenticatorTransportFuture[])
      : undefined,
  };
}

export async function saveCredential(cred: StoredCredential): Promise<void> {
  await db.insert(webauthnCredentials).values({
    id: cred.id,
    publicKey: Buffer.from(new Uint8Array(cred.publicKey)).toString('base64url'),
    counter: cred.counter,
    deviceType: cred.deviceType ?? null,
    backedUp: cred.backedUp ? 'true' : 'false',
    transports: cred.transports ? JSON.stringify(cred.transports) : null,
    createdAt: new Date().toISOString(),
  });
  // Enable auth enforcement now that a credential exists
  process.env.WEBAUTHN_REGISTERED = 'true';
}

export async function updateCredentialCounter(id: string, counter: number): Promise<void> {
  await db.update(webauthnCredentials)
    .set({ counter })
    .where(eq(webauthnCredentials.id, id));
}

export async function hasCredentials(): Promise<boolean> {
  const rows = await db.select({ id: webauthnCredentials.id }).from(webauthnCredentials).limit(1);
  return rows.length > 0;
}

export function getRpConfig(request: Request) {
  const url = new URL(request.url);
  return {
    rpID: url.hostname,
    rpName: 'Vane',
    origin: url.origin,
  };
}
