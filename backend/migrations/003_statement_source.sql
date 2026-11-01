-- Transactions imported from an uploaded bank statement (CSV or PDF).
ALTER TABLE transactions DROP CONSTRAINT transactions_source_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_source_check
  CHECK (source IN ('sms', 'email', 'csv', 'manual', 'statement'));
