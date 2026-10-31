import { createHmac } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const COOKIE = 'blog_session';
const cookieOptions = 'Path=/; HttpOnly; Secure; SameSite=Strict';

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || Buffer.byteLength(value) < 32) throw new Error('SESSION_SECRET must contain at least 32 bytes.');
  return new TextEncoder().encode(value);
}

export async function createSession(): Promise<string> {
  return new SignJWT({ role: 'owner' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret());
}

export async function isAuthenticated(cookieHeader = ''): Promise<boolean> {
  const token = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.role === 'owner';
  } catch {
    return false;
  }
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; ${cookieOptions}; Max-Age=604800`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; ${cookieOptions}; Max-Age=0`;
}

export function hashIp(ip: string): string {
  return createHmac('sha256', secret()).update(ip).digest('hex');
}
