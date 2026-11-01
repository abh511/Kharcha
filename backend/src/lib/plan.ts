import { CATEGORIES } from '../parser/categorize.js';

/** Costs the plan never cuts (and SIPs it shouldn't): they get a budget at their usual amount. */
export const FIXED_CATEGORIES = ['Rent', 'Bills', 'Health', 'Education', 'Investments'];

/** Categories that can have a budget (same list as the Budgets page). */
export const BUDGET_CATEGORIES: string[] = CATEGORIES.filter((c) => !['Income', 'Refunds', 'Transfers'].includes(c));

export interface PlanItem {
  category: string;
  fixed: boolean;
  usualPaise: number;
  budgetPaise: number;
}

export interface Suggestion {
  items: PlanItem[];
  fixedPaise: number;
  /** What's left for flexible spending after the goal and fixed costs. */
  availablePaise: number;
  /** Savings if every budget is kept. */
  projectedSavingsPaise: number;
  /** Savings if all flexible spending stopped: the ceiling for any goal. */
  maxSavingsPaise: number;
  feasible: boolean;
}

const RS_100 = 100_00;
const RS_10 = 10_00;

/**
 * Fixed costs keep their usual amount (rounded up to ₹100). Flexible
 * categories keep theirs too if it fits; otherwise all are cut by the same
 * percentage so that income − budgets ≥ goal.
 */
export function suggestBudgets(incomePaise: number, goalPaise: number, usual: Map<string, number>): Suggestion {
  const fixed = FIXED_CATEGORIES.filter((c) => (usual.get(c) ?? 0) > 0).map((c) => {
    const u = usual.get(c)!;
    return { category: c, fixed: true, usualPaise: u, budgetPaise: Math.ceil(u / RS_100) * RS_100 };
  });
  const fixedPaise = fixed.reduce((s, i) => s + i.budgetPaise, 0);

  const flexUsual = BUDGET_CATEGORIES.filter((c) => !FIXED_CATEGORIES.includes(c) && (usual.get(c) ?? 0) > 0);
  const flexTotal = flexUsual.reduce((s, c) => s + usual.get(c)!, 0);
  const availablePaise = incomePaise - goalPaise - fixedPaise;
  const feasible = availablePaise >= 0 && (availablePaise > 0 || flexTotal === 0);
  const scale = !feasible ? 0 : flexTotal <= availablePaise ? 1 : availablePaise / flexTotal;

  const flexible = flexUsual
    .map((c) => {
      const u = usual.get(c)!;
      return { category: c, fixed: false, usualPaise: u, budgetPaise: Math.floor((u * scale) / RS_10) * RS_10 };
    })
    .sort((a, b) => b.usualPaise - a.usualPaise);

  const items = [...fixed, ...flexible];
  return {
    items,
    fixedPaise,
    availablePaise,
    projectedSavingsPaise: incomePaise - items.reduce((s, i) => s + i.budgetPaise, 0),
    maxSavingsPaise: Math.max(0, incomePaise - fixedPaise),
    feasible,
  };
}
