export const CATEGORIES = [
  'Food', 'Groceries', 'Shopping', 'Transport', 'Fuel', 'Travel', 'Bills', 'Entertainment',
  'Health', 'Education', 'Investments', 'Rent', 'Transfers', 'Income', 'Refunds', 'Other',
];

/** Costs the savings plan never cuts (keep in sync with backend/src/lib/plan.ts). */
export const FIXED_CATEGORIES = ['Rent', 'Bills', 'Health', 'Education', 'Investments'];

const COLORS: Record<string, string> = {
  Food: '#C8643B',
  Groceries: '#6E8B3D',
  Shopping: '#B5487A',
  Transport: '#3D6E8B',
  Fuel: '#8B5A3D',
  Travel: '#2E8B83',
  Bills: '#7A5BA6',
  Entertainment: '#D19A2A',
  Health: '#C24B4B',
  Education: '#4B63C2',
  Investments: '#1F4D3A',
  Rent: '#5E5A50',
  Transfers: '#8C8676',
  Income: '#2F7D4F',
  Refunds: '#4E9A8A',
  Other: '#A39E90',
};

export function categoryColor(c: string): string {
  if (COLORS[c]) return COLORS[c];
  let h = 0;
  for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 38% 45%)`;
}
