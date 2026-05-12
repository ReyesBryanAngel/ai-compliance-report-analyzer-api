import type { FastifyPluginAsync } from 'fastify';
import { register, login } from './service';
import type { RegisterBody, LoginBody, AuthResponse } from './types';

const userSchema = {
  type: 'object',
  properties: {
    id:             { type: 'string' },
    email:          { type: 'string' },
    name:           { type: 'string', nullable: true },
    organizationId: { type: 'string', nullable: true },
  },
};

const authResponseSchema = {
  type: 'object',
  properties: {
    token: { type: 'string' },
    user:  userSchema,
  },
};

const authRoutes: FastifyPluginAsync = async (server) => {
  server.post<{ Body: RegisterBody; Reply: AuthResponse }>('/register', {
    schema: {
      tags: ['Auth'],
      summary: 'Register a new user',
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:            { type: 'string', format: 'email' },
          password:         { type: 'string', minLength: 8 },
          name:             { type: 'string' },
          organizationId:   { type: 'string', format: 'uuid', description: 'Join an existing organization' },
          organizationName: { type: 'string', description: 'Create a new organization with this name' },
        },
      },
      response: { 201: authResponseSchema },
    },
  }, async (request, reply) => {
    try {
      const result = await register(request.body, server.prisma, (p) => server.jwt.sign(p));
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof Error) {
        const code = (err as NodeJS.ErrnoException & { code?: string }).code;
        if (code === 'CONFLICT') return reply.conflict(err.message);
        if (code === 'NOT_FOUND') return reply.notFound(err.message);
      }
      throw err;
    }
  });

  server.post<{ Body: LoginBody; Reply: AuthResponse }>('/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login and receive a JWT',
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      },
      response: { 200: authResponseSchema },
    },
  }, async (request, reply) => {
    try {
      const { email, password } = request.body;
      const result = await login(email, password, server.prisma, (p) => server.jwt.sign(p));
      return reply.send(result);
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === 'UNAUTHORIZED') {
        return reply.unauthorized(err.message);
      }
      throw err;
    }
  });
};

export default authRoutes;
