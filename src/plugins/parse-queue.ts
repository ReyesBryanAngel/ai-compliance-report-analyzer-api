import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { ParseQueueWorker } from '../documents/parse-queue';

declare module 'fastify' {
  interface FastifyInstance {
    parseQueue: ParseQueueWorker;
  }
}

const parseQueuePlugin: FastifyPluginAsync = fp(async (server) => {
  const worker = new ParseQueueWorker();

  server.decorate('parseQueue', worker);

  server.addHook('onReady', async () => {
    await worker.start(server.prisma);
    server.log.info('[ParseQueue] Worker started');
  });

  server.addHook('onClose', async () => {
    await worker.stop();
    server.log.info('[ParseQueue] Worker stopped');
  });
});

export default parseQueuePlugin;
