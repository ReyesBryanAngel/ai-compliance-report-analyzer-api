import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import prismaPlugin from './plugins/prisma';
import parseQueuePlugin from './plugins/parse-queue';
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
    // origin: process.env.NODE_ENV === 'production' ? false : true,
    origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  });
  await server.register(sensible);
  await server.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10 MB per file
      files: 10,                   // max 10 files per request
    },
  });
  await server.register(prismaPlugin);
  await server.register(parseQueuePlugin);
  await server.register(authPlugin);

  await registerRoutes(server);

  return server;
}
