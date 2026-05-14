import type { FastifyError, FastifyInstance } from 'fastify';
import { ERROR_CODES } from '@dealflow/shared';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, _req, reply) => {
    const status = error.statusCode ?? 500;

    if (status >= 500) {
      app.log.error({ err: error }, 'Unhandled error');
      return reply.status(500).send({
        error: { code: ERROR_CODES.INTERNAL, message: 'Internal server error' },
      });
    }

    if (error.validation) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: error.message,
          details: error.validation,
        },
      });
    }

    return reply.status(status).send({
      error: {
        code: error.code ?? ERROR_CODES.INTERNAL,
        message: error.message,
      },
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Route not found' },
    });
  });
}
