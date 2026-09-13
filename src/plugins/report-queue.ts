import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { ReportQueueWorker } from '../reports/report-queue';

declare module 'fastify' {
  interface FastifyInstance {
    reportQueue: ReportQueueWorker;
  }
}

const reportQueuePlugin: FastifyPluginAsync = fp(async (server) => {
  const worker = new ReportQueueWorker();

  server.decorate('reportQueue', worker);

  server.addHook('onReady', async () => {
    await worker.start(server.prisma);
    server.log.info('[ReportQueue] Worker started');
  });

  server.addHook('onClose', async () => {
    await worker.stop();
    server.log.info('[ReportQueue] Worker stopped');
  });
});

export default reportQueuePlugin;
