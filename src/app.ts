import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import prismaPlugin from './plugins/prisma';
import authPlugin from './plugins/auth';
import { registerRoutes } from './routes';

export async function buildApp(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
    },
  });

  await server.register(helmet);
  await server.register(cors, {
    origin: process.env.NODE_ENV === 'production' ? false : true,
  });
  await server.register(sensible);
  await server.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10 MB per file
      files: 10,                   // max 10 files per request
    },
  });
  await server.register(prismaPlugin);
  await server.register(authPlugin);

  await registerRoutes(server);

  return server;
}
