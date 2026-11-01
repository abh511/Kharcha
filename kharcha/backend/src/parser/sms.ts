/**
 * Turns an Indian bank transaction SMS into a structured transaction.
 *
 * Banks don't share one format, so rather than one brittle regex per bank this
 * extracts each field (amount, direction, UPI ref, account, counterparty, date)
 * with ordered heuristics, and rejects anything that isn't a completed payment
 * (OTPs, collect requests, failed payments, due-date reminders, offers).
 * Every sample format we support lives in sms.test.ts — add one when a bank
 * message isn't parsed, then fix the heuristic.
 */
import { toPaise } from '../lib/money.js';

export type Direction = 'debit' | 'credit';

export interface ParsedTxn {
  amountPaise: number;
  direction: Direction;
  merchant: string;
  vpa: string | null;
  upiRef: string | null;
  accountLast4: string | null;
  bank: string | null;
  occurredAt: Date;
}

export type ParseResult = { ok: true; txn: ParsedTxn } | { ok: false; reason: string };

const REJECT: Array<[RegExp, string]> = [
  [/\b(otp|one[\s-]?time[\s-]?password|verification code)\b/i, 'OTP message'],
  [/(has requested|requested money|collect request|is requesting|request of rs)/i, 'payment request, not a payment'],
  [/(will be debited|is due|due date|due on|pre-?approved|loan offer|cashback offer|minimum amount due)/i, 'reminder or offer'],
  [/\b(mandate|autopay)\b.*\b(created|registered|set up|setup)\b/i, 'mandate setup'],
];
const FAILED = /\b(failed|declined|unsuccessful|could not be processed)\b/i;
const REVERSAL = /\b(credited|refund(ed)?|revers(ed|al))\b/i;

const DEBIT_WORDS = /\b(debited|sent|paid|spent|withdrawn|purchase|transferred|trf to|dr)\b/i;
const CREDIT_WORDS = /\b(credited|received|deposited|refund(?:ed)?|cr)\b/i;

