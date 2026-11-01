import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sha256 } from '../auth/auth.js';
import type { AppDeps } from '../app.js';
import { withTx } from '../db.js';
import { INGEST_QUEUE } from '../ingest/process.js';
import { looksTransactional } from '../parser/sms.js';
import { enqueue } from '../queue/queue.js';

/**
 * Accepts the JSON that common Android SMS-forwarder apps send, e.g.
 *   {"from":"%from%","text":"%text%","receivedStamp":%receivedStamp%}
 * Field names are flexible so most forwarders work without custom templates.
 */
const SmsBody = z
  .object({
    from: z.string().optional(),
    sender: z.string().optional(),
    text: z.string().optional(),
    body: z.string().optional(),
    message: z.string().optional(),
    receivedStamp: z.union([z.number(), z.string()]).optional(),
    sentStamp: z.union([z.number(), z.string()]).optional(),
    receivedAt: z.string().optional(),
    timestamp: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

function pickTime(b: z.infer<typeof SmsBody>): Date {
  for (const v of [b.receivedAt, b.receivedStamp, b.timestamp, b.sentStamp]) {
    if (v === undefined || v === '') continue;
    const n = typeof v === 'number' ? v : /^\d+$/.test(v) ? Number(v) : NaN;
    const d = Number.isNaN(n) ? new Date(String(v)) : new Date(n < 1e12 ? n * 1000 : n); // seconds or ms
    if (!Number.isNaN(d.getTime()) && Math.abs(d.getTime() - Date.now()) < 400 * 86_400_000) return d;
  }
  return new Date();
}

export async function ingestRoutes(app: FastifyInstance, { pool }: AppDeps) {
  app.post(
    '/api/ingest/sms',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const header = req.headers['authorization']?.replace(/^Bearer\s+/i, '') ?? req.headers['x-kharcha-token'];
      const token = (typeof header === 'string' && header) || (req.query as Record<string, string>)['token'];
      if (!token) return reply.code(401).send({ error: 'missing ingest token' });

      const user = (await pool.query<{ id: number }>('SELECT id FROM users WHERE ingest_token_hash = $1', [sha256(token)])).rows[0];
      if (!user) return reply.code(401).send({ error: 'invalid ingest token' });

      const b = SmsBody.parse(req.body ?? {});
      const sender = (b.from ?? b.sender ?? '').slice(0, 64);
      const text = (b.text ?? b.body ?? b.message ?? '').slice(0, 2000);
      if (!text.trim()) return reply.code(400).send({ error: 'no message text' });

      // Privacy: personal SMS never touch the database.
      if (!looksTransactional(text)) return reply.code(200).send({ status: 'ignored', reason: 'not a bank transaction' });

      const receivedAt = pickTime(b);
      const result = await withTx(pool, async (c) => {
        const ins = await c.query<{ id: number }>(
          `INSERT INTO raw_messages (user_id, source, sender, body, body_hash, received_at)
           VALUES ($1, 'sms', $2, $3, $4, $5)
           ON CONFLICT (user_id, body_hash) DO NOTHING RETURNING id`,
          [user.id, sender, text, sha256(`${sender}\n${text}`), receivedAt],
        );
        const id = ins.rows[0]?.id;
        if (!id) return null;
        // Same transaction as the insert: the job exists if and only if the message was stored.
        await enqueue(c, INGEST_QUEUE, { rawMessageId: id });
        return id;
      });

      if (result === null) return reply.code(200).send({ status: 'duplicate' });
      return reply.code(202).send({ status: 'queued', rawMessageId: result });
    },
  );
}
