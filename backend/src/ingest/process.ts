import { withTx, type Pool } from '../db.js';
import { localDate } from '../lib/money.js';
import { categorize, type UserRule } from '../parser/categorize.js';
import { parseSms, type ParsedTxn } from '../parser/sms.js';
import { PermanentError } from '../queue/worker.js';

export const INGEST_QUEUE = 'ingest';

export interface IngestPayload {
  rawMessageId: number;
}

export function dedupKeyFor(t: Pick<ParsedTxn, 'upiRef' | 'bank' | 'accountLast4' | 'direction' | 'amountPaise' | 'occurredAt'>, tz: string): string {
  if (t.upiRef) return `upi:${t.upiRef}:${t.direction}`;
  // No reference number: same bank + account + direction + amount on the same day is treated as one payment.
  return `fp:${t.bank ?? ''}:${t.accountLast4 ?? ''}:${t.direction}:${t.amountPaise}:${localDate(t.occurredAt, tz)}`;
}

export type ProcessOutcome = 'parsed' | 'ignored' | 'duplicate';

/**
 * Idempotent: re-running for the same message never creates a second
 * transaction (unique dedup key + ON CONFLICT DO NOTHING), so at-least-once
 * delivery from the queue is safe.
 */
export async function processRawMessage(pool: Pool, rawMessageId: number, tz: string): Promise<ProcessOutcome> {
  return withTx(pool, async (c) => {
    const { rows } = await c.query<{ id: number; user_id: number; sender: string; body: string; source: string; received_at: Date }>(
      'SELECT id, user_id, sender, body, source, received_at FROM raw_messages WHERE id = $1 FOR UPDATE',
      [rawMessageId],
    );
    const msg = rows[0];
    if (!msg) throw new PermanentError(`raw message ${rawMessageId} not found`);

    const result = parseSms(msg.body, msg.sender, msg.received_at, tzOffsetMinutes(tz, msg.received_at));
    if (!result.ok) {
      await c.query(`UPDATE raw_messages SET status = 'ignored', note = $2 WHERE id = $1`, [msg.id, result.reason]);
      return 'ignored';
    }
    const t = result.txn;
    const rules = (await c.query<UserRule>('SELECT pattern, category FROM category_rules WHERE user_id = $1', [msg.user_id])).rows;
    const category = categorize({ merchant: t.merchant, vpa: t.vpa, direction: t.direction, rawText: msg.body }, rules);

    const ins = await c.query(
      `INSERT INTO transactions
         (user_id, amount_paise, direction, merchant, vpa, category, bank, account_last4, upi_ref,
          source, raw_message_id, occurred_at, dedup_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (user_id, dedup_key) DO NOTHING
       RETURNING id`,
      [msg.user_id, t.amountPaise, t.direction, t.merchant, t.vpa, category, t.bank, t.accountLast4, t.upiRef,
        msg.source, msg.id, t.occurredAt, dedupKeyFor(t, tz)],
    );
    const outcome: ProcessOutcome = ins.rowCount === 1 ? 'parsed' : 'duplicate';
    await c.query('UPDATE raw_messages SET status = $2, note = $3 WHERE id = $1', [
      msg.id,
      outcome,
      outcome === 'duplicate' ? 'already recorded (same UPI ref / fingerprint)' : null,
    ]);
    return outcome;
  });
}

/** Offset of `tz` from UTC in minutes at instant `at` (e.g. 330 for Asia/Kolkata). */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}
