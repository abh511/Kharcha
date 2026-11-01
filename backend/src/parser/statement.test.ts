import { describe, expect, it } from 'vitest';
import { describeNarration, leadingDate, parseAmount, parseStatementCsv, parseStatementText } from './statement.js';

const brief = (r: { date: string; amountPaise: number; direction: string; merchant: string; upiRef: string | null }) =>
  [r.date, r.amountPaise, r.direction, r.merchant, r.upiRef];

describe('building blocks', () => {
  it('reads Indian day-first dates in every common format', () => {
    expect(leadingDate('03/04/26 rest')).toEqual({ date: '2026-04-03', rest: 'rest' });
    expect(leadingDate('03-04-2026')?.date).toBe('2026-04-03');
    expect(leadingDate('3 Apr 2026')?.date).toBe('2026-04-03');
    expect(leadingDate('03-Apr-26')?.date).toBe('2026-04-03');
    expect(leadingDate('03Apr2026')?.date).toBe('2026-04-03');
    expect(leadingDate('2026-04-03 10:22:00')?.date).toBe('2026-04-03');
    expect(leadingDate('31/02/2026')).toBeNull();
    expect(leadingDate('Opening Balance')).toBeNull();
  });

  it('parses amounts with commas, symbols and Dr/Cr markers', () => {
    expect(parseAmount('1,25,000.50')).toEqual({ paise: 12500050, marker: null });
    expect(parseAmount('₹ 99')).toEqual({ paise: 9900, marker: null });
    expect(parseAmount('250.00 Dr')).toEqual({ paise: 25000, marker: 'debit' });
    expect(parseAmount('250.00 CR')).toEqual({ paise: 25000, marker: 'credit' });
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('0.00')).toBeNull();
  });

  it('finds the merchant, UPI ID and reference in narrations', () => {
    expect(describeNarration('UPI-SWIGGY-swiggy@icici-ICIC0DC0099-430312345678-PAYMENT FROM PHONE')).toEqual({
      merchant: 'Swiggy', vpa: 'swiggy@icici', upiRef: '430312345678',
    });
    expect(describeNarration('UPI/DR/430398765432/RAHUL SHARMA/YESB/rahul.s@ybl/Paym')).toEqual({
      merchant: 'Rahul Sharma', vpa: 'rahul.s@ybl', upiRef: '430398765432',
    });
    expect(describeNarration('NEFT-HDFCN52026103012345-ACME TECH PVT LTD-SALARY OCT').merchant).toBe('Acme Tech Pvt Ltd');
    expect(describeNarration('ATW-512345XXXXXX1234-S1ANMU03-MUMBAI').merchant).toBe('ATM withdrawal');
  });
});

describe('CSV statements', () => {
  it('HDFC: preamble lines, separate withdrawal/deposit columns', () => {
    const csv = [
      'HDFC BANK Ltd.,,,,,,',
      'Statement of account,,,,,,',
      ' Date ,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
      '01/10/26,UPI-SWIGGY-swiggy@icici-ICIC0DC0099-430312345678-PAYMENT FROM PHONE,0000430312345678,01/10/26,312.00,,24688.00',
      '01/10/26,"NEFT-HDFCN52026103012345-ACME TECH PVT LTD-SALARY OCT",HDFCN520261030,01/10/26,,"25,000.00",49688.00',
      '02/10/26,ATW-512345XXXXXX1234-S1ANMU03-MUMBAI,000000001234,02/10/26,"2,000.00",,47688.00',
      ',,,,,,',
      'STATEMENT SUMMARY,,,,,,',
    ].join('\n');
    const r = parseStatementCsv(csv);
    expect(r.skipped).toBe(0);
    expect(r.rows.map(brief)).toEqual([
      ['2026-10-01', 31200, 'debit', 'Swiggy', '430312345678'],
      ['2026-10-01', 2500000, 'credit', 'Acme Tech Pvt Ltd', null],
      ['2026-10-02', 200000, 'debit', 'ATM withdrawal', null],
    ]);
  });

  it('SBI: Txn Date / Value Date, Debit / Credit, tab separated', () => {
    const csv = [
      'Txn Date\tValue Date\tDescription\tRef No./Cheque No.\tDebit\tCredit\tBalance',
      '5 Oct 2026\t5 Oct 2026\tTO TRANSFER-UPI/DR/430398765432/RAHUL SHARMA/YESB/rahul.s@ybl/Paym-\tTRANSFER TO 4897\t500.00\t \t10,500.00',
      '6 Oct 2026\t6 Oct 2026\tBY TRANSFER-UPI/CR/430311112222/AMAZON PAY/UTIB/amazonpay@apl/Refund-\tTRANSFER FROM 4897\t \t1,299.00\t11,799.00',
    ].join('\n');
    expect(parseStatementCsv(csv).rows.map(brief)).toEqual([
      ['2026-10-05', 50000, 'debit', 'Rahul Sharma', '430398765432'],
      ['2026-10-06', 129900, 'credit', 'Amazon Pay', '430311112222'],
    ]);
  });

  it('ICICI-style: one Amount column plus a Cr/Dr column', () => {
    const csv = [
      'S No.,Transaction Date,Transaction Remarks,Amount (INR),Cr/Dr,Balance (INR)',
      '1,30-10-2026,UPI/430312121212/NETFLIX/netflix@hdfcbank/Monthly,349.00,DR,"5,000.00"',
      '2,30-10-2026,UPI/430343434343/Refund/ACME/acme@okicici,100.00,CR,"5,100.00"',
    ].join('\n');
    expect(parseStatementCsv(csv).rows.map(brief)).toEqual([
      ['2026-10-30', 34900, 'debit', 'Netflix', '430312121212'],
      ['2026-10-30', 10000, 'credit', 'Refund', '430343434343'],
    ]);
  });

  it('Kotak-style: Amount with a trailing Dr/Cr marker', () => {
    const csv = 'Sl. No.,Transaction Date,Description,Amount,Balance\n1,12/10/2026,UPI/ZEPTO/430355556666/zepto@ybl,"1,234.00(Dr)",900.00';
    const fixed = csv.replace('(Dr)', ' Dr');
    expect(parseStatementCsv(fixed).rows.map(brief)).toEqual([['2026-10-12', 123400, 'debit', 'Zepto', '430355556666']]);
  });

  it('returns nothing for a file without a recognisable header', () => {
    expect(parseStatementCsv('name,age\nasha,30').rows).toEqual([]);
  });
});

