/**
 * End-to-end tests against a real Postgres.
 *   TEST_DATABASE_URL=postgres://kharcha:kharcha@localhost:5432/kharcha_test npm test
 * The test database's public schema is wiped at the start.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { config } from '../config.js';
import { createPool, type Pool } from '../db.js';
import { INGEST_QUEUE, processRawMessage, type IngestPayload } from '../ingest/process.js';
import { migrate } from '../migrate.js';
import { claim, complete, enqueue, fail } from '../queue/queue.js';
import { Worker } from '../queue/worker.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://kharcha:kharcha@localhost:5432/kharcha_test';
let pool: Pool;
let app: FastifyInstance;
let jwt = '';
let ingestToken = '';

const HDFC_SMS = 'Sent Rs.250.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 30/10/26\nRef 430312345678\nNot You?';
// The same payment, as the bank's email alert would phrase it.
const HDFC_EMAIL_STYLE = 'Rs.250.00 has been debited from account **1234 to VPA swiggy@icici on 30-10-26. UPI Ref No 430312345678.';
const ICICI_SMS = 'ICICI Bank Acct XX234 debited for Rs 349.00 on 30-Oct-26; NETFLIX credited. UPI:430312121212.';
const SALARY_SMS = 'Dear Customer, Acct XX234 is credited with Rs 15,000.00 on 30-Oct-26 from ACME TECH PVT LTD. UPI:430343434343-ICICI Bank.';

const auth = () => ({ authorization: `Bearer ${jwt}` });
const sendSms = (text: string, from = 'VM-HDFCBK') =>
  app.inject({
    method: 'POST',
    url: '/api/ingest/sms',
    headers: { authorization: `Bearer ${ingestToken}` },
    payload: { from, text, receivedStamp: Date.parse('2026-10-30T08:55:00Z') },
  });

async function drain(queue = INGEST_QUEUE) {
  const worker = new Worker(pool, queue, async (job) => {
    await processRawMessage(pool, (job.payload as IngestPayload).rawMessageId, 'Asia/Kolkata');
  }, { concurrency: 2, pollMs: 50, log: () => {} });
  await worker.start();
  for (let i = 0; i < 100; i++) {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::bigint AS n FROM jobs WHERE queue = $1 AND status IN ('pending','running')`, [queue]);
    if (rows[0]!.n === 0) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await worker.stop();
}

beforeAll(async () => {
  pool = createPool(url);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool, () => {});
  app = await buildApp({ pool, config: { ...config, allowSignup: true, webDir: '/nonexistent' } }, { logger: false });
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe('accounts', () => {
  it('registers, logs in, and creates an ingest token', async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'Me@Example.com', password: 'correct-horse-battery' } });
    expect(reg.statusCode).toBe(201);

    const dup = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'me@example.com', password: 'another-password' } });
    expect(dup.statusCode).toBe(409);

    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'me@example.com', password: 'wrong-password' } });
    expect(bad.statusCode).toBe(401);

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'me@example.com', password: 'correct-horse-battery' } });
    expect(login.statusCode).toBe(200);
    jwt = login.json().token;

    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    const tok = await app.inject({ method: 'POST', url: '/api/me/ingest-token', headers: auth() });
    ingestToken = tok.json().token;
    expect(ingestToken).toMatch(/^kh_/);
  });
});

describe('SMS ingestion pipeline', () => {
  it('rejects a bad token', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/ingest/sms', headers: { authorization: 'Bearer kh_nope' }, payload: { text: HDFC_SMS } });
    expect(r.statusCode).toBe(401);
  });

  it('queues bank SMS, drops personal SMS without storing them, and is idempotent on retries', async () => {
    expect((await sendSms(HDFC_SMS)).statusCode).toBe(202);
    expect((await sendSms(HDFC_SMS)).json().status).toBe('duplicate'); // forwarder retried
    expect((await sendSms(HDFC_EMAIL_STYLE)).statusCode).toBe(202); // same payment, different wording
    expect((await sendSms(ICICI_SMS, 'JD-ICICIT')).statusCode).toBe(202);
    expect((await sendSms(SALARY_SMS, 'VM-ICICIB')).statusCode).toBe(202);
    expect((await sendSms('are we still on for dinner?', '+919999999999')).json().status).toBe('ignored');

    const stored = await pool.query('SELECT count(*)::bigint AS n FROM raw_messages');
    expect(stored.rows[0].n).toBe(4);
  });

  it('worker parses messages and collapses the duplicate payment by UPI ref', async () => {
    await drain();
    const list = (await app.inject({ method: 'GET', url: '/api/transactions?month=2026-10', headers: auth() })).json();
    expect(list.items).toHaveLength(3);
    const swiggy = list.items.find((t: { merchant: string }) => t.merchant === 'Swiggy');
    expect(swiggy).toMatchObject({ amountPaise: 25000, direction: 'debit', category: 'Food', upiRef: '430312345678' });

    const msgs = (await app.inject({ method: 'GET', url: '/api/messages', headers: auth() })).json();
    expect(msgs.map((m: { status: string }) => m.status).sort()).toEqual(['duplicate', 'parsed', 'parsed', 'parsed']);
  });

  it('re-processing a message is a no-op (at-least-once safety)', async () => {
    const { rows } = await pool.query(`SELECT id FROM raw_messages WHERE status = 'parsed' LIMIT 1`);
    expect(await processRawMessage(pool, rows[0].id, 'Asia/Kolkata')).toBe('duplicate');
    const n = await pool.query('SELECT count(*)::bigint AS n FROM transactions');
    expect(n.rows[0].n).toBe(3);
  });
});

describe('transactions, rules, budgets, summary', () => {
  it('adds a manual cash expense', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/transactions', headers: auth(),
      payload: { amount: '80.50', merchant: 'Chai stall', category: 'Food', occurredAt: '2026-10-29T10:00:00Z' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().amountPaise).toBe(8050);
  });

  it('re-categorising with applyToSimilar creates a rule used for future SMS', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/transactions?q=netflix', headers: auth() })).json();
    const netflix = list.items[0];
    const r = await app.inject({ method: 'PATCH', url: `/api/transactions/${netflix.id}`, headers: auth(), payload: { category: 'Bills', applyToSimilar: true } });
    expect(r.json().transaction.category).toBe('Bills');

    await sendSms('ICICI Bank Acct XX234 debited for Rs 349.00 on 30-Oct-26; NETFLIX credited. UPI:430399999999.', 'JD-ICICIT');
    await drain();
    const again = (await app.inject({ method: 'GET', url: '/api/transactions?q=netflix', headers: auth() })).json();
    expect(again.items.map((t: { category: string }) => t.category)).toEqual(['Bills', 'Bills']);
  });

  it('paginates with a keyset cursor', async () => {
    // 5 transactions so far: 3 from the first SMS batch, 1 manual, 1 more Netflix.
    const ids: number[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    do {
      const page = (await app.inject({ method: 'GET', url: `/api/transactions?limit=2${cursor ? `&cursor=${cursor}` : ''}`, headers: auth() })).json();
      sizes.push(page.items.length);
      ids.push(...page.items.map((t: { id: number }) => t.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(sizes).toEqual([2, 2, 1]);
    expect(new Set(ids).size).toBe(5);
  });

  it('summarises a month with budgets', async () => {
    await app.inject({ method: 'PUT', url: '/api/budgets', headers: auth(), payload: { category: 'Food', limit: 300 } });
    const s = (await app.inject({ method: 'GET', url: '/api/summary?month=2026-10', headers: auth() })).json();
    expect(s.spentPaise).toBe(25000 + 34900 + 34900 + 8050);
    expect(s.receivedPaise).toBe(1500000);
    expect(s.daily).toHaveLength(31);
    expect(s.budgets).toEqual([{ category: 'Food', limitPaise: 30000, spentPaise: 33050 }]);
    expect(s.byCategory[0]).toMatchObject({ category: 'Bills', spentPaise: 69800 });
  });

  it('exports CSV', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/export.csv', headers: auth() });
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.body.split('\n')).toHaveLength(6); // header + 5 rows
  });
});

describe('job queue', () => {
  it('retries with backoff, then dead-letters', async () => {
    const id = await enqueue(pool, 'q-retry', { n: 1 }, { maxAttempts: 2 });
    const j1 = (await claim(pool, 'q-retry', 'w1', 30))!;
    expect(j1.id).toBe(id);
    expect(await fail(pool, j1, 'w1', 'boom')).toBe('retry');
    expect(await claim(pool, 'q-retry', 'w1', 30)).toBeNull(); // backoff: not due yet

    await pool.query('UPDATE jobs SET run_at = now() WHERE id = $1', [id]);
    const j2 = (await claim(pool, 'q-retry', 'w1', 30))!;
    expect(j2.attempts).toBe(2);
    expect(await fail(pool, j2, 'w1', 'boom again')).toBe('dead');
    const { rows } = await pool.query('SELECT status, last_error FROM jobs WHERE id = $1', [id]);
    expect(rows[0]).toEqual({ status: 'dead', last_error: 'boom again' });
  });

  it('a crashed worker’s job is re-claimed after its lease expires', async () => {
    await enqueue(pool, 'q-lease', {});
    const crashed = (await claim(pool, 'q-lease', 'worker-that-dies', 1))!;
    expect(await claim(pool, 'q-lease', 'w2', 30)).toBeNull(); // still leased
    await new Promise((r) => setTimeout(r, 1100));
    const rescued = (await claim(pool, 'q-lease', 'w2', 30))!;
    expect(rescued.id).toBe(crashed.id);
    expect(rescued.attempts).toBe(2);
    expect(await complete(pool, crashed.id, 'worker-that-dies')).toBe(false); // zombie can't complete
    expect(await complete(pool, rescued.id, 'w2')).toBe(true);
  });

  it('3 workers × 4 slots process 300 jobs exactly once (SKIP LOCKED)', async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    for (let i = 0; i < 300; i++) await enqueue(client, 'q-load', { i });
    await client.query('COMMIT');
    client.release();

    const seen = new Map<number, number>();
    const workers = [1, 2, 3].map(() => new Worker(pool, 'q-load', async (job) => {
      seen.set(job.id, (seen.get(job.id) ?? 0) + 1);
    }, { concurrency: 4, pollMs: 20, log: () => {} }));
    const started = Date.now();
    await Promise.all(workers.map((w) => w.start()));
    while (seen.size < 300 && Date.now() - started < 15_000) await new Promise((r) => setTimeout(r, 20));
    await Promise.all(workers.map((w) => w.stop()));

    expect(seen.size).toBe(300);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    const { rows } = await pool.query(`SELECT count(*)::bigint AS n FROM jobs WHERE queue = 'q-load' AND status = 'done'`);
    expect(rows[0].n).toBe(300);
    expect(workers.filter((w) => w.processed > 0).length).toBeGreaterThan(1); // work was actually shared
  });
});

describe('income and savings plan', () => {
  let student = '';
  const as = () => ({ authorization: `Bearer ${student}` });
  // The 15th of last month, midday: safely inside it in any timezone.
  const lastMonth = () => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15, 12)).toISOString();
  };

  it('signs up a student with a monthly allowance and savings goal', async () => {
    const half = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 's@example.com', password: 'student-pass-123', incomeType: 'allowance' } });
    expect(half.statusCode).toBe(400); // incomeType without monthlyIncome

    const reg = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { email: 's@example.com', password: 'student-pass-123', incomeType: 'allowance', monthlyIncome: '10,000', savingsGoal: '2000' },
    });
    expect(reg.statusCode).toBe(201);
    student = reg.json().token;

    const plan = (await app.inject({ method: 'GET', url: '/api/plan', headers: as() })).json();
    expect(plan).toMatchObject({ incomeType: 'allowance', monthlyIncomePaise: 1_000_000, savingsGoalPaise: 200_000 });
  });

  it('suggests budgets from last month, keeping rent and cutting the rest to hit the goal', async () => {
    for (const [merchant, category, amount] of [['PG rent', 'Rent', 5000], ['Swiggy', 'Food', 3000], ['BookMyShow', 'Entertainment', 3000]] as const) {
      const r = await app.inject({ method: 'POST', url: '/api/transactions', headers: as(), payload: { merchant, category, amount, occurredAt: lastMonth() } });
      expect(r.statusCode).toBe(201);
    }
    const plan = (await app.inject({ method: 'GET', url: '/api/plan', headers: as() })).json();
    expect(plan).toMatchObject({ basis: 'history', months: 1 });
    // ₹10,000 − ₹2,000 goal − ₹5,000 rent = ₹3,000 for ₹6,000 of usual flexible spend → halved.
    expect(plan.suggestion.items.map((i: { category: string; budgetPaise: number }) => [i.category, i.budgetPaise])).toEqual([
      ['Rent', 500_000], ['Food', 150_000], ['Entertainment', 150_000],
    ]);

    expect((await app.inject({ method: 'POST', url: '/api/plan/apply', headers: as() })).json()).toEqual({ applied: 3 });
    const budgets = (await app.inject({ method: 'GET', url: '/api/budgets', headers: as() })).json();
    expect(budgets).toContainEqual({ category: 'Food', limitPaise: 150_000 });
  });

  it('refuses to apply an impossible goal', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/plan', headers: as(), payload: { incomeType: 'allowance', monthlyIncome: 10000, savingsGoal: 6000 } });
    expect(put.json().suggestion).toMatchObject({ feasible: false, maxSavingsPaise: 500_000 });
    expect((await app.inject({ method: 'POST', url: '/api/plan/apply', headers: as() })).statusCode).toBe(409);
  });
});

describe('statement import', () => {
  // Row 1 is the Swiggy payment already recorded from SMS above (same UPI ref).
  const csv = [
    'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    '30/10/26,UPI-SWIGGY-swiggy@icici-ICIC0DC0099-430312345678-PAYMENT,0000430312345678,30/10/26,250.00,,9750.00',
    '29/10/26,UPI-BLINKIT-blinkit@hdfcbank-HDFC0000001-430377778888-ORDER,0000430377778888,29/10/26,640.00,,10000.00',
    '28/10/26,POS 512345XXXXXX1234 DMART AVENUE,000000001234,28/10/26,"1,100.00",,10640.00',
  ].join('\n');
  const post = (dryRun: boolean) =>
    app.inject({ method: 'POST', url: '/api/import/statement', headers: auth(), payload: { format: 'csv', text: csv, dryRun } });

  it('previews, skipping payments already recorded from SMS', async () => {
    const r = (await post(true)).json();
    expect(r).toMatchObject({ count: 3, newCount: 2, alreadyRecorded: 1, from: '2026-10-28', to: '2026-10-30', spentPaise: 174000 });
    expect(r.preview.map((p: { merchant: string; category: string }) => [p.merchant, p.category])).toEqual([
      ['Blinkit', 'Groceries'], ['Dmart Avenue', 'Groceries'],
    ]);
  });

  it('imports once; re-uploading the same statement adds nothing', async () => {
    expect((await post(false)).json()).toEqual({ imported: 2, alreadyRecorded: 1, skipped: 0 });
    expect((await post(false)).json()).toEqual({ imported: 0, alreadyRecorded: 3, skipped: 0 });
    const list = (await app.inject({ method: 'GET', url: '/api/transactions?month=2026-10&q=dmart', headers: auth() })).json();
    expect(list.items[0]).toMatchObject({ merchant: 'Dmart Avenue', source: 'statement', amountPaise: 110000 });
    // Noon IST on the statement date.
    expect(list.items[0].occurredAt).toBe('2026-10-28T06:30:00.000Z');
  });

  it('explains when a file has no transactions', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/import/statement', headers: auth(), payload: { format: 'csv', text: 'name,age\nasha,30' } });
    expect(r.statusCode).toBe(422);
  });
});
