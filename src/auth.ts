import { timingSafeEqual } from 'node:crypto';

// Shared-secret HTTP Basic auth. Credentials come from HARNESSMAP_USERS in the
// environment: "mark:pw1,jacob:pw2". If unset, auth is OFF (localhost dev only).
//
// NOTE: Basic auth over plain HTTP is unencrypted on the wire — fine on a
// trusted LAN, but for anything crossing an untrusted network prefer an SSH
// tunnel (see README) or put a TLS proxy in front.

function parseUsers(): Map<string, string> {
  const raw = process.env.HARNESSMAP_USERS ?? '';
  const m = new Map<string, string>();
  for (const pair of raw.split(',')) {
    const i = pair.indexOf(':');
    if (i > 0) m.set(pair.slice(0, i).trim(), pair.slice(i + 1)); // password may contain colons
  }
  return m;
}

const USERS = parseUsers();
export const authEnabled = USERS.size > 0;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // still burn a comparison to keep timing flat
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

// Returns the authenticated username, or null if the request is not authorized.
export function authUser(req: Request): string | null {
  if (!authEnabled) return 'dev';
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Basic ')) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const i = decoded.indexOf(':');
  if (i < 0) return null;
  const user = decoded.slice(0, i);
  const pass = decoded.slice(i + 1);
  const expected = USERS.get(user);
  if (expected === undefined) {
    safeEqual(pass, pass); // constant-ish work for unknown users
    return null;
  }
  return safeEqual(pass, expected) ? user : null;
}

export function unauthorized(): Response {
  return new Response('authentication required', {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="harnessmap", charset="UTF-8"' },
  });
}
