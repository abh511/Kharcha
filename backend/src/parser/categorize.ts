import type { Direction } from './sms.js';

export const CATEGORIES = [
  'Food', 'Groceries', 'Shopping', 'Transport', 'Fuel', 'Travel', 'Bills', 'Entertainment',
  'Health', 'Education', 'Investments', 'Rent', 'Transfers', 'Income', 'Refunds', 'Other',
] as const;
export type Category = (typeof CATEGORIES)[number];

const DEFAULT_RULES: Array<[RegExp, Category]> = [
  [/swiggy|zomato|domino|mcdonald|\bkfc\b|pizza|burger|cafe|restaurant|eatclub|starbucks|chaayos|dunzo food|biryani|haldiram/, 'Food'],
  [/blinkit|zepto|bigbasket|instamart|dmart|jiomart|grofers|more retail|reliance fresh|nature'?s basket|milkbasket|country delight/, 'Groceries'],
  [/amazon|flipkart|myntra|ajio|meesho|nykaa|tata ?cliq|croma|reliance digital|decathlon|ikea|lenskart/, 'Shopping'],
  [/\buber\b|\bola\b|olacabs|rapido|metro|namma yatri|blusmart|\bbmtc\b|\bbest\b|fastag/, 'Transport'],
  [/petrol|fuel|\bhpcl\b|\bbpcl\b|\biocl\b|indian ?oil|bharat petroleum|hindustan petroleum|shell/, 'Fuel'],
  [/irctc|makemytrip|goibibo|indigo|air ?india|akasa|spicejet|vistara|redbus|cleartrip|ixigo|yatra|oyo|airbnb|booking\.com/, 'Travel'],
  [/airtel|\bjio\b|vodafone|\bvi\b|bsnl|electricity|bescom|msedcl|tata ?power|adani|torrent power|recharge|broadband|act fibernet|hathway|gas|water|billdesk|bbps|lic\b|insurance/, 'Bills'],
  [/netflix|spotify|hotstar|prime ?video|bookmyshow|youtube|pvr|inox|sony ?liv|zee5|jiocinema|steam|playstation|district/, 'Entertainment'],
  [/pharma|apollo|medplus|\b1mg\b|pharmeasy|netmeds|hospital|clinic|diagnostic|practo|cult\.?fit|healthify/, 'Health'],
  [/udemy|coursera|college|university|school|fees|byju|unacademy|physics ?wallah|leetcode|exam/, 'Education'],
  [/zerodha|groww|upstox|kuvera|\bsip\b|mutual ?fund|indmoney|angel ?one|coin by|smallcase|nps/, 'Investments'],
  [/\brent\b|nobroker|housing\.com|nestaway|\bpg\b|hostel/, 'Rent'],
];

/** UPI handles used by people's personal accounts (vs merchant QR handles). */
const PERSONAL_HANDLES = /@(okaxis|okhdfcbank|oksbi|okicici|ybl|ibl|axl|apl|upi|paytm|ptyes|ptaxis|pthdfc|ptsbi|axisbank|icici|sbi|hdfcbank|kotak|airtel|fam|slc|naviaxis|superyes)$/;
const MERCHANT_LOCAL = /^(paytmqr|q\d|bharatpe|mab\.|merchant|gpay-|pay\.|razorpay|cf\.|mswipe|pinelabs|ezetap|yespay)/;

export interface UserRule {
  pattern: string;
  category: string;
}

export interface CategorizeInput {
  merchant: string;
  vpa: string | null;
  direction: Direction;
  rawText?: string;
}

export function categorize(input: CategorizeInput, userRules: UserRule[] = []): string {
  const haystack = `${input.merchant} ${input.vpa ?? ''}`.toLowerCase();

  // User rules win; the longest (most specific) pattern first.
  const rule = [...userRules]
    .sort((a, b) => b.pattern.length - a.pattern.length)
    .find((r) => r.pattern && haystack.includes(r.pattern.toLowerCase()));
  if (rule) return rule.category;

  if (input.direction === 'credit') {
    return /refund|revers|cashback/i.test(`${input.rawText ?? ''} ${haystack}`) ? 'Refunds' : 'Income';
  }

  for (const [re, category] of DEFAULT_RULES) if (re.test(haystack)) return category;

  const vpa = input.vpa?.toLowerCase();
  if (vpa) {
    const local = vpa.split('@')[0] ?? '';
    if (/^\d{10}$/.test(local)) return 'Transfers';
    if (PERSONAL_HANDLES.test(vpa) && !MERCHANT_LOCAL.test(local)) return 'Transfers';
  }
  return 'Other';
}

/** The pattern saved when a user says "apply to all similar": the VPA if known, else the merchant name. */
export function rulePatternFor(merchant: string, vpa: string | null): string {
  return (vpa || merchant).trim().toLowerCase();
}
