import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword, signToken, verifyPassword } from '../auth/auth.js';
import type { AppDeps } from '../app.js';
import { IncomeFields, parseIncome } from './plan.js';

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().trim().max(100).optional(),
});

// Income is optional for API clients (e.g. the seed script); the signup page always sends it.
const Register = Credentials.extend({
  incomeType: IncomeFields.incomeType.optional(),
  monthlyIncome: IncomeFields.monthlyIncome.optional(),
  savingsGoal: IncomeFields.savingsGoal,
}).refine((b) => (b.incomeType === undefined) === (b.monthlyIncome === undefined), {
  message: 'send incomeType and monthlyIncome together',
  path: ['monthlyIncome'],
});

// A real hash to compare against when the email doesn't exist, so response time doesn't reveal which emails are registered.
const DUMMY_HASH = await hashPassword('timing-equaliser-not-a-real-password');

export async function authRoutes(app: FastifyInstance, { pool, config }: AppDeps) {
  const limited = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/api/auth/register', limited, async (req, reply) => {
    if (!config.allowSignup) return reply.code(403).send({ error: 'Sign-ups are disabled on this server' });
    const body = Register.parse(req.body);
    const income = body.monthlyIncome === undefined ? null : parseIncome({ monthlyIncome: body.monthlyIncome, savingsGoal: body.savingsGoal });
    const hash = await hashPassword(body.password);
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO users (email, name, password_hash, income_type, monthly_income_paise, savings_goal_paise)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [body.email, body.name ?? '', hash, body.incomeType ?? null, income?.incomePaise ?? null, income?.goalPaise ?? null],
    );
    if (!rows[0]) return reply.code(409).send({ error: 'An account with this email already exists' });
    return reply.code(201).send({ token: await signToken(rows[0].id, config.jwtSecret) });
  });

  app.post('/api/auth/login', limited, async (req, reply) => {
    const body = Credentials.pick({ email: true, password: true }).parse(req.body);
    const { rows } = await pool.query<{ id: number; password_hash: string }>(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [body.email],
    );
    const user = rows[0];
    const ok = await verifyPassword(body.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) return reply.code(401).send({ error: 'Wrong email or password' });
    return { token: await signToken(user.id, config.jwtSecret) };
  });

  app.get('/api/auth/config', async () => ({ allowSignup: config.allowSignup }));
}
