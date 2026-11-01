/** Parse "1,250.5" / "250" / 99.99 into integer paise without floating-point drift. */
export function toPaise(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) throw new Error('invalid amount');
    return Math.round(input * 100);
  }
  const s = input.replace(/,/g, '').trim();
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`invalid amount: ${input}`);
  const paise = Number(m[1]) * 100 + Number(((m[2] ?? '') + '00').slice(0, 2));
  if (paise <= 0) throw new Error('amount must be positive');
  return paise;
}

/** YYYY-MM-DD of an instant in the given timezone. */
export function localDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