describe('PDF statement text', () => {
  it('uses the running balance to tell debits from credits, and joins wrapped narrations', () => {
    const text = [
      'Statement of Account  Period: 01/10/2026 to 31/10/2026',
      'Date Narration Chq/Ref Value Dt Withdrawal Deposit Balance',
      'Opening Balance 25,000.00',
      '01/10/26 UPI-SWIGGY-swiggy@icici-ICIC0DC0099- 0000430312345678 01/10/26 312.00 24,688.00',
      '430312345678-PAYMENT FROM PHONE',
      '03/10/26 UPI-RAHUL SHARMA-rahul.s@ybl-YESB0000001- 0000430398765432 03/10/26 1,500.00 26,188.00',
      '430398765432-dinner split',
      '04/10/26 POS 512345XXXXXX1234 DMART AVENUE 04/10/26 2,250.50 23,937.50',
      'Page 1 of 3',
    ].join('\n');
    const r = parseStatementText(text);
    expect(r.skipped).toBe(0);
    expect(r.rows.map(brief)).toEqual([
      ['2026-10-01', 31200, 'debit', 'Swiggy', '430312345678'],
      ['2026-10-03', 150000, 'credit', 'Rahul Sharma', '430398765432'],
      ['2026-10-04', 225050, 'debit', 'Dmart Avenue', null],
    ]);
  });

  it('skips the 0.00 that fills an empty withdrawal/deposit column', () => {
    const r = parseStatementText('Opening Balance 1,000.00\n05-10-2026 BY TRANSFER SALARY 0.00 500.00 1,500.00');
    expect(r.rows.map(brief)).toEqual([['2026-10-05', 50000, 'credit', 'Salary', null]]);
  });

  it('handles banks that centre cells vertically (narration above and below the date line)', () => {
    const text = [
      'Opening Balance 12,000.00',
      'UPI-ZOMATO-zomato@hdfcbank-HDFC0000001-',
      '02/09/26 0000425011112222 02/09/26 456.00 11,544.00',
      '425011112222-ORDER',
      '05/09/26 NEFT-ICICN52026090512-ACME TECH PVT LTD-SALARY SEP ICICN5202609 05/09/26 25,000.00 36,544.00',
      'UPI-UBER INDIA-uber.rides@axisbank-UTIB0000001-',
      '07/09/26 0000425033334444 07/09/26 289.50 36,254.50',
      '425033334444-RIDE',
      'UPI-OLA-ola@ybl-YESB0000001-',
      '08/09/26 0000425055556666 08/09/26 150.00 36,104.50',
      '425055556666-RIDE',
    ].join('\n');
    expect(parseStatementText(text).rows.map(brief)).toEqual([
      ['2026-09-02', 45600, 'debit', 'Zomato', '425011112222'],
      ['2026-09-05', 2500000, 'credit', 'Acme Tech Pvt Ltd', null],
      ['2026-09-07', 28950, 'debit', 'Uber India', '425033334444'],
      ['2026-09-08', 15000, 'debit', 'Ola', '425055556666'],
    ]);
  });
});