const CURRENCY_AMOUNT = /(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
const BARE_AMOUNT = /\b(?:debited|credited)\s+(?:by|for|with)\s+([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
const BALANCE_CONTEXT = /(bal|balance|limit|avl|available)[^0-9]{0,12}$/i;

const REF_PATTERNS = [
  /UPI\/(?:P2M|P2A|P2P|CR|DR)\/(\d{12})\b/i,
  /\b(?:upi\s*ref(?:erence)?|ref(?:erence)?|rrn|utr|upi)\s*(?:no|number|id)?\.?\s*[:#.\-]?\s*(\d{12})\b/i,
];

const ACCOUNT_PATTERNS = [
  /(?:a\/c|acct|account|\bac)\s*(?:no\.?)?\s*[:\-]?\s*[x*]+\s*(\d{3,6})/i,
  /\bcard\s*(?:no\.?|ending(?:\s*with)?)?\s*[x*]*\s*(\d{4})\b/i,
];

export const VPA = /([a-z0-9][a-z0-9.\-_]{1,255}@[a-z][a-z0-9]{1,63})(?!\.[a-z]{2,})/i;

// Counterparty patterns; `dir` limits a pattern to one direction.
const NAME_PATTERNS: Array<{ re: RegExp; dir?: Direction }> = [
  { re: /UPI\/(?:P2M|P2A|P2P)\/\d{12}\/([^/]+?)(?:\s+Not you|\/|$)/i },
  { re: /\bTo\s+(.+?)\s+On\s+\d/i, dir: 'debit' }, // HDFC: "To SWIGGY On 30/10/26"
  { re: /\btrf to\s+(.+?)\s+(?:Ref|on\b)/i, dir: 'debit' }, // SBI
  { re: /;\s*(.+?)\s+credited\b/i, dir: 'debit' }, // ICICI: "; SWIGGY credited"
  { re: /\bto\s+(?:VPA\s+)?(.+?)(?:\s*\(|\s+on\b|\.\s|\.$|\s+UPI|\s+Ref|$)/i, dir: 'debit' },
  { re: /\bfrom\s+(?:VPA\s+)?(.+?)(?:\s*\(|\s+on\b|\.\s|\.$|\s+UPI|\s+Ref|$)/i, dir: 'credit' },
];
const ACCOUNTISH = /(a\/c|acct|\bac\b|account|bank\b|card\b|^your\b)/i;

const BANKS: Array<[RegExp, string]> = [
  [/hdfc/i, 'HDFC Bank'],
  [/\bsbi|sbiupi|sbiinb|state bank/i, 'SBI'],
  [/icici/i, 'ICICI Bank'],
  [/axis/i, 'Axis Bank'],
  [/kotak/i, 'Kotak'],
  [/\bpnb|punjab national/i, 'PNB'],
  [/\bbob\b|baroda/i, 'Bank of Baroda'],
  [/canara|canbnk/i, 'Canara Bank'],
  [/union bank|uboi/i, 'Union Bank'],
  [/idfc/i, 'IDFC First'],
  [/yes ?bank|yesbnk/i, 'Yes Bank'],
  [/indus/i, 'IndusInd'],
  [/federal|fedbnk/i, 'Federal Bank'],
  [/paytm/i, 'Paytm Payments Bank'],
  [/airtel/i, 'Airtel Payments Bank'],
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Cheap pre-check used at the webhook so non-bank SMS bodies are never stored. */
export function looksTransactional(text: string): boolean {
  return (DEBIT_WORDS.test(text) || CREDIT_WORDS.test(text)) && (new RegExp(CURRENCY_AMOUNT.source, 'i').test(text) || BARE_AMOUNT.test(text));
}

export function parseSms(body: string, sender: string, receivedAt: Date, tzOffsetMinutes = 330): ParseResult {
  const text = body.replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, reason: 'empty message' };

  for (const [re, reason] of REJECT) if (re.test(text)) return { ok: false, reason };
  if (FAILED.test(text) && !REVERSAL.test(text)) return { ok: false, reason: 'failed transaction' };

  const direction = detectDirection(text);
  if (!direction) return { ok: false, reason: 'no debit/credit keyword' };

  const amountPaise = extractAmount(text);
  if (!amountPaise) return { ok: false, reason: 'no amount found' };

  const upiRef = firstMatch(text, REF_PATTERNS);
  const accountRaw = firstMatch(text, ACCOUNT_PATTERNS);
  const accountLast4 = accountRaw ? accountRaw.slice(-4) : null;

  let { name, vpa } = extractCounterparty(text, direction);
  if (!vpa) vpa = VPA.exec(text)?.[1]?.toLowerCase() ?? null;
  const merchant = name || (vpa ? prettifyVpa(vpa) : direction === 'credit' ? 'Unknown sender' : 'Unknown');

  return {
    ok: true,
    txn: {
      amountPaise,
      direction,
      merchant,
      vpa,
      upiRef,
      accountLast4,
      bank: detectBank(sender, text),
      occurredAt: extractDate(text, receivedAt, tzOffsetMinutes),
    },
  };
}

function detectDirection(text: string): Direction | null {
  const d = DEBIT_WORDS.exec(text)?.index ?? Infinity;
  const c = CREDIT_WORDS.exec(text)?.index ?? Infinity;
  if (d === Infinity && c === Infinity) return null;
  return d <= c ? 'debit' : 'credit';
}

function extractAmount(text: string): number | null {
  for (const m of text.matchAll(CURRENCY_AMOUNT)) {
    const before = text.slice(Math.max(0, m.index - 25), m.index);
    if (BALANCE_CONTEXT.test(before)) continue; // "Avl Bal Rs 5,000" is not the payment
    const paise = safePaise(m[1]!);
    if (paise) return paise;
  }
  const bare = BARE_AMOUNT.exec(text);
  return bare ? safePaise(bare[1]!) : null;
}

function safePaise(s: string): number | null {
  try {
    return toPaise(s.replace(/\.$/, ''));
  } catch {
    return null;
  }
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1]) return m[1];
  }
  return null;
}

function extractCounterparty(text: string, direction: Direction): { name: string; vpa: string | null } {
  for (const { re, dir } of NAME_PATTERNS) {
    if (dir && dir !== direction) continue;
    const raw = re.exec(text)?.[1];
    if (!raw) continue;
    const cleaned = raw.replace(/[\s.,;:)\-]+$/, '').replace(/^[\s(]+/, '').trim();
    if (!cleaned || ACCOUNTISH.test(cleaned) || /^\d[\d\s/-]*$/.test(cleaned)) continue;
    const vpa = VPA.exec(cleaned)?.[1]?.toLowerCase() ?? null;
    if (vpa) return { name: '', vpa };
    return { name: titleCase(cleaned.slice(0, 80)), vpa: null };
  }
  return { name: '', vpa: null };
}

/** "swiggy.food@icici" → "Swiggy Food"; phone-number VPAs stay as they are. */
export function prettifyVpa(vpa: string): string {
  const local = vpa.split('@')[0] ?? vpa;
  if (/^\d{10}$/.test(local)) return local;
  return titleCase(local.replace(/[._\-]+/g, ' ').replace(/\d{4,}/g, '').trim() || local);
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function detectBank(sender: string, text: string): string | null {
  for (const [re, name] of BANKS) if (re.test(sender)) return name;
  for (const [re, name] of BANKS) if (re.test(text)) return name;
  return null;
}

/**
 * Bank SMS dates are local (IST). Use the SMS's date when present; if it's the
 * same day the SMS arrived, prefer the arrival time (more precise).
 */
function extractDate(text: string, receivedAt: Date, tzOffsetMinutes: number): Date {
  let y: number | undefined, mo: number | undefined, d: number | undefined;

  const numeric = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/.exec(text);
  const named = /\b(\d{1,2})[\s-]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,-]?(\d{2,4})\b/i.exec(text);
  if (numeric) {
    [d, mo, y] = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
  } else if (named) {
    [d, mo, y] = [Number(named[1]), MONTHS[named[2]!.toLowerCase()], Number(named[3])];
  }
  if (!y || !mo || !d || mo > 12 || d > 31) return receivedAt;
  if (y < 100) y += 2000;

  const time = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  const offsetMs = tzOffsetMinutes * 60_000;
  const receivedLocal = new Date(receivedAt.getTime() + offsetMs);
  const sameDay =
    receivedLocal.getUTCFullYear() === y && receivedLocal.getUTCMonth() + 1 === mo && receivedLocal.getUTCDate() === d;

  let h = 12, mi = 0, s = 0;
  if (time) {
    h = Number(time[1]);
    mi = Number(time[2]);
    s = Number(time[3] ?? 0);
    const ampm = time[4]?.toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
  } else if (sameDay) {
    return receivedAt;
  }

  const result = new Date(Date.UTC(y, mo - 1, d, h, mi, s) - offsetMs);
  // Guard against misreads (e.g. a reference that looked like a date).
  const tooFarAhead = result.getTime() - receivedAt.getTime() > 2 * 86_400_000;
  const tooOld = receivedAt.getTime() - result.getTime() > 400 * 86_400_000;
  return Number.isNaN(result.getTime()) || tooFarAhead || tooOld ? receivedAt : result;
}
