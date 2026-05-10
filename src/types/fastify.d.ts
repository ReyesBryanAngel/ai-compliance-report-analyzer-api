import 'fastify';

declare module 'fastify' {
  interface FastifySchema {
    tags?: string[];
    summary?: string;
    description?: string;
    consumes?: string[];
    produces?: string[];
  }
}
