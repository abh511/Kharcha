import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { withTx } from '../db.js';
import { toPaise } from '../lib/money.js';
import { categorize, rulePatternFor, type UserRule } from '../parser/categorize.js';

export const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM');

const ListQuery = z.object({
  month: Month.optional(),
  category: z.string().max(40).optional(),
  direction: z.enum(['debit', 'credit']).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

const Manual = z.object({
  amount: z.union([z.string(), z.number()]),
  direction: z.enum(['debit', 'credit']).default('debit'),
  merchant: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(40).optional(),
  note: z.string().max(500).optional(),
  occurredAt: z.coerce.date().optional(),
});

const Patch = z.object({
  category: z.string().trim().min(1).max(40).optional(),
  merchant: z.string().trim().min(1).max(100).optional(),
  note: z.string().max(500).optional(),
  /** Also re-categorise past transactions from this merchant and remember it for future ones. */
  applyToSimilar: z.boolean().optional(),
});

const IdParam = z.object({ id: z.coerce.number().int().positive() });

export interface TxnRow {
  id: number;
  amount_paise: number;
  direction: 'debit' | 'credit';
  merchant: string;
  vpa: string | null;
  category: string;
  bank: string | null;
  account_last4: string | null;
  upi_ref: string | null;
  source: string;
  note: string;
  occurred_at: Date;
}

const COLUMNS = 'id, amount_paise, direction, merchant, vpa, category, bank, account_last4, upi_ref, source, note, occurred_at';

export function toJson(r: TxnRow) {
  return {
    id: r.id,
    amountPaise: r.amount_paise,
    direction: r.direction,
    merchant: r.merchant,
    vpa: r.vpa,
    category: r.category,
    bank: r.bank,
    accountLast4: r.account_last4,
    upiRef: r.upi_ref,
    source: r.source,
    note: r.note,
    occurredAt: r.occurred_at.toISOString(),
  };
}

const encodeCursor = (r: TxnRow) => Buffer.from(JSON.stringify([r.occurred_at.toISOString(), r.id])).toString('base64url');
function decodeCursor(c: string): [string, number] {
  const v = JSON.parse(Buffer.from(c, 'base64url').toString());
  if (!Array.isArray(v) || typeof v[0] !== 'string' || typeof v[1] !== 'number') throw new Error('bad cursor');
  return [v[0], v[1]];
}

export async function transactionRoutes(app: FastifyInstance, { pool, config }: AppDeps) {
  // Keyset pagination on (occurred_at, id): stable and O(limit) no matter how deep you scroll.
  app.get('/api/transactions', async (req) => {
    const q = ListQuery.parse(req.query);
    const where: string[] = ['user_id = $1'];
    const params: unknown[] = [req.userId];
    const add = (sql: string, ...vals: unknown[]) => {
      let s = sql;
      for (const v of vals) {
        params.push(v);
        s = s.replace('?', `$${params.length}`);
      }
      where.push(s);
    };
    if (q.month) {
      add(`occurred_at >= (?::date)::timestamp AT TIME ZONE ?`, `${q.month}-01`, config.tz);
      add(`occurred_at < ((?::date) + interval '1 month')::timestamp AT TIME ZONE ?`, `${q.month}-01`, config.tz);
    }
    if (q.category) add('category = ?', q.category);
    if (q.direction) add('direction = ?', q.direction);
    if (q.q) add(`(merchant ILIKE ? OR vpa ILIKE ? OR note ILIKE ?)`, ...Array(3).fill(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`));
    if (q.cursor) {
      const [at, id] = decodeCursor(q.cursor);
      add('(occurred_at, id) < (?::timestamptz, ?)', at, id);
    }
    params.push(q.limit + 1);
    const { rows } = await pool.query<TxnRow>(
      `SELECT ${COLUMNS} FROM transactions WHERE ${where.join(' AND ')}
       ORDER BY occurred_at DESC, id DESC LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, q.limit);
    return { items: page.map(toJson), nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1]!) : null };
  });

  app.post('/api/transactions', async (req, reply) => {
    const b = Manual.parse(req.body);
    let amountPaise: number;
    try {
      amountPaise = toPaise(b.amount);
    } catch {
      return reply.code(400).send({ error: 'Enter a valid amount, like 250 or 99.50' });
    }
    const rules = (await pool.query<UserRule>('SELECT pattern, category FROM category_rules WHERE user_id = $1', [req.userId])).rows;
    const category = b.category ?? categorize({ merchant: b.merchant, vpa: null, direction: b.direction }, rules);
    const { rows } = await pool.query<TxnRow>(
      `INSERT INTO transactions (user_id, amount_paise, direction, merchant, category, source, note, occurred_at, dedup_key)
       VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7, $8) RETURNING ${COLUMNS}`,
      [req.userId, amountPaise, b.direction, b.merchant, category, b.note ?? '', b.occurredAt ?? new Date(), `manual:${randomUUID()}`],
    );
    return reply.code(201).send(toJson(rows[0]!));
  });

  app.patch('/api/transactions/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const b = Patch.parse(req.body);
    const out = await withTx(pool, async (c) => {
      const { rows } = await c.query<TxnRow>(
        `UPDATE transactions SET
           category = COALESCE($3, category), merchant = COALESCE($4, merchant),
           note = COALESCE($5, note), updated_at = now()
         WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
        [id, req.userId, b.category ?? null, b.merchant ?? null, b.note ?? null],
      );
      const txn = rows[0];
      if (!txn) return null;
      let updatedSimilar = 0;
      if (b.applyToSimilar && b.category) {
        const pattern = rulePatternFor(txn.merchant, txn.vpa);
        await c.query(
          `INSERT INTO category_rules (user_id, pattern, category) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, pattern) DO UPDATE SET category = EXCLUDED.category`,
          [req.userId, pattern, b.category],
        );
        const r = await c.query(
          `UPDATE transactions SET category = $3, updated_at = now()
           WHERE user_id = $1 AND id <> $4 AND direction = $5
             AND (lower(coalesce(vpa, '')) = $2 OR lower(merchant) = $2)`,
          [req.userId, pattern, b.category, id, txn.direction],
        );
        updatedSimilar = r.rowCount ?? 0;
      }
      return { transaction: toJson(txn), updatedSimilar };
    });
    if (!out) return reply.code(404).send({ error: 'Transaction not found' });
    return out;
  });

  app.delete('/api/transactions/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const r = await pool.query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [id, req.userId]);
    return r.rowCount ? reply.code(204).send() : reply.code(404).send({ error: 'Transaction not found' });
  });

  app.get('/api/export.csv', async (req, reply) => {
    const { rows } = await pool.query<TxnRow>(
      `SELECT ${COLUMNS} FROM transactions WHERE user_id = $1 ORDER BY occurred_at DESC, id DESC`,
      [req.userId],
    );
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      // Quote, and neutralise spreadsheet formula injection.
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = ['date,direction,amount,merchant,category,vpa,bank,account,upi_ref,source,note'];
    for (const r of rows) {
      lines.push([r.occurred_at.toISOString(), r.direction, (r.amount_paise / 100).toFixed(2), r.merchant, r.category, r.vpa,
        r.bank, r.account_last4, r.upi_ref, r.source, r.note].map(esc).join(','));
    }
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="kharcha-transactions.csv"')
      .send(lines.join('\n'));
  });
}
