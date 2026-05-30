import { scrypt, randomBytes, timingSafeEqual, createHash } from 'crypto';
import { promisify } from 'util';
import type { PrismaClient } from '../generated/prisma/client';
import type { RegisterBody, AuthResponse } from './types';

const scryptAsync = promisify(scrypt);

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  const hashBuffer = Buffer.from(hash, 'hex');
  const supplied = (await scryptAsync(password, salt, 64)) as Buffer;
  return timingSafeEqual(hashBuffer, supplied);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function createRefreshToken(userId: string, prisma: PrismaClient): Promise<string> {
  const raw = randomBytes(64).toString('hex');
  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(raw),
      userId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  return raw;
}

export async function register(
  body: RegisterBody,
  prisma: PrismaClient,
  signJwt: (payload: { sub: string; organizationId: string; email: string }) => string,
): Promise<AuthResponse> {
  const { email, password, name, organizationId, organizationName } = body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw Object.assign(new Error('Email already registered'), { code: 'CONFLICT' });
  }

  let resolvedOrgId: string | null = null;

  if (organizationId) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) {
      throw Object.assign(new Error(`Organization not found: ${organizationId}`), { code: 'NOT_FOUND' });
    }
    resolvedOrgId = org.id;
  } else if (organizationName) {
    const slug = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const org = await prisma.organization.create({
      data: { name: organizationName, slug },
    });
    resolvedOrgId = org.id;
  }

  const hashed = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, password: hashed, name: name ?? null, organizationId: resolvedOrgId },
  });

  const token = signJwt({ sub: user.id, organizationId: user.organizationId ?? '', email: user.email });
  const refreshToken = await createRefreshToken(user.id, prisma);

  return {
    token,
    refreshToken,
    user: { id: user.id, email: user.email, name: user.name, organizationId: user.organizationId },
  };
}

export async function login(
  email: string,
  password: string,
  prisma: PrismaClient,
  signJwt: (payload: { sub: string; organizationId: string; email: string }) => string,
): Promise<AuthResponse> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw Object.assign(new Error('Invalid credentials'), { code: 'UNAUTHORIZED' });
  }

  const valid = await verifyPassword(password, user.password);
  if (!valid) {
    throw Object.assign(new Error('Invalid credentials'), { code: 'UNAUTHORIZED' });
  }

  const token = signJwt({ sub: user.id, organizationId: user.organizationId ?? '', email: user.email });
  const refreshToken = await createRefreshToken(user.id, prisma);

  return {
    token,
    refreshToken,
    user: { id: user.id, email: user.email, name: user.name, organizationId: user.organizationId },
  };
}

export async function refresh(
  rawToken: string,
  prisma: PrismaClient,
  signJwt: (payload: { sub: string; organizationId: string; email: string }) => string,
): Promise<AuthResponse> {
  const tokenHash = hashToken(rawToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw Object.assign(new Error('Invalid or expired refresh token'), { code: 'UNAUTHORIZED' });
  }

  // Revoke the used token (rotation — prevents replay)
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const { user } = stored;
  const token = signJwt({ sub: user.id, organizationId: user.organizationId ?? '', email: user.email });
  const refreshToken = await createRefreshToken(user.id, prisma);

  return {
    token,
    refreshToken,
    user: { id: user.id, email: user.email, name: user.name, organizationId: user.organizationId },
  };
}
