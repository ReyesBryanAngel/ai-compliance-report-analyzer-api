import { FastifyInstance } from 'fastify';
import healthRoutes from './health';
import documentRoutes from '../documents/routes';

export async function registerRoutes(server: FastifyInstance): Promise<void> {
  server.register(healthRoutes, { prefix: '/api/v1' });
  server.register(documentRoutes, { prefix: '/api/v1/documents' });
}
