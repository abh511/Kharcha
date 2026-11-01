import { buildApp } from './app.js';
import { config } from './config.js';
import { createPool } from './db.js';
import { INGEST_QUEUE, processRawMessage, type IngestPayload } from './ingest/process.js';
import { migrate } from './migrate.js';
import { pruneDone } from './queue/queue.js';
import { PermanentError, Worker } from './queue/worker.js';

const pool = createPool(config.databaseUrl);
await migrate(pool);

const app = await buildApp({ pool, config });

let worker: Worker | null = null;
let pruneTimer: NodeJS.Timeout | null = null;
if (config.runWorker) {
  worker = new Worker(
    pool,
    INGEST_QUEUE,
    async (job) => {
      const { rawMessageId } = job.payload as IngestPayload;
      if (!Number.isSafeInteger(rawMessageId)) throw new PermanentError('payload missing rawMessageId');
      const outcome = await processRawMessage(pool, rawMessageId, config.tz);
      app.log.info({ jobId: job.id, rawMessageId, outcome }, 'ingest job done');
    },
    {
      concurrency: config.workerConcurrency,
      log: (msg, extra) => app.log.info(extra ?? {}, `[worker] ${msg}`),
    },
  );
  await worker.start();
  pruneTimer = setInterval(() => pruneDone(pool).catch(() => {}), 6 * 3600_000);
}

await app.listen({ port: config.port, host: config.host });

// Graceful shutdown: stop accepting requests, let in-flight jobs finish, close the pool.
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(1), 25_000);
    force.unref();
    if (pruneTimer) clearInterval(pruneTimer);
    await app.close();
    await worker?.stop();
    await pool.end();
    process.exit(0);
  });
}
