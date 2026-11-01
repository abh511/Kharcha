import { useState, type FormEvent } from 'react';
import { api, type Direction, type Txn } from '../lib/api';
import { CATEGORIES } from '../lib/categories';
import { inr, toLocalInput } from '../lib/format';
import { dataChanged } from '../lib/hooks';
import { Sheet } from './Sheet';

export function AddTransaction({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [direction, setDirection] = useState<Direction>('debit');
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('');
  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/transactions', {
        method: 'POST',
        json: { amount, direction, merchant, category: category || undefined, note, occurredAt: new Date(when).toISOString() },
      });
      dataChanged.emit();
      setAmount('');
      setMerchant('');
      setNote('');
      setCategory('');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add a transaction">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-full bg-paper p-1">
          {(['debit', 'credit'] as const).map((d) => (
            <button
              type="button"
              key={d}
              onClick={() => setDirection(d)}
              className={`rounded-full py-2 text-sm font-semibold transition ${direction === d ? 'bg-card shadow-sm' : 'text-muted'}`}
            >
              {d === 'debit' ? 'Spent' : 'Received'}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="mb-1 block text-sm text-muted">Amount</span>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-display text-2xl text-muted">₹</span>
            <input
              className="input money pl-10 font-display text-2xl"
              inputMode="decimal"
              placeholder="0"
              required
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            />
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-muted">{direction === 'debit' ? 'Paid to' : 'Received from'}</span>
          <input className="input" required maxLength={100} placeholder="e.g. Chai stall" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm text-muted">Category</span>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Auto-detect</option>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-muted">When</span>
            <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm text-muted">Note (optional)</span>
          <input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="text-sm text-clay">{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Sheet>
  );
}

export function EditTransaction({ txn, onClose }: { txn: Txn | null; onClose: () => void }) {
  return (
    <Sheet open={!!txn} onClose={onClose} title="Transaction">
      {txn && <EditBody key={txn.id} txn={txn} onClose={onClose} />}
    </Sheet>
  );
}

function EditBody({ txn, onClose }: { txn: Txn; onClose: () => void }) {
  const [category, setCategory] = useState(txn.category);
  const [merchant, setMerchant] = useState(txn.merchant);
  const [note, setNote] = useState(txn.note);
  const [applyToSimilar, setApplyToSimilar] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ updatedSimilar: number }>(`/api/transactions/${txn.id}`, {
        method: 'PATCH',
        json: { category, merchant, note, applyToSimilar: applyToSimilar && category !== txn.category },
      });
      dataChanged.emit();
      if (r.updatedSimilar > 0) {
        setResult(`Also moved ${r.updatedSimilar} earlier transaction${r.updatedSimilar === 1 ? '' : 's'} to ${category}.`);
        setTimeout(onClose, 1400);
      } else onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this transaction?')) return;
    await api(`/api/transactions/${txn.id}`, { method: 'DELETE' });
    dataChanged.emit();
    onClose();
  }

  const who = txn.vpa ?? txn.merchant;
  return (
    <form onSubmit={save} className="space-y-4">
      <div className="rounded-2xl bg-paper p-4">
        <p className={`money font-display text-3xl ${txn.direction === 'credit' ? 'text-leaf' : ''}`}>
          {txn.direction === 'credit' ? '+' : '−'}
          {inr(txn.amountPaise)}
        </p>
        <p className="mt-1 text-sm text-muted">
          {new Date(txn.occurredAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted">
          {txn.vpa && (<><dt>UPI ID</dt><dd className="truncate text-ink">{txn.vpa}</dd></>)}
          {txn.bank && (<><dt>Bank</dt><dd className="text-ink">{txn.bank}{txn.accountLast4 ? ` ··${txn.accountLast4}` : ''}</dd></>)}
          {txn.upiRef && (<><dt>UPI ref</dt><dd className="money text-ink">{txn.upiRef}</dd></>)}
          <dt>Source</dt>
          <dd className="text-ink">{txn.source === 'manual' ? 'Added by you' : txn.source === 'statement' ? 'Bank statement' : 'Bank SMS'}</dd>
        </dl>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm text-muted">Name</span>
        <input className="input" maxLength={100} value={merchant} onChange={(e) => setMerchant(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-muted">Category</span>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {[...new Set([...CATEGORIES, txn.category])].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {category !== txn.category && (
        <label className="flex items-start gap-3 rounded-2xl border border-line p-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-leaf" checked={applyToSimilar} onChange={(e) => setApplyToSimilar(e.target.checked)} />
          <span>
            Always put <b>{who}</b> under <b>{category}</b>
            <span className="block text-muted">Updates past payments too, and remembers it for new ones.</span>
          </span>
        </label>
      )}
      <label className="block">
        <span className="mb-1 block text-sm text-muted">Note</span>
        <input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="text-sm text-clay">{error}</p>}
      {result && <p className="text-sm text-leaf">{result}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={remove} className="btn btn-ghost text-clay">
          Delete
        </button>
        <button className="btn btn-primary flex-1" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
