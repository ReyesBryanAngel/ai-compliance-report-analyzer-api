import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

const prismaPlugin: FastifyPluginAsync = fp(async (server) => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    // pg defaults to max: 10, which is too small once report/parse queue workers and concurrent
    // HTTP traffic share the same pool. Sized explicitly and overridable per-deployment/replica.
    max: Number(process.env.DATABASE_POOL_MAX) || 20,
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  await prisma.$connect();

  server.decorate('prisma', prisma);

  server.addHook('onClose', async (instance) => {
    await instance.prisma.$disconnect();
    await pool.end();
  });
});

export default prismaPlugin;
