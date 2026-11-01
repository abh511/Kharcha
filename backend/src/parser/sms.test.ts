import { describe, expect, it } from 'vitest';
import { categorize } from './categorize.js';
import { looksTransactional, parseSms, prettifyVpa } from './sms.js';

// 30 Oct 2026, 14:25 IST
const RECEIVED = new Date('2026-10-30T08:55:00Z');

interface Case {
  name: string;
  sender: string;
  body: string;
  expect: {
    amountPaise: number;
    direction: 'debit' | 'credit';
    merchant?: string;
    vpa?: string | null;
    upiRef?: string | null;
    accountLast4?: string | null;
    bank?: string;
    category?: string;
  };
}

const CASES: Case[] = [
  {
    name: 'HDFC new multi-line debit',
    sender: 'VM-HDFCBK-S',
    body: 'Sent Rs.250.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 30/10/26\nRef 430312345678\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808',
    expect: { amountPaise: 25000, direction: 'debit', merchant: 'Swiggy', upiRef: '430312345678', accountLast4: '1234', bank: 'HDFC Bank', category: 'Food' },
  },
  {
    name: 'HDFC older VPA debit',
    sender: 'AD-HDFCBK',
    body: 'Rs.1,499.00 debited from a/c **1234 on 30-10-26 to VPA zeptonow@ybl(UPI Ref No 430398765432). Not you? Call on 18002586161 to report',
    expect: { amountPaise: 149900, direction: 'debit', vpa: 'zeptonow@ybl', merchant: 'Zeptonow', upiRef: '430398765432', accountLast4: '1234', category: 'Groceries' },
  },
  {
    name: 'HDFC credit from VPA',
    sender: 'VM-HDFCBK',
    body: 'Rs.500.00 credited to HDFC Bank A/c XX1234 on 30-10-26 from VPA rahul.sharma@okaxis (UPI 430311112222)',
    expect: { amountPaise: 50000, direction: 'credit', vpa: 'rahul.sharma@okaxis', merchant: 'Rahul Sharma', upiRef: '430311112222', category: 'Income' },
  },
  {
    name: 'SBI debit (no currency symbol)',
    sender: 'AD-SBIUPI',
    body: 'Dear UPI user A/C X5678 debited by 120.0 on date 30Oct26 trf to RAPIDO Refno 430355556666. If not u? call 1800111109. -SBI',
    expect: { amountPaise: 12000, direction: 'debit', merchant: 'Rapido', upiRef: '430355556666', accountLast4: '5678', bank: 'SBI', category: 'Transport' },
  },
  {
    name: 'SBI credit',
    sender: 'JD-SBIUPI',
    body: 'Dear SBI UPI User, ur A/cX5678 credited by Rs2000 on 30Oct26 by (Ref no 430377778888)',
    expect: { amountPaise: 200000, direction: 'credit', upiRef: '430377778888', accountLast4: '5678', bank: 'SBI', category: 'Income' },
  },
  {
    name: 'ICICI debit',
    sender: 'JD-ICICIT',
    body: 'ICICI Bank Acct XX234 debited for Rs 349.00 on 30-Oct-26; NETFLIX credited. UPI:430312121212. Call 18002662 for dispute. SMS BLOCK 234 to 9215676766.',
    expect: { amountPaise: 34900, direction: 'debit', merchant: 'Netflix', upiRef: '430312121212', accountLast4: '234', bank: 'ICICI Bank', category: 'Entertainment' },
  },
  {
    name: 'ICICI credit',
    sender: 'VM-ICICIB',
    body: 'Dear Customer, Acct XX234 is credited with Rs 15,000.00 on 30-Oct-26 from ACME TECH PVT LTD. UPI:430343434343-ICICI Bank.',
    expect: { amountPaise: 1500000, direction: 'credit', merchant: 'Acme Tech Pvt Ltd', upiRef: '430343434343', category: 'Income' },
  },
  {
    name: 'Axis multi-line debit',
    sender: 'AX-AXISBK',
    body: 'INR 899.00 debited\nA/c no. XX9012\n30-10-26, 14:22:11\nUPI/P2M/430365656565/AMAZON PAY\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank',
    expect: { amountPaise: 89900, direction: 'debit', merchant: 'Amazon Pay', upiRef: '430365656565', accountLast4: '9012', bank: 'Axis Bank', category: 'Shopping' },
  },
  {
    name: 'Kotak sent',
    sender: 'VK-KOTAKB',
    body: 'Sent Rs.60.00 from Kotak Bank AC X3456 to 9876543210@ybl on 30-10-26.UPI Ref 430387878787. Not you, https://kotak.com/KBANKT/Fraud',
    expect: { amountPaise: 6000, direction: 'debit', vpa: '9876543210@ybl', merchant: '9876543210', upiRef: '430387878787', accountLast4: '3456', bank: 'Kotak', category: 'Transfers' },
  },
  {
    name: 'Kotak received',
    sender: 'VK-KOTAKB',
    body: 'Received Rs.750.00 in your Kotak Bank AC X3456 from priya@oksbi on 30-10-26.UPI Ref:430390909090.',
    expect: { amountPaise: 75000, direction: 'credit', vpa: 'priya@oksbi', merchant: 'Priya', upiRef: '430390909090', category: 'Income' },
  },
  {
    name: 'balance figure is not mistaken for the amount',
    sender: 'BZ-SBIINB',
    body: 'Your a/c no. XXXXX5678 is debited for Rs.2,100.00 on 30-10-26 by UPI to IRCTC (UPI Ref no 430301010101). Avl Bal Rs 12,345.67',
    expect: { amountPaise: 210000, direction: 'debit', merchant: 'Irctc', upiRef: '430301010101', category: 'Travel' },
  },
  {
    name: 'refund credit',
    sender: 'VM-HDFCBK',
    body: 'Rs.199.00 credited to HDFC Bank A/c XX1234 on 30-10-26 towards refund from FLIPKART (UPI 430302020202)',
    expect: { amountPaise: 19900, direction: 'credit', upiRef: '430302020202', category: 'Refunds' },
  },
];

