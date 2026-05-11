import { FastifyInstance } from 'fastify';
import healthRoutes from './health';
import documentRoutes from '../documents/routes';
import reportRoutes from '../reports/routes';
import thresholdRoutes from '../thresholds/routes';
import workflowRoutes from '../workflows/routes';

export async function registerRoutes(server: FastifyInstance): Promise<void> {
  server.register(healthRoutes, { prefix: '/api/v1' });
  server.register(documentRoutes, { prefix: '/api/v1/documents' });
  server.register(reportRoutes, { prefix: '/api/v1/reports' });
  server.register(thresholdRoutes, { prefix: '/api/v1/thresholds' });
  server.register(workflowRoutes, { prefix: '/api/v1/workflows' });
}
