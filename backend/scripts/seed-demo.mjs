#!/usr/bin/env node
// Fills a local server with ~2 months of realistic bank SMS, sent through the real webhook.
//   node scripts/seed-demo.mjs [baseUrl] [email] [password]
const base = process.argv[2] ?? 'http://localhost:8080';
const email = process.argv[3] ?? 'demo@kharcha.local';
const password = process.argv[4] ?? 'demo-password-123';

async function call(path, body, token) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let r = await call('/api/auth/register', { email, password });
if (r.status === 409) r = await call('/api/auth/login', { email, password });
if (!r.body.token) throw new Error(`auth failed: ${JSON.stringify(r.body)}`);
const jwt = r.body.token;
const { body: { token } } = await call('/api/me/ingest-token', {}, jwt);

const pad = (n) => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let refSeq = 430300000000;

// [sender, template(amount, date, ref)]
const fmt = {
  hdfc: (who, amt, d, ref) => ['VM-HDFCBK', `Sent Rs.${amt}\nFrom HDFC Bank A/C *4821\nTo ${who}\nOn ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}\nRef ${ref}\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808`],
  hdfcVpa: (vpa, amt, d, ref) => ['AD-HDFCBK', `Rs.${amt} debited from a/c **4821 on ${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${String(d.getFullYear()).slice(2)} to VPA ${vpa}(UPI Ref No ${ref}). Not you? Call on 18002586161 to report`],
  sbi: (who, amt, d, ref) => ['AD-SBIUPI', `Dear UPI user A/C X7730 debited by ${amt} on date ${pad(d.getDate())}${MON[d.getMonth()]}${String(d.getFullYear()).slice(2)} trf to ${who} Refno ${ref}. If not u? call 1800111109. -SBI`],
  icici: (who, amt, d, ref) => ['JD-ICICIT', `ICICI Bank Acct XX519 debited for Rs ${amt} on ${pad(d.getDate())}-${MON[d.getMonth()]}-${String(d.getFullYear()).slice(2)}; ${who} credited. UPI:${ref}. Call 18002662 for dispute.`],
  salary: (who, amt, d, ref) => ['VM-ICICIB', `Dear Customer, Acct XX519 is credited with Rs ${amt} on ${pad(d.getDate())}-${MON[d.getMonth()]}-${String(d.getFullYear()).slice(2)} from ${who}. UPI:${ref}-ICICI Bank.`],
};

const plan = [
  // [day, hour, format, counterparty, amount]
  [1, 9, 'salary', 'ACME TECH PVT LTD', '25,000.00'],
  [1, 10, 'hdfcVpa', 'nobroker.rent@hdfcbank', '8,500.00'],
  [2, 13, 'hdfc', 'SWIGGY', '312.00'],
  [3, 8, 'sbi', 'RAPIDO', '86.0'],
  [3, 19, 'hdfcVpa', 'zeptonow@ybl', '642.00'],
  [4, 21, 'icici', 'NETFLIX', '199.00'],
  [5, 14, 'hdfc', 'ZOMATO', '458.00'],
  [6, 11, 'hdfcVpa', 'amazonpay@apl', '1,299.00'],
  [7, 9, 'sbi', 'UBER INDIA', '214.0'],
  [8, 20, 'hdfc', 'SWIGGY', '276.00'],
  [9, 18, 'hdfcVpa', 'blinkit@icici', '389.00'],
  [10, 12, 'icici', 'AIRTEL', '349.00'],
  [11, 16, 'hdfcVpa', '9812345678@ybl', '500.00'],
  [12, 13, 'hdfc', 'STARBUCKS', '385.00'],
  [13, 10, 'sbi', 'IRCTC', '1,145.0'],
  [14, 20, 'hdfc', 'ZOMATO', '512.00'],
  [15, 15, 'hdfcVpa', 'apollopharmacy@icici', '268.00'],
  [16, 8, 'sbi', 'RAPIDO', '92.0'],
  [17, 19, 'hdfcVpa', 'zeptonow@ybl', '734.00'],
  [18, 21, 'icici', 'SPOTIFY', '119.00'],
  [19, 13, 'hdfc', 'SWIGGY', '298.00'],
  [20, 11, 'hdfcVpa', 'myntra@icici', '1,849.00'],
  [21, 9, 'hdfcVpa', 'groww.sip@hdfcbank', '2,000.00'],
  [22, 20, 'hdfc', 'DOMINOS PIZZA', '549.00'],
  [23, 17, 'icici', 'BOOKMYSHOW', '420.00'],
  [24, 10, 'hdfcVpa', 'bescom@billdesk', '1,120.00'],
  [25, 18, 'hdfcVpa', 'rohan.k@okaxis', '650.00'],
  [26, 9, 'sbi', 'HPCL FUEL', '1,000.0'],
  [27, 14, 'hdfc', 'ZOMATO', '366.00'],
  [28, 19, 'hdfcVpa', 'bigbasket@ybl', '1,206.00'],
  [29, 13, 'hdfc', 'SWIGGY', '334.00'],
  [30, 10, 'hdfcVpa', 'udemy@icici', '499.00'],
  [30, 14, 'sbi', 'UBER INDIA', '188.0'],
];

const now = new Date();
let sent = 0;
for (const monthsAgo of [1, 0]) {
  const y = now.getFullYear();
  const m = now.getMonth() - monthsAgo;
  for (const [day, hour, f, who, amt] of plan) {
    const d = new Date(y, m, day, hour, 7 + (day % 40));
    if (d > now) continue;
    // Spend a bit less last month so the comparison means something.
    const scaled = monthsAgo === 1 && f !== 'salary' && f !== 'hdfcVpa' ? amt.replace(/^(\d)/, (x) => String(Math.max(1, Number(x) - 1))) : amt;
    const [from, text] = fmt[f](who, scaled, d, String(refSeq++));
    const res = await call('/api/ingest/sms', { from, text, receivedStamp: d.getTime() + 20_000 }, token);
    if (res.status >= 400) console.error(res.status, res.body, text);
    sent++;
  }
}
// A forwarder retry and a non-bank SMS, to show idempotency and privacy filtering.
await call('/api/ingest/sms', { from: 'VM-HDFCBK', text: fmt.hdfc('SWIGGY', '312.00', new Date(now.getFullYear(), now.getMonth(), 2, 13, 9), '430300000035')[1] }, token);
await call('/api/ingest/sms', { from: '+919876543210', text: 'Reached home, call you in 10' }, token);

await new Promise((res) => setTimeout(res, 1500));
for (const [category, limit] of [['Food', 2500], ['Groceries', 3000], ['Shopping', 2500], ['Transport', 1500]]) {
  await fetch(base + '/api/budgets', {
    method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` }, body: JSON.stringify({ category, limit }),
  });
}
console.log(`Sent ${sent} bank SMS. Log in as ${email} / ${password}`);