describe('parseSms — supported bank formats', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const r = parseSms(c.body, c.sender, RECEIVED);
      if (!r.ok) throw new Error(`expected a transaction, got: ${r.reason}`);
      const t = r.txn;
      expect(t.amountPaise).toBe(c.expect.amountPaise);
      expect(t.direction).toBe(c.expect.direction);
      if ('merchant' in c.expect) expect(t.merchant).toBe(c.expect.merchant);
      if ('vpa' in c.expect) expect(t.vpa).toBe(c.expect.vpa);
      if ('upiRef' in c.expect) expect(t.upiRef).toBe(c.expect.upiRef);
      if ('accountLast4' in c.expect) expect(t.accountLast4).toBe(c.expect.accountLast4);
      if (c.expect.bank) expect(t.bank).toBe(c.expect.bank);
      if (c.expect.category) {
        expect(categorize({ merchant: t.merchant, vpa: t.vpa, direction: t.direction, rawText: c.body })).toBe(c.expect.category);
      }
    });
  }
});

describe('parseSms — rejects things that are not completed payments', () => {
  const rejects: Array<[string, string]> = [
    ['OTP', '123456 is your OTP for txn of Rs 2,000.00 at AMAZON. Valid for 10 mins. Do not share. -HDFC Bank'],
    ['collect request', 'Rahul has requested money of Rs 500 from you on Google Pay. Approve to pay.'],
    ['failed', 'Your UPI txn of Rs 300.00 to SWIGGY failed. Ref 430312340000. -SBI'],
    ['due reminder', 'Your credit card bill of Rs 4,500 is due on 05-11-26. Pay now to avoid charges.'],
    ['autopay notice', 'Rs 649 will be debited on 02-11-26 for NETFLIX autopay mandate.'],
    ['offer', 'Congrats! You have a pre-approved loan offer of Rs 5,00,000. Apply now.'],
    ['personal chat', 'hey are we still on for dinner tonight?'],
  ];
  for (const [name, body] of rejects) {
    it(name, () => expect(parseSms(body, 'XX-TEST', RECEIVED).ok).toBe(false));
  }
});

describe('dates', () => {
  it('uses the arrival time when the SMS date is the same day', () => {
    const r = parseSms(CASES[0]!.body, 'VM-HDFCBK', RECEIVED);
    expect(r.ok && r.txn.occurredAt.toISOString()).toBe(RECEIVED.toISOString());
  });
  it('reads an explicit IST time', () => {
    const r = parseSms(CASES[7]!.body, 'AX-AXISBK', RECEIVED);
    // 14:22:11 IST = 08:52:11 UTC
    expect(r.ok && r.txn.occurredAt.toISOString()).toBe('2026-10-30T08:52:11.000Z');
  });
  it('uses the SMS date for a delayed SMS', () => {
    const r = parseSms('Rs.100.00 debited from a/c **1234 on 28-10-26 to VPA abc@ybl(UPI Ref No 430300000001).', 'HDFCBK', RECEIVED);
    expect(r.ok && r.txn.occurredAt.toISOString()).toBe('2026-10-28T06:30:00.000Z'); // noon IST
  });
});

describe('helpers', () => {
  it('looksTransactional filters chat messages', () => {
    expect(looksTransactional('hello there')).toBe(false);
    expect(looksTransactional(CASES[0]!.body)).toBe(true);
  });
  it('prettifyVpa', () => {
    expect(prettifyVpa('swiggy.food@icici')).toBe('Swiggy Food');
    expect(prettifyVpa('9876543210@ybl')).toBe('9876543210');
  });
  it('user rules beat defaults, longest first', () => {
    const rules = [
      { pattern: 'amazon', category: 'Shopping' },
      { pattern: 'amazon prime', category: 'Entertainment' },
    ];
    expect(categorize({ merchant: 'Amazon Prime', vpa: null, direction: 'debit' }, rules)).toBe('Entertainment');
    expect(categorize({ merchant: 'Swiggy', vpa: null, direction: 'debit' }, [{ pattern: 'swiggy', category: 'Rent' }])).toBe('Rent');
  });
});
