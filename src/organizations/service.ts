import type { PrismaClient } from '../generated/prisma/client';
import type { OrganizationItem, CreateOrganizationBody } from './types';

function toItem(org: { id: string; name: string; slug: string; createdAt: Date }): OrganizationItem {
  return { id: org.id, name: org.name, slug: org.slug, createdAt: org.createdAt.toISOString() };
}

export async function listOrganizations(prisma: PrismaClient): Promise<OrganizationItem[]> {
  const orgs = await prisma.organization.findMany({ orderBy: { name: 'asc' } });
  return orgs.map(toItem);
}

export async function getOrganization(id: string, prisma: PrismaClient): Promise<OrganizationItem> {
  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) throw Object.assign(new Error(`Organization not found: ${id}`), { code: 'NOT_FOUND' });
  return toItem(org);
}

export async function createOrganization(
  body: CreateOrganizationBody,
  prisma: PrismaClient,
): Promise<OrganizationItem> {
  const slug = body.slug ?? body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const exists = await prisma.organization.findUnique({ where: { slug } });
  if (exists) {
    throw Object.assign(new Error(`Organization slug already taken: ${slug}`), { code: 'CONFLICT' });
  }

  const org = await prisma.organization.create({ data: { name: body.name, slug } });
  return toItem(org);
}
