-- Monthly income (salary, or allowance for students) and a savings goal, used to suggest budgets.
-- Nullable: accounts created before this migration haven't entered them yet.
ALTER TABLE users
  ADD COLUMN income_type          TEXT CHECK (income_type IN ('salary', 'allowance')),
  ADD COLUMN monthly_income_paise BIGINT CHECK (monthly_income_paise > 0),
  ADD COLUMN savings_goal_paise   BIGINT CHECK (savings_goal_paise >= 0);
