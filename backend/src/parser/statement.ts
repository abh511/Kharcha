/**
 * Bank statement parsing. Two inputs:
 *  - CSV / spreadsheet exports: find the header row, map columns by name.
 *  - Text lines extracted from a PDF (in the browser): rows start with a date
 *    and end with "amount balance"; the change in balance tells debit from credit.
 * Indian banks write dates day-first, so 03/04/2026 is 3 April.
 */
import { prettifyVpa, titleCase, VPA, type Direction } from './sms.js';

export interface StatementRow {
  /** YYYY-MM-DD */
  date: string;
  description: string;
  amountPaise: number;
  direction: Direction;
  merchant: string;
  vpa: string | null;
  upiRef: string | null;
}

export interface StatementParse {
  rows: StatementRow[];
  /** Rows with a date and an amount we couldn't make sense of. */
  skipped: number;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function ymd(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** A date at the start of `s`, and what follows it. */
export function leadingDate(s: string): { date: string; rest: string } | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ][\d:.]+)?/.exec(t);
  let date = m ? ymd(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  if (!m) {
    m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})(?!\d)/.exec(t);
    date = m ? ymd(fullYear(m[3]!), Number(m[2]), Number(m[1])) : null;
  }
  if (!m) {
    m = /^(\d{1,2})[\s/\-.]?([a-z]{3})[a-z]*[\s/\-.,]*(\d{4}|\d{2})(?!\d)/i.exec(t);
    const mon = m ? MONTHS[m[2]!.toLowerCase()] : undefined;
    date = m && mon ? ymd(fullYear(m[3]!), mon, Number(m[1])) : null;
  }
  return m && date ? { date, rest: t.slice(m[0].length).trim() } : null;
}

/** "1,250.50", "₹ 99", "250.00 Dr" → paise and optional Dr/Cr marker. Empty, zero or junk → null. */
export function parseAmount(s: string): { paise: number; marker: Direction | null } | null {
  const m = /^\s*(?:₹|rs\.?|inr)?\s*(-)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*(cr|dr)?\.?\s*$/i.exec(s);
  if (!m) return null;
  const [whole, frac = ''] = m[2]!.replace(/,/g, '').split('.');
  const paise = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(paise) || paise <= 0) return null;
  const marker = m[3] ? (m[3].toLowerCase() === 'cr' ? 'credit' : 'debit') : m[1] ? 'debit' : null;
  return { paise, marker };
}

// ---------- narration → merchant / UPI ID / reference ----------

const NOISE =
  /^(upi|imps|neft|rtgs|dr|cr|p2a|p2m|pay(ment)?|txn|ref(no)?|to|by|from|transfer|trf|mb|ib|inb|bil|onl|pos|ecom|ach|nach|collect|na|null|others?|upiint|upi ?intent|sent using .*|payment from phone)$/i;
/** Words that are never part of a name, wherever they appear. */
const FILLER = /^(upi|imps|neft|rtgs|dr|cr|p2a|p2m|txn|to|by|from|transfer|trf|mb|ib|inb|pos|ecom|ach|nach|upiint)$/i;
const BANKISH = /^(hdfc|hdfc ?bank|sbi|sbin|icici|icic|icici ?bank|axis|axis ?bank|utib|kotak|kkbk|yes ?bank|yesb|pnb|bob|canara|union ?bank|idfc|indusind|paytm|airtel)$/i;
const IFSC = /^[a-z]{4}0[a-z0-9]{6}$/i;

export function describeNarration(narration: string): { merchant: string; vpa: string | null; upiRef: string | null } {
  const upiRef = /(?<!\d)(\d{12})(?!\d)/.exec(narration)?.[1] ?? null;
  // Statements join fields with "-" or "/", which VPA would otherwise swallow ("UPI-SWIGGY-swiggy@icici").
  const vpa = narration.split(/[\s/|:-]+/).find((t) => new RegExp(`^${VPA.source}$`, 'i').test(t))?.toLowerCase() ?? null;
  if (/^(atw|atm|nwd|eaw)\b/i.test(narration.trim())) return { merchant: 'ATM withdrawal', vpa: null, upiRef };

  // Each field, minus reference numbers, bank codes and filler words ("TO TRANSFER", "POS").
  const name = narration
    .split(/[/|:]+|\s-\s|-(?=\S)|\s{2,}/)
    .map((seg) =>
      seg
        .split(/\s+/)
        .filter((w) => w && !/\d{4,}/.test(w) && !w.includes('@') && !FILLER.test(w) && !BANKISH.test(w) && !IFSC.test(w))
        .join(' '),
    )
    .find((s) => /[a-z]{3}/i.test(s) && !NOISE.test(s));
  const merchant = name ? titleCase(name) : vpa ? prettifyVpa(vpa) : narration.trim().slice(0, 60);
  return { merchant: merchant.slice(0, 100), vpa, upiRef };
}

