import path from 'node:path';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function jwtSecret(): string {
  const s = env.JWT_SECRET;
  if (s && s.length >= 32) return s;
  if (isProd) throw new Error('JWT_SECRET must be set (32+ characters) in production');
  return 'dev-only-insecure-secret-change-me-0000000000';
}

export const config = {
  isProd,
  port: Number(env.PORT ?? 8080),
  host: env.HOST ?? '0.0.0.0',
  /** Neon's direct URL wins over its pooled one: the pooler breaks LISTEN/NOTIFY and session advisory locks. */
  databaseUrl: env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL ?? 'postgres://kharcha:kharcha@localhost:5432/kharcha',
  jwtSecret: jwtSecret(),
  /** Timezone used for "which day/month did this happen" */
  tz: env.APP_TZ ?? 'Asia/Kolkata',
  /** Comma-separated origins, only needed when the frontend is hosted separately */
  corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  /** Built frontend to serve from the same server (single deploy). */
  webDir: env.WEB_DIR ?? path.resolve(import.meta.dirname, '../../frontend/dist'),
  runWorker: env.RUN_WORKER !== 'false',
  workerConcurrency: Number(env.WORKER_CONCURRENCY ?? 4),
  /** Personal app: create your account, then set ALLOW_SIGNUP=false. */
  allowSignup: env.ALLOW_SIGNUP !== 'false',
};

export type Config = typeof config;
