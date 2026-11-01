/**
 * A durable job queue on Postgres.
 *
 * Guarantees: at-least-once execution. A job is claimed with a *lease*
 * (locked_until). If the worker crashes, the lease expires and another worker
 * re-claims it. Handlers must therefore be idempotent (ours are: inserts use
 * ON CONFLICT on a dedup key).
 *
 * - Claiming uses FOR UPDATE SKIP LOCKED so N workers never grab the same row
 *   and never block each other.
 * - Failures retry with exponential backoff + jitter, then go to 'dead' (DLQ).
 * - enqueue() can run inside the caller's transaction: the job only exists if
 *   the business write commits (transactional outbox), and pg_notify is only
 *   delivered on commit, waking idle workers instantly.
 */
import type { Pool, Queryable } from '../db.js';

export const NOTIFY_CHANNEL = 'kharcha_jobs';

export interface Job<T = unknown> {
  id: number;
  queue: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
}

export interface EnqueueOptions {
  maxAttempts?: number;
  runAt?: Date;
}

export async function enqueue(db: Queryable, queue: string, payload: unknown, opts: EnqueueOptions = {}): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO jobs (queue, payload, max_attempts, run_at)
     VALUES ($1, $2, $3, COALESCE($4, now())) RETURNING id`,
    [queue, JSON.stringify(payload), opts.maxAttempts ?? 5, opts.runAt ?? null],
  );
  await db.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, queue]);
  return rows[0]!.id;
}

interface JobRow {
  id: number;
  queue: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
}

/**
 * Claim one runnable job: pending and due, or running with an expired lease
 * (its worker died). Returns null when the queue is empty.
 */
export async function claim(pool: Pool, queue: string, workerId: string, leaseSeconds: number): Promise<Job | null> {
  for (;;) {
    const { rows } = await pool.query<JobRow>(
      `WITH next AS (
         SELECT id FROM jobs
         WHERE queue = $1
           AND ((status = 'pending' AND run_at <= now())
             OR (status = 'running' AND locked_until < now()))
         ORDER BY run_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE jobs j
          SET status = 'running', attempts = j.attempts + 1, locked_by = $2,
              locked_until = now() + make_interval(secs => $3), updated_at = now()
         FROM next WHERE j.id = next.id
       RETURNING j.id, j.queue, j.payload, j.attempts, j.max_attempts`,
      [queue, workerId, leaseSeconds],
    );
    const row = rows[0];
    if (!row) return null;
    // A job whose lease expired on its final attempt has used up its retries.
    if (row.attempts > row.max_attempts) {
      await pool.query(
        `UPDATE jobs SET status = 'dead', locked_by = NULL, locked_until = NULL,
                last_error = COALESCE(last_error, '') || ' [lease expired on final attempt]',
                finished_at = now(), updated_at = now()
          WHERE id = $1`,
        [row.id],
      );
      continue;
    }
    return { id: row.id, queue: row.queue, payload: row.payload, attempts: row.attempts, maxAttempts: row.max_attempts };
  }
}

/** Mark done. Returns false if we no longer hold the lease (someone else re-claimed it). */
export async function complete(db: Queryable, jobId: number, workerId: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE jobs SET status = 'done', locked_by = NULL, locked_until = NULL,
            finished_at = now(), updated_at = now()
      WHERE id = $1 AND locked_by = $2 AND status = 'running'`,
    [jobId, workerId],
  );
  return r.rowCount === 1;
}

/** Schedule a retry, or move to 'dead' when attempts are exhausted or the error is permanent. */
export async function fail(
  db: Queryable,
  job: Job,
  workerId: string,
  error: string,
  opts: { permanent?: boolean; retryInSeconds?: number } = {},
): Promise<'retry' | 'dead'> {
  const dead = opts.permanent === true || job.attempts >= job.maxAttempts;
  const delay = opts.retryInSeconds ?? backoffSeconds(job.attempts);
  await db.query(
    `UPDATE jobs SET status = $3, run_at = now() + make_interval(secs => $4),
            last_error = $5, locked_by = NULL, locked_until = NULL, updated_at = now(),
            finished_at = CASE WHEN $3 = 'dead' THEN now() ELSE NULL END
      WHERE id = $1 AND locked_by = $2`,
    [job.id, workerId, dead ? 'dead' : 'pending', dead ? 0 : delay, error.slice(0, 2000)],
  );
  return dead ? 'dead' : 'retry';
}

/** Heartbeat: keep the lease alive while a long job runs. */
export async function extendLease(db: Queryable, jobId: number, workerId: string, leaseSeconds: number): Promise<boolean> {
  const r = await db.query(
    `UPDATE jobs SET locked_until = now() + make_interval(secs => $3), updated_at = now()
      WHERE id = $1 AND locked_by = $2 AND status = 'running'`,
    [jobId, workerId, leaseSeconds],
  );
  return r.rowCount === 1;
}

/** Exponential backoff with "equal jitter": base·2^(n-1), capped, then randomised in [½, 1]. */
export function backoffSeconds(attempt: number, baseSeconds = 2, capSeconds = 600): number {
  const exp = Math.min(capSeconds, baseSeconds * 2 ** Math.max(0, attempt - 1));
  return exp / 2 + Math.random() * (exp / 2);
}

/** Put a dead job back in the queue (manual DLQ replay). */
export async function retryDead(db: Queryable, jobId: number): Promise<boolean> {
  const r = await db.query(
    `UPDATE jobs SET status = 'pending', attempts = 0, run_at = now(), last_error = NULL,
            finished_at = NULL, updated_at = now()
      WHERE id = $1 AND status = 'dead'`,
    [jobId],
  );
  if (r.rowCount === 1) await db.query('SELECT pg_notify($1, (SELECT queue FROM jobs WHERE id = $2))', [NOTIFY_CHANNEL, jobId]);
  return r.rowCount === 1;
}

/** Job counts for one user's messages (every job's payload points at a raw message). */
export async function queueStats(db: Queryable, userId: number): Promise<Array<{ queue: string; status: string; count: number }>> {
  const { rows } = await db.query<{ queue: string; status: string; count: number }>(
    `SELECT j.queue, j.status, count(*)::bigint AS count
       FROM jobs j JOIN raw_messages m ON m.id = (j.payload->>'rawMessageId')::bigint
      WHERE m.user_id = $1
      GROUP BY j.queue, j.status ORDER BY j.queue, j.status`,
    [userId],
  );
  return rows;
}

/** Remove finished jobs older than the retention window. */
export async function pruneDone(db: Queryable, olderThanDays = 7): Promise<number> {
  const r = await db.query(
    `DELETE FROM jobs WHERE status = 'done' AND finished_at < now() - make_interval(days => $1)`,
    [olderThanDays],
  );
  return r.rowCount ?? 0;
}
