import { describe, expect, it } from 'vitest';
import { suggestBudgets } from './plan.js';

const rs = (n: number) => n * 100;
const usual = (o: Record<string, number>) => new Map(Object.entries(o).map(([k, v]) => [k, rs(v)]));

describe('suggestBudgets', () => {
  it('keeps usual amounts when the goal already fits', () => {
    const s = suggestBudgets(rs(50_000), rs(10_000), usual({ Rent: 15_000, Bills: 1_950, Food: 6_000, Shopping: 4_000 }));
    expect(s.feasible).toBe(true);
    expect(s.items).toEqual([
      { category: 'Rent', fixed: true, usualPaise: rs(15_000), budgetPaise: rs(15_000) },
      { category: 'Bills', fixed: true, usualPaise: rs(1_950), budgetPaise: rs(2_000) }, // fixed rounds up to ₹100
      { category: 'Food', fixed: false, usualPaise: rs(6_000), budgetPaise: rs(6_000) },
      { category: 'Shopping', fixed: false, usualPaise: rs(4_000), budgetPaise: rs(4_000) },
    ]);
    expect(s.projectedSavingsPaise).toBe(rs(23_000));
  });

  it('cuts flexible categories by the same percentage, never fixed ones', () => {
    // 30k income, 5k goal, 15k rent → 10k left for 20k of usual flexible spend: everything halves.
    const s = suggestBudgets(rs(30_000), rs(5_000), usual({ Rent: 15_000, Food: 12_000, Entertainment: 8_000 }));
    expect(s.feasible).toBe(true);
    expect(s.items.map((i) => [i.category, i.budgetPaise])).toEqual([
      ['Rent', rs(15_000)],
      ['Food', rs(6_000)],
      ['Entertainment', rs(4_000)],
    ]);
    expect(s.projectedSavingsPaise).toBeGreaterThanOrEqual(rs(5_000));
  });

  it('reports the most you can save when fixed costs make the goal impossible', () => {
    const s = suggestBudgets(rs(8_000), rs(3_000), usual({ Rent: 6_000, Food: 2_000 }));
    expect(s.feasible).toBe(false);
    expect(s.maxSavingsPaise).toBe(rs(2_000));
  });

  it('ignores income, refunds and transfers', () => {
    const s = suggestBudgets(rs(20_000), 0, usual({ Transfers: 5_000, Income: 1, Refunds: 1, Food: 1_000 }));
    expect(s.items.map((i) => i.category)).toEqual(['Food']);
  });
});
