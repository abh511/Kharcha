import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type pg from 'pg';
import type { Pool } from '../db.js';
import { claim, complete, extendLease, fail, NOTIFY_CHANNEL, type Job } from './queue.js';

/** Throw this from a handler for errors that retrying can't fix (bad input). */
export class PermanentError extends Error {}

export type Handler = (job: Job) => Promise<void>;

export interface WorkerOptions {
  concurrency?: number;
  leaseSeconds?: number;
  /** Fallback poll interval; LISTEN/NOTIFY normally wakes workers instantly. */
  pollMs?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

/**
 * Runs `concurrency` loops that claim and execute jobs from one queue.
 * stop() is graceful: no new jobs are claimed, in-flight jobs finish.
 */
export class Worker {
  readonly id = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private stopping = false;
  private waiters = new Set<() => void>();
  private loops: Promise<void>[] = [];
  private listener: pg.PoolClient | null = null;
  private readonly concurrency: number;
  private readonly leaseSeconds: number;
  private readonly pollMs: number;
  private readonly log: NonNullable<WorkerOptions['log']>;
  processed = 0;
  failed = 0;

  constructor(
    private readonly pool: Pool,
    private readonly queue: string,
    private readonly handler: Handler,
    opts: WorkerOptions = {},
  ) {
    this.concurrency = opts.concurrency ?? 4;
    this.leaseSeconds = opts.leaseSeconds ?? 30;
    this.pollMs = opts.pollMs ?? 2000;
    this.log = opts.log ?? ((m, e) => console.log(`[worker] ${m}`, e ?? ''));
  }

  async start(): Promise<void> {
    await this.listen();
    for (let i = 0; i < this.concurrency; i++) this.loops.push(this.loop());
    this.log('started', { id: this.id, queue: this.queue, concurrency: this.concurrency });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.wakeAll();
    await Promise.all(this.loops);
    if (this.listener) {
      await this.listener.query(`UNLISTEN ${NOTIFY_CHANNEL}`).catch(() => {});
      this.listener.release();
      this.listener = null;
    }
    this.log('stopped', { processed: this.processed, failed: this.failed });
  }

  private async listen(): Promise<void> {
    try {
      const client = await this.pool.connect();
      client.on('notification', (msg) => {
        if (msg.payload === this.queue) this.wakeAll();
      });
      client.on('error', (err) => {
        // Polling still works; LISTEN just stops giving instant wake-ups.
        this.log('listener connection lost, falling back to polling', { error: err.message });
        client.release(err);
        if (this.listener === client) this.listener = null;
      });
      await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
      this.listener = client;
    } catch (err) {
      this.log('LISTEN unavailable, polling only', { error: (err as Error).message });
    }
  }

  private wakeAll(): void {
    for (const wake of this.waiters) wake();
    this.waiters.clear();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      let job: Job | null;
      try {
        job = await claim(this.pool, this.queue, this.id, this.leaseSeconds);
      } catch (err) {
        this.log('claim failed', { error: (err as Error).message });
        await this.sleep(this.pollMs);
        continue;
      }
      if (!job) {
        await this.sleep(this.pollMs);
        continue;
      }
      await this.run(job);
    }
  }

  private async run(job: Job): Promise<void> {
    const heartbeat = setInterval(() => {
      extendLease(this.pool, job.id, this.id, this.leaseSeconds).catch(() => {});
    }, (this.leaseSeconds * 1000) / 3);
    try {
      await this.handler(job);
      const ok = await complete(this.pool, job.id, this.id);
      if (!ok) this.log('lease lost before completion; job will be re-run (handler is idempotent)', { jobId: job.id });
      this.processed++;
    } catch (err) {
      this.failed++;
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await fail(this.pool, job, this.id, message, { permanent: err instanceof PermanentError }).catch(
        () => 'unknown',
      );
      this.log(`job failed → ${outcome}`, { jobId: job.id, attempt: job.attempts, error: message });
    } finally {
      clearInterval(heartbeat);
    }
  }
}
