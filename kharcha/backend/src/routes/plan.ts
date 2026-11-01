import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { withTx, type Queryable } from '../db.js';
import { toPaise } from '../lib/money.js';
import { suggestBudgets } from '../lib/plan.js';

const Amount = z.union([z.string(), z.number()]);

export const IncomeFields = {
  incomeType: z.enum(['salary', 'allowance']),
  monthlyIncome: Amount,
  /** Empty / 0 means no goal. */
  savingsGoal: Amount.nullable().optional(),
};

/** Throws a 400 instead of a 500 when an amount doesn't parse. */
export function parseIncome(b: { monthlyIncome: string | number; savingsGoal?: string | number | null }) {
  try {
    const goal = b.savingsGoal === null || b.savingsGoal === undefined || b.savingsGoal === '' || Number(b.savingsGoal) === 0
      ? null
      : toPaise(b.savingsGoal);
    return { incomePaise: toPaise(b.monthlyIncome), goalPaise: goal };
  } catch {
    throw Object.assign(new Error('Enter amounts like 25000 or 1500.50'), { statusCode: 400 });
  }
}

/**
 * Usual monthly spend per category: the average over the last 3 complete
 * months that had any spending, or this month so far for a brand-new user.
 */
async function usualSpend(db: Queryable, userId: number, tz: string) {
  const { rows } = await db.query<{ category: string; total: number; months: number }>(
    `WITH monthly AS (
       SELECT date_trunc('month', occurred_at AT TIME ZONE $2) AS month, category, SUM(amount_paise) AS spent
         FROM transactions
        WHERE user_id = $1 AND direction = 'debit'
          AND occurred_at >= (date_trunc('month', now() AT TIME ZONE $2) - interval '3 months') AT TIME ZONE $2
          AND occurred_at <  date_trunc('month', now() AT TIME ZONE $2) AT TIME ZONE $2
        GROUP BY 1, 2
     )
     SELECT category, SUM(spent)::bigint AS total, (SELECT COUNT(DISTINCT month) FROM monthly)::int AS months
       FROM monthly GROUP BY category`,
    [userId, tz],
  );
  const months = rows[0]?.months ?? 0;
  if (months > 0) {
    return { basis: 'history' as const, months, usual: new Map(rows.map((r) => [r.category, Math.round(r.total / months)])) };
  }
  const now = await db.query<{ category: string; total: number }>(
    `SELECT category, SUM(amount_paise)::bigint AS total FROM transactions
      WHERE user_id = $1 AND direction = 'debit'
        AND occurred_at >= date_trunc('month', now() AT TIME ZONE $2) AT TIME ZONE $2
      GROUP BY category`,
    [userId, tz],
  );
  return { basis: 'this-month' as const, months: 0, usual: new Map(now.rows.map((r) => [r.category, r.total])) };
}

async function buildPlan(db: Queryable, userId: number, tz: string) {
  const { rows } = await db.query<{ income_type: string | null; monthly_income_paise: number | null; savings_goal_paise: number | null }>(
    'SELECT income_type, monthly_income_paise, savings_goal_paise FROM users WHERE id = $1',
    [userId],
  );
  const u = rows[0]!;
  const base = { incomeType: u.income_type, monthlyIncomePaise: u.monthly_income_paise, savingsGoalPaise: u.savings_goal_paise };
  if (!u.monthly_income_paise) return { ...base, basis: null, months: 0, suggestion: null };
  const { basis, months, usual } = await usualSpend(db, userId, tz);
  return { ...base, basis, months, suggestion: suggestBudgets(u.monthly_income_paise, u.savings_goal_paise ?? 0, usual) };
}

export async function planRoutes(app: FastifyInstance, { pool, config }: AppDeps) {
  app.get('/api/plan', async (req) => buildPlan(pool, req.userId, config.tz));

  app.put('/api/plan', async (req) => {
    const b = z.object(IncomeFields).parse(req.body);
    const { incomePaise, goalPaise } = parseIncome(b);
    await pool.query(
      'UPDATE users SET income_type = $2, monthly_income_paise = $3, savings_goal_paise = $4 WHERE id = $1',
      [req.userId, b.incomeType, incomePaise, goalPaise],
    );
    return buildPlan(pool, req.userId, config.tz);
  });

  /** Saves the suggested budgets (other categories' budgets are left alone). */
  app.post('/api/plan/apply', async (req, reply) => {
    return withTx(pool, async (c) => {
      const plan = await buildPlan(c, req.userId, config.tz);
      if (!plan.suggestion?.feasible) return reply.code(409).send({ error: 'This savings goal is out of reach. Lower it first.' });
      const items = plan.suggestion.items.filter((i) => i.budgetPaise > 0);
      for (const i of items) {
        await c.query(
          `INSERT INTO budgets (user_id, category, monthly_limit_paise) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, category) DO UPDATE SET monthly_limit_paise = EXCLUDED.monthly_limit_paise`,
          [req.userId, i.category, i.budgetPaise],
        );
      }
      return { applied: items.length };
    });
  });
}
