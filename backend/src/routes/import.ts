import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { withTx } from '../db.js';
import { tzOffsetMinutes } from '../ingest/process.js';
import { categorize, type UserRule } from '../parser/categorize.js';
import { parseStatementCsv, parseStatementText, type StatementRow } from '../parser/statement.js';

/**
 * The browser reads the file (and turns a PDF into text lines, so the PDF
 * itself never leaves the device); we parse, categorise and dedup here.
 */
const Body = z.object({
  format: z.enum(['csv', 'pdf']),
  text: z.string().min(1).max(5_000_000),
  /** true: just report what would be imported. */
  dryRun: z.boolean().default(true),
});

/**
 * Same key as SMS when there's a UPI reference, so a payment already recorded
 * from SMS isn't added twice. Without one, the row's own fingerprint plus its
 * position among identical rows: re-uploading a statement is a no-op, but two
 * real ₹20 teas on the same day stay two.
 */
function dedupKeys(rows: StatementRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (r.upiRef) return `upi:${r.upiRef}:${r.direction}`;
    const fp = `stmt:${r.date}:${r.direction}:${r.amountPaise}:${createHash('sha256').update(r.description).digest('hex').slice(0, 16)}`;
    const n = (seen.get(fp) ?? 0) + 1;
    seen.set(fp, n);
    return `${fp}:${n}`;
  });
}

/** Statements only give a date: record it at noon local time so it never slips into the neighbouring day. */
function noonLocal(date: string, tz: string): Date {
  const noonUtc = new Date(`${date}T12:00:00Z`);
  return new Date(noonUtc.getTime() - tzOffsetMinutes(tz, noonUtc) * 60_000);
}

export async function importRoutes(app: FastifyInstance, { pool, config }: AppDeps) {
  app.post('/api/import/statement', { bodyLimit: 6 * 1024 * 1024 }, async (req, reply) => {
    const b = Body.parse(req.body);
    const { rows, skipped } = b.format === 'csv' ? parseStatementCsv(b.text) : parseStatementText(b.text);
    if (!rows.length) {
      return reply.code(422).send({ error: "We couldn't find any transactions in this file. Try your bank's CSV/Excel export, or a different PDF." });
    }

    const rules = (await pool.query<UserRule>('SELECT pattern, category FROM category_rules WHERE user_id = $1', [req.userId])).rows;
    const keys = dedupKeys(rows);
    const items = rows.map((r, i) => ({
      ...r,
      dedupKey: keys[i]!,
      category: categorize({ merchant: r.merchant, vpa: r.vpa, direction: r.direction, rawText: r.description }, rules),
    }));

    if (b.dryRun) {
      const existing = await pool.query<{ dedup_key: string }>(
        'SELECT dedup_key FROM transactions WHERE user_id = $1 AND dedup_key = ANY($2)',
        [req.userId, keys],
      );
      const known = new Set(existing.rows.map((r) => r.dedup_key));
      const fresh = items.filter((i) => !known.has(i.dedupKey));
      return {
        count: items.length,
        newCount: fresh.length,
        alreadyRecorded: items.length - fresh.length,
        skipped,
        from: items.reduce((m, i) => (i.date < m ? i.date : m), items[0]!.date),
        to: items.reduce((m, i) => (i.date > m ? i.date : m), items[0]!.date),
        spentPaise: fresh.filter((i) => i.direction === 'debit').reduce((s, i) => s + i.amountPaise, 0),
        receivedPaise: fresh.filter((i) => i.direction === 'credit').reduce((s, i) => s + i.amountPaise, 0),
        preview: fresh.slice(0, 50).map(({ date, merchant, amountPaise, direction, category }) => ({ date, merchant, amountPaise, direction, category })),
      };
    }

    const imported = await withTx(pool, async (c) => {
      let n = 0;
      for (const i of items) {
        const r = await c.query(
          `INSERT INTO transactions (user_id, amount_paise, direction, merchant, vpa, category, upi_ref, source, note, occurred_at, dedup_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'statement', '', $8, $9)
           ON CONFLICT (user_id, dedup_key) DO NOTHING`,
          [req.userId, i.amountPaise, i.direction, i.merchant, i.vpa, i.category, i.upiRef, noonLocal(i.date, config.tz), i.dedupKey],
        );
        n += r.rowCount ?? 0;
      }
      return n;
    });
    return { imported, alreadyRecorded: items.length - imported, skipped };
  });
}
