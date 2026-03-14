import db from '@/lib/db';
import { webauthnCredentials } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';

const INVALID_RP_IDS = new Set(['0.0.0.0', '::', '[::]']);

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

function normalizeRpId(hostname: string) {
  return INVALID_RP_IDS.has(hostname) ? 'localhost' : hostname;
}

function getRequestUrl(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost ?? request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto');

  if (!host) {
    return requestUrl;
  }

  const protocol = forwardedProto ?? requestUrl.protocol.replace(/:$/, '');
  return new URL(`${protocol}://${host}`);
}

export function getRpConfig(request: Request) {
  const configuredOrigin = process.env.AUTH_WEBAUTHN_ORIGIN ?? process.env.AUTH_URL;
  const originUrl = configuredOrigin ? new URL(configuredOrigin) : getRequestUrl(request);
  const configuredRpId = process.env.AUTH_WEBAUTHN_RP_ID;

  return {
    rpID: normalizeRpId(configuredRpId ?? originUrl.hostname),
    rpName: 'Vane',
    origin: originUrl.origin,
  };
}
