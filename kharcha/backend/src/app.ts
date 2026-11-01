import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { verifyToken } from './auth/auth.js';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { accountRoutes } from './routes/account.js';
import { authRoutes } from './routes/auth.js';
import { importRoutes } from './routes/import.js';
import { ingestRoutes } from './routes/ingest.js';
import { insightRoutes } from './routes/insights.js';
import { planRoutes } from './routes/plan.js';
import { transactionRoutes } from './routes/transactions.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: number;
  }
}

export interface AppDeps {
  pool: Pool;
  config: Config;
}

export async function buildApp(deps: AppDeps, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const { config, pool } = deps;
  const app = Fastify({
    logger: opts.logger ?? true,
    trustProxy: true, // behind Render/Fly load balancers; needed for per-IP rate limits
    bodyLimit: 64 * 1024,
  });

  if (config.corsOrigins.length) await app.register(cors, { origin: config.corsOrigins });
  await app.register(rateLimit, { global: false });

  // Some SMS forwarders post form-encoded bodies.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({ error: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request' });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'Something went wrong' : (err as Error).message });
  });

  app.get('/api/health', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  await authRoutes(app, deps);
  await ingestRoutes(app, deps);

  // Everything registered inside this plugin requires a valid JWT.
  await app.register(async (secured) => {
    secured.decorateRequest('userId', 0);
    secured.addHook('onRequest', async (req, reply) => {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      const userId = token ? await verifyToken(token, config.jwtSecret) : null;
      if (!userId) return reply.code(401).send({ error: 'Please log in again' });
      req.userId = userId;
    });
    await transactionRoutes(secured, deps);
    await insightRoutes(secured, deps);
    await accountRoutes(secured, deps);
    await planRoutes(secured, deps);
    await importRoutes(secured, deps);
  });

  // Serve the built React app from the same origin: one deploy, no CORS.
  if (existsSync(config.webDir)) {
    await app.register(fastifyStatic, { root: config.webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}
