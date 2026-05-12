import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import type { PrismaClient } from '../generated/prisma/client';
import type { RegisterBody, AuthResponse } from './types';

const scryptAsync = promisify(scrypt);

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

  return {
    token,
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

  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, organizationId: user.organizationId },
  };
}