const CREDIT_HINT = /(\/cr\/|\bcr\b|credit|deposit|refund|reversal|salary|interest|by transfer|received)/i;
const DEBIT_HINT = /(\/dr\/|\bdr\b|debit|withdrawal|to transfer|\batm\b|\bpos\b|purchase|paid)/i;
const hintDirection = (s: string): Direction | null => (CREDIT_HINT.test(s) ? 'credit' : DEBIT_HINT.test(s) ? 'debit' : null);

function row(date: string, rawDescription: string, amountPaise: number, direction: Direction): StatementRow {
  const description = rawDescription.replace(/\s+/g, ' ').trim();
  return { date, description, amountPaise, direction, ...describeNarration(description) };
}

// ---------- CSV ----------

/** RFC-4180-ish: quoted fields, "" escapes, CRLF. The delimiter is sniffed. */
export function parseCsv(text: string): string[][] {
  const sample = text.split(/\r?\n/).slice(0, 30).join('\n');
  const delim = [',', '\t', ';', '|'].sort((a, b) => sample.split(b).length - sample.split(a).length)[0]!;
  const out: string[][] = [];
  let rowCells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) rowCells.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      rowCells.push(cell), out.push(rowCells), (rowCells = []), (cell = '');
    } else cell += ch;
  }
  if (cell || rowCells.length) rowCells.push(cell), out.push(rowCells);
  return out.map((r) => r.map((c) => c.trim()));
}

interface Columns {
  date: number;
  desc: number;
  debit: number;
  credit: number;
  amount: number;
  type: number;
}

function findColumns(header: string[]): Columns | null {
  const h = header.map((c) => c.toLowerCase().replace(/\s+/g, ' '));
  const find = (re: RegExp, not?: RegExp, skip: number[] = []) => h.findIndex((c, i) => re.test(c) && !(not && not.test(c)) && !skip.includes(i));

  let date = find(/^(txn|tran|transaction|posting)?\.? ?date|^date$/, /value/);
  if (date < 0) date = find(/date/);
  const desc = find(/narration|description|particulars|details|remarks/);
  const type = find(/^(dr ?\/ ?cr|cr ?\/ ?dr|type|transaction type|debit ?\/ ?credit)$/);
  const debit = find(/withdraw|debit|\bdr\b|paid out/, /credit|balance/, [type]);
  const credit = find(/deposit|credit|\bcr\b|paid in/, /debit|balance/, [type, debit]);
  const amount = debit >= 0 && credit >= 0 ? -1 : find(/amount|amt/, /balance/, [type, debit, credit]);
  if (date < 0 || desc < 0 || (amount < 0 && (debit < 0 || credit < 0))) return null;
  return { date, desc, debit, credit, amount, type };
}

export function parseStatementCsv(text: string): StatementParse {
  const table = parseCsv(text.replace(/^﻿/, ''));
  const headerAt = table.slice(0, 60).findIndex((r) => findColumns(r) !== null);
  if (headerAt < 0) return { rows: [], skipped: 0 };
  const cols = findColumns(table[headerAt]!)!;

  const rows: StatementRow[] = [];
  let skipped = 0;
  for (const r of table.slice(headerAt + 1)) {
    const d = leadingDate(r[cols.date] ?? '');
    if (!d) continue; // blank lines, footers, totals
    const desc = r[cols.desc] ?? '';
    let amt: ReturnType<typeof parseAmount> = null;
    let dir: Direction | null = null;
    if (cols.amount < 0) {
      const dr = parseAmount(r[cols.debit] ?? '');
      const cr = parseAmount(r[cols.credit] ?? '');
      if (dr && !cr) (amt = dr), (dir = 'debit');
      else if (cr && !dr) (amt = cr), (dir = 'credit');
    } else {
      amt = parseAmount(r[cols.amount] ?? '');
      const t = (r[cols.type] ?? '').toLowerCase();
      dir = /^(cr|c|credit|deposit)/.test(t) ? 'credit' : /^(dr|d|debit|withdraw)/.test(t) ? 'debit' : amt?.marker ?? hintDirection(desc);
    }
    if (!amt || !dir) {
      skipped++;
      continue;
    }
    rows.push(row(d.date, desc, amt.paise, dir));
  }
  return { rows, skipped };
}

