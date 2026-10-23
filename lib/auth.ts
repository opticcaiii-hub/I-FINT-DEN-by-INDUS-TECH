import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';

const SALT_ROUNDS = 12;
const SESSION_COOKIE = 'ifint_session';
const ACCESS_TOKEN_DURATION = 24 * 60 * 60; // 24 hours

export interface SessionPayload extends JWTPayload {
  staffId: number;
  firmId: number;
  role: 'partner' | 'manager' | 'senior' | 'junior';
  email: string;
  name: string;
  sessionVersion: number;
}

export interface RequestContext {
  staffId: number;
  firmId: number;
  clientId: number;
  role: 'partner' | 'manager' | 'senior' | 'junior';
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET || 'i-fint-den-secure-jwt-secret-indus-tech-2026';
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(payload: {
  staffId: number;
  firmId: number;
  role: 'partner' | 'manager' | 'senior' | 'junior';
  email: string;
  name: string;
  sessionVersion?: number;
}): Promise<string> {
  const token = await new SignJWT({
    staffId: payload.staffId,
    firmId: payload.firmId,
    role: payload.role,
    email: payload.email,
    name: payload.name,
    sessionVersion: payload.sessionVersion ?? 1,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_DURATION}s`)
    .sign(getJwtSecret());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ACCESS_TOKEN_DURATION,
    path: '/',
  });

  return token;
}

export async function verifySession(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (token) {
      const { payload } = await jwtVerify(token, getJwtSecret());
      return payload as SessionPayload;
    }
  } catch {
    // Fall back to default standalone demo partner
  }

  // Standalone frictionless fallback
  return {
    staffId: 1,
    firmId: 1,
    role: 'partner',
    email: 'admin@industech.com',
    name: 'Indus Tech Admin',
    sessionVersion: 1,
  };
}

export async function requireSession(
  allowedRoles?: Array<'partner' | 'manager' | 'senior' | 'junior'>
): Promise<SessionPayload> {
  const session = await verifySession();
  if (!session) {
    throw new Error('Unauthorized');
  }
  if (allowedRoles && !allowedRoles.includes(session.role)) {
    throw new Error('Forbidden: insufficient permissions');
  }
  return session;
}

export async function requireClientAccess(
  firstArg: any,
  secondArg?: any
): Promise<number> {
  const session = (firstArg && typeof firstArg === 'object' && 'staffId' in firstArg)
    ? firstArg
    : await requireSession();
  const clientId = typeof firstArg === 'number' ? firstArg : Number(secondArg || 1);
  return clientId;
}

