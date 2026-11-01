-- Kharcha initial schema. Money is always stored as integer paise (BIGINT), never floats.

CREATE TABLE users (
  id                BIGSERIAL PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL DEFAULT '',
  password_hash     TEXT NOT NULL,
  -- sha256 of the secret the SMS forwarder sends; the raw token is shown once and never stored
  ingest_token_hash TEXT UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every inbound message is stored before parsing so it can be re-parsed later
-- when a parser improves (and so a parser bug never loses data).
CREATE TABLE raw_messages (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source      TEXT NOT NULL CHECK (source IN ('sms', 'email', 'csv')),
  sender      TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  body_hash   TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued', 'parsed', 'ignored', 'duplicate', 'failed')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Forwarder apps retry on network errors: the same SMS delivered twice is a no-op.
CREATE UNIQUE INDEX raw_messages_idempotency ON raw_messages (user_id, body_hash);
CREATE INDEX raw_messages_user_time ON raw_messages (user_id, created_at DESC);

CREATE TABLE transactions (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_paise   BIGINT NOT NULL CHECK (amount_paise > 0),
  direction      TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  merchant       TEXT NOT NULL DEFAULT '',
  vpa            TEXT,
  category       TEXT NOT NULL DEFAULT 'Other',
  bank           TEXT,
  account_last4  TEXT,
  upi_ref        TEXT,
  source         TEXT NOT NULL CHECK (source IN ('sms', 'email', 'csv', 'manual')),
  raw_message_id BIGINT REFERENCES raw_messages(id) ON DELETE SET NULL,
  note           TEXT NOT NULL DEFAULT '',
  occurred_at    TIMESTAMPTZ NOT NULL,
  -- 'upi:<ref>:<direction>' when the bank gives a UPI reference, otherwise a fingerprint.
  -- The same payment arriving by SMS *and* email collapses into one row.
  dedup_key      TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX transactions_dedup ON transactions (user_id, dedup_key);
-- Keyset pagination: (occurred_at, id) DESC
CREATE INDEX transactions_user_time ON transactions (user_id, occurred_at DESC, id DESC);

-- "Always put swiggy@icici under Food" — created when the user re-categorises with "apply to similar".
CREATE TABLE category_rules (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pattern    TEXT NOT NULL,
  category   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, pattern)
);

CREATE TABLE budgets (
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category            TEXT NOT NULL,
  monthly_limit_paise BIGINT NOT NULL CHECK (monthly_limit_paise > 0),
  PRIMARY KEY (user_id, category)
);

-- A small durable job queue on Postgres (claimed with FOR UPDATE SKIP LOCKED).
CREATE TABLE jobs (
  id           BIGSERIAL PRIMARY KEY,
  queue        TEXT NOT NULL,
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'running', 'done', 'dead')),
  attempts     INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by    TEXT,
  locked_until TIMESTAMPTZ,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);
CREATE INDEX jobs_ready   ON jobs (queue, run_at)       WHERE status = 'pending';
CREATE INDEX jobs_leased  ON jobs (queue, locked_until) WHERE status = 'running';