// ---------- PDF text ----------

const MONEY = /(?<![\d.])-?\d{1,3}(?:,\d{2,3})*\.\d{2}(?:\s*(?:cr|dr)\b)?|(?<![\d.,])-?\d+\.\d{2}(?:\s*(?:cr|dr)\b)?/gi;
const INLINE_DATE = /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/g;
const PAGE_CHROME = /^(page\s*\d+(\s*of\s*\d+)?|(txn |tran |value )?date\b.*\bbalance)$/i;
const BALANCE_LINE = /opening balance|closing balance|balance b\/?f|brought forward|balance forward/i;

const hasNarration = (s: string) => /[a-z]{3}/i.test(s.replace(/\S*\d{4,}\S*/g, ' '));

/**
 * `text`: one line per visual line of the PDF, words separated by spaces.
 * A transaction line starts with a date and ends with money columns. Lines
 * without a date are narration that wrapped. Usually it continues the row
 * above; but some banks centre cells vertically, so part of a row's narration
 * sits *above* its date line. A dated line with no narration of its own claims
 * the wrapped lines before it (split half-and-half if the row above has none either).
 */
export function parseStatementText(text: string): StatementParse {
  /** `own`: the date line itself had narration text. */
  interface Pending { date: string; desc: string[]; amounts: string[]; own: boolean }
  const pending: Pending[] = [];
  let orphans: string[] = [];
  let opening: number | null = null;

  const settleOrphans = (next: Pending | null) => {
    const prev = pending[pending.length - 1];
    let toNext: string[] = [];
    if (next && !next.own) {
      if (!prev) toNext = orphans.slice(-2); // before the first row: only the cell's lines, not page headers
      else if (prev.own) toNext = orphans;
      else toNext = orphans.slice(Math.ceil(orphans.length / 2));
    }
    if (prev) prev.desc.push(...orphans.slice(0, orphans.length - toNext.length));
    if (next) next.desc.unshift(...toNext);
    orphans = [];
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || PAGE_CHROME.test(line)) continue;
    const d = leadingDate(line);
    const amounts = line.match(MONEY) ?? [];
    if (BALANCE_LINE.test(line)) {
      if (opening === null && pending.length === 0 && amounts.length) opening = parseAmount(amounts[amounts.length - 1]!)?.paise ?? null;
      orphans = [];
      continue;
    }
    if (d) {
      // Drop the value date and the money columns from the narration.
      const rest = d.rest.replace(MONEY, ' ').replace(INLINE_DATE, ' ');
      const next = { date: d.date, desc: [rest], amounts, own: hasNarration(rest) };
      settleOrphans(next);
      pending.push(next);
    } else {
      const last = pending[pending.length - 1];
      if (last && !last.amounts.length && amounts.length) last.amounts = amounts;
      orphans.push(line.replace(MONEY, ' ').replace(INLINE_DATE, ' '));
    }
  }
  settleOrphans(null);

  const rows: StatementRow[] = [];
  let skipped = 0;
  let prevBalance = opening;
  for (const p of pending) {
    const vals = p.amounts.map((a) => ({ raw: a, parsed: parseAmount(a.replace(/^-/, '')), negative: a.trim().startsWith('-') }));
    // Last money column is the running balance; the amount is the last non-zero one before it ("0.00" fills empty columns).
    const balance = vals.length >= 2 ? vals[vals.length - 1]!.parsed?.paise ?? null : null;
    const amount = (vals.length >= 2 ? vals.slice(0, -1) : vals).filter((v) => v.parsed).pop();
    const desc = p.desc.join(' ');
    if (!amount?.parsed) {
      skipped++;
      continue;
    }
    let dir: Direction | null = amount.parsed.marker ?? (amount.negative ? 'debit' : null);
    if (!dir && balance !== null && prevBalance !== null) {
      const delta = balance - prevBalance;
      if (Math.abs(delta) === amount.parsed.paise) dir = delta > 0 ? 'credit' : 'debit';
    }
    dir ??= hintDirection(desc);
    if (balance !== null) prevBalance = balance;
    if (!dir) {
      skipped++;
      continue;
    }
    rows.push(row(p.date, desc, amount.parsed.paise, dir));
  }
  return { rows, skipped };
}
