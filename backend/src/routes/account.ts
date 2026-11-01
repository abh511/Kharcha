import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newIngestToken } from '../auth/auth.js';
import type { AppDeps } from '../app.js';
import { INGEST_QUEUE } from '../ingest/process.js';
import { enqueue, queueStats, retryDead } from '../queue/queue.js';

const IdParam = z.object({ id: z.coerce.number().int().positive() });

export async function accountRoutes(app: FastifyInstance, { pool }: AppDeps) {
  app.get('/api/me', async (req) => {
    const { rows } = await pool.query<{ id: number; email: string; name: string; has_token: boolean }>(
      'SELECT id, email, name, ingest_token_hash IS NOT NULL AS has_token FROM users WHERE id = $1',
      [req.userId],
    );
    const u = rows[0]!;
    return { id: u.id, email: u.email, name: u.name, hasIngestToken: u.has_token };
  });

  /** Creates (or replaces) the secret your SMS forwarder uses. Shown once. */
  app.post('/api/me/ingest-token', async (req) => {
    const { token, hash } = newIngestToken();
    await pool.query('UPDATE users SET ingest_token_hash = $2 WHERE id = $1', [req.userId, hash]);
    return { token };
  });

  app.get('/api/rules', async (req) => {
    const { rows } = await pool.query(
      'SELECT id, pattern, category FROM category_rules WHERE user_id = $1 ORDER BY pattern',
      [req.userId],
    );
    return rows;
  });

  app.delete('/api/rules/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    await pool.query('DELETE FROM category_rules WHERE id = $1 AND user_id = $2', [id, req.userId]);
    return reply.code(204).send();
  });

  /** Recent inbound messages and what the parser decided — the place to debug an unparsed SMS. */
  app.get('/api/messages', async (req) => {
    const { status } = z.object({ status: z.enum(['queued', 'parsed', 'ignored', 'duplicate', 'failed']).optional() }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT id, sender, body, status, note, received_at AS "receivedAt"
         FROM raw_messages WHERE user_id = $1 AND ($2::text IS NULL OR status = $2)
        ORDER BY created_at DESC LIMIT 100`,
      [req.userId, status ?? null],
    );
    return rows;
  });

  app.post('/api/messages/:id/reparse', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const r = await pool.query(`UPDATE raw_messages SET status = 'queued', note = NULL WHERE id = $1 AND user_id = $2`, [id, req.userId]);
    if (!r.rowCount) return reply.code(404).send({ error: 'Message not found' });
    await enqueue(pool, INGEST_QUEUE, { rawMessageId: id });
    return reply.code(202).send({ status: 'queued' });
  });

  app.get('/api/jobs', async (req) => {
    const [stats, dead] = await Promise.all([
      queueStats(pool, req.userId),
      pool.query(
        `SELECT j.id, j.attempts, j.last_error AS "lastError", j.updated_at AS "updatedAt", m.body
           FROM jobs j JOIN raw_messages m ON m.id = (j.payload->>'rawMessageId')::bigint
          WHERE j.status = 'dead' AND m.user_id = $1
          ORDER BY j.updated_at DESC LIMIT 50`,
        [req.userId],
      ),
    ]);
    return { stats, dead: dead.rows };
  });

  app.post('/api/jobs/:id/retry', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const owned = await pool.query(
      `SELECT 1 FROM jobs j JOIN raw_messages m ON m.id = (j.payload->>'rawMessageId')::bigint
        WHERE j.id = $1 AND m.user_id = $2`,
      [id, req.userId],
    );
    if (!owned.rowCount || !(await retryDead(pool, id))) return reply.code(404).send({ error: 'No dead job with that id' });
    return reply.code(202).send({ status: 'queued' });
  });
}
