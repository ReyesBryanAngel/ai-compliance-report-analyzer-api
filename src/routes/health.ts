import { FastifyPluginAsync } from 'fastify';

const healthRoutes: FastifyPluginAsync = async (server) => {
  server.get('/health', {
    schema: {
      tags: ['Health'],
      summary: 'Health check',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            uptime: { type: 'number' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  server.get('/health/db', {
    schema: {
      tags: ['Health'],
      summary: 'Database health check',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            database: { type: 'string' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    await server.prisma.$queryRaw`SELECT 1`;
    return reply.send({ status: 'ok', database: 'connected' });
  });
};

export default healthRoutes;
