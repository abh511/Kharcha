import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { localDate, toPaise } from '../lib/money.js';
import { CATEGORIES } from '../parser/categorize.js';
import { Month } from './transactions.js';

const BudgetBody = z.object({
  category: z.string().trim().min(1).max(40),
  /** 0 / empty removes the budget */
  limit: z.union([z.string(), z.number()]).nullable(),
});

export async function insightRoutes(app: FastifyInstance, { pool, config }: AppDeps) {
  app.get('/api/summary', async (req) => {
    const { month } = z.object({ month: Month.optional() }).parse(req.query);
    const m = month ?? localDate(new Date(), config.tz).slice(0, 7);
    const start = `${m}-01`;
    const args = [req.userId, start, config.tz];
    // All bounds are computed in the user's timezone, so "October" means October in IST.
    const inMonth = `t.user_id = $1
      AND t.occurred_at >= ($2::date)::timestamp AT TIME ZONE $3
      AND t.occurred_at <  (($2::date) + interval '1 month')::timestamp AT TIME ZONE $3`;

    const [totals, byCategory, daily, merchants, previous, budgets] = await Promise.all([
      pool.query<{ spent: number; received: number; count: number }>(
        `SELECT COALESCE(SUM(amount_paise) FILTER (WHERE direction = 'debit'), 0)::bigint AS spent,
                COALESCE(SUM(amount_paise) FILTER (WHERE direction = 'credit'), 0)::bigint AS received,
                COUNT(*)::bigint AS count
           FROM transactions t WHERE ${inMonth}`, args),
      pool.query<{ category: string; spent: number; count: number }>(
        `SELECT category, SUM(amount_paise)::bigint AS spent, COUNT(*)::bigint AS count
           FROM transactions t WHERE ${inMonth} AND direction = 'debit'
          GROUP BY category ORDER BY spent DESC`, args),
      pool.query<{ day: string; spent: number }>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(SUM(t.amount_paise), 0)::bigint AS spent
           FROM generate_series($2::date, ($2::date + interval '1 month' - interval '1 day'), interval '1 day') d
           LEFT JOIN transactions t
             ON t.user_id = $1 AND t.direction = 'debit' AND (t.occurred_at AT TIME ZONE $3)::date = d::date
          GROUP BY d ORDER BY d`, args),
      pool.query<{ merchant: string; spent: number; count: number }>(
        `SELECT merchant, SUM(amount_paise)::bigint AS spent, COUNT(*)::bigint AS count
           FROM transactions t WHERE ${inMonth} AND direction = 'debit'
          GROUP BY merchant ORDER BY spent DESC LIMIT 6`, args),
      pool.query<{ spent: number }>(
        `SELECT COALESCE(SUM(amount_paise), 0)::bigint AS spent FROM transactions t
          WHERE t.user_id = $1 AND direction = 'debit'
            AND t.occurred_at >= (($2::date) - interval '1 month')::timestamp AT TIME ZONE $3
            AND t.occurred_at <  ($2::date)::timestamp AT TIME ZONE $3`, args),
      pool.query<{ category: string; limit_paise: number; spent: number }>(
        `SELECT b.category, b.monthly_limit_paise AS limit_paise, COALESCE(s.spent, 0)::bigint AS spent
           FROM budgets b
           LEFT JOIN (SELECT category, SUM(amount_paise) AS spent FROM transactions t
                       WHERE ${inMonth} AND direction = 'debit' GROUP BY category) s USING (category)
          WHERE b.user_id = $1 ORDER BY b.category`, args),
    ]);

    const t = totals.rows[0]!;
    return {
      month: m,
      spentPaise: t.spent,
      receivedPaise: t.received,
      count: t.count,
      previousMonthSpentPaise: previous.rows[0]!.spent,
      byCategory: byCategory.rows.map((r) => ({ category: r.category, spentPaise: r.spent, count: r.count })),
      daily: daily.rows.map((r) => ({ date: r.day, spentPaise: r.spent })),
      topMerchants: merchants.rows.map((r) => ({ merchant: r.merchant, spentPaise: r.spent, count: r.count })),
      budgets: budgets.rows.map((r) => ({ category: r.category, limitPaise: r.limit_paise, spentPaise: r.spent })),
    };
  });

  app.get('/api/budgets', async (req) => {
    const { rows } = await pool.query<{ category: string; monthly_limit_paise: number }>(
      'SELECT category, monthly_limit_paise FROM budgets WHERE user_id = $1 ORDER BY category',
      [req.userId],
    );
    return rows.map((r) => ({ category: r.category, limitPaise: r.monthly_limit_paise }));
  });

  app.put('/api/budgets', async (req, reply) => {
    const b = BudgetBody.parse(req.body);
    if (b.limit === null || b.limit === '' || Number(b.limit) === 0) {
      await pool.query('DELETE FROM budgets WHERE user_id = $1 AND category = $2', [req.userId, b.category]);
      return { category: b.category, limitPaise: null };
    }
    let limitPaise: number;
    try {
      limitPaise = toPaise(b.limit);
    } catch {
      return reply.code(400).send({ error: 'Enter a valid amount' });
    }
    await pool.query(
      `INSERT INTO budgets (user_id, category, monthly_limit_paise) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, category) DO UPDATE SET monthly_limit_paise = EXCLUDED.monthly_limit_paise`,
      [req.userId, b.category, limitPaise],
    );
    return { category: b.category, limitPaise };
  });

  app.get('/api/categories', async (req) => {
    const { rows } = await pool.query<{ category: string }>(
      'SELECT DISTINCT category FROM transactions WHERE user_id = $1',
      [req.userId],
    );
    const all = new Set<string>(CATEGORIES);
    for (const r of rows) all.add(r.category);
    return [...all];
  });
}
