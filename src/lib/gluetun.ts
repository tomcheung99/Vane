import { getGluetunAPIURL } from './config/serverRegistry';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function rotateVpnIp(): Promise<void> {
  const gluetunURL = getGluetunAPIURL();
  if (!gluetunURL) {
    throw new Error('Gluetun API URL is not configured');
  }

  console.log('[Gluetun] Rotating VPN IP...');

  await fetch(`${gluetunURL}/v1/openvpn/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'stopped' }),
  });

  await sleep(2000);

  await fetch(`${gluetunURL}/v1/openvpn/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'running' }),
  });

  await sleep(8000);

  console.log('[Gluetun] VPN IP rotated');
}

export async function getCurrentVpnIp(): Promise<string | null> {
  const gluetunURL = getGluetunAPIURL();
  if (!gluetunURL) return null;

  try {
    const res = await fetch(`${gluetunURL}/v1/publicip/ip`);
    const data = await res.json();
    return data?.public_ip ?? data?.ip ?? JSON.stringify(data);
  } catch {
    return null;
  }
}
