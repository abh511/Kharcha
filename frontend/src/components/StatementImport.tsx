import { useState } from 'react';
import { api } from '../lib/api';
import { inr } from '../lib/format';
import { dataChanged } from '../lib/hooks';
import { NeedsPassword, readStatement } from '../lib/statement';

interface Preview {
  count: number;
  newCount: number;
  alreadyRecorded: number;
  skipped: number;
  from: string;
  to: string;
  spentPaise: number;
  receivedPaise: number;
  preview: { date: string; merchant: string; amountPaise: number; direction: 'debit' | 'credit'; category: string }[];
}

const dateLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Pick a CSV or PDF statement → preview what's new → import. */
export function StatementImport() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [askPassword, setAskPassword] = useState(false);
  const [parsed, setParsed] = useState<{ format: 'csv' | 'pdf'; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<'idle' | 'reading' | 'importing'>('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load(f: File, pw?: string) {
    setState('reading');
    setError('');
    setMessage('');
    setPreview(null);
    try {
      const statement = await readStatement(f, pw);
      const p = await api<Preview>('/api/import/statement', { method: 'POST', json: { ...statement, dryRun: true } });
      setParsed(statement);
      setPreview(p);
      setAskPassword(false);
    } catch (err) {
      if (err instanceof NeedsPassword) setAskPassword(true);
      setError((err as Error).message);
    } finally {
      setState('idle');
    }
  }

  async function confirm() {
    if (!parsed) return;
    setState('importing');
    setError('');
    try {
      const r = await api<{ imported: number }>('/api/import/statement', { method: 'POST', json: { ...parsed, dryRun: false } });
      setMessage(`Imported ${r.imported} transaction${r.imported === 1 ? '' : 's'}. They're in Activity and your Overview now.`);
      setPreview(null);
      setParsed(null);
      setFile(null);
      dataChanged.emit();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setState('idle');
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer flex-wrap items-center gap-3">
        <span className="btn btn-primary">{state === 'reading' ? 'Reading…' : 'Choose statement'}</span>
        <span className="text-sm text-muted">{file ? file.name : 'CSV or PDF, from your bank’s app or netbanking'}</span>
        <input
          type="file"
          accept=".csv,.txt,.pdf,text/csv,application/pdf"
          className="hidden"
          disabled={state !== 'idle'}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setFile(f);
            setPassword('');
            load(f);
          }}
        />
      </label>

      {askPassword && file && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            load(file, password);
          }}
        >
          <input
            className="input max-w-56"
            type="password"
            autoFocus
            placeholder="PDF password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="btn btn-ghost" disabled={!password || state !== 'idle'}>
            Open
          </button>
          <span className="w-full text-xs text-muted">Banks usually use part of your name and date of birth. The password stays on this device.</span>
        </form>
      )}

      {error && <p className="text-sm text-clay">{error}</p>}
      {message && <p className="text-sm text-leaf">{message}</p>}

      {preview && (
        <div className="space-y-3 rounded-xl border border-line p-4">
          <p className="text-sm">
            <b>{preview.count}</b> transactions from {dateLabel(preview.from)} to {dateLabel(preview.to)}.{' '}
            {preview.alreadyRecorded > 0 && <>{preview.alreadyRecorded} are already in Kharcha and will be skipped. </>}
            {preview.skipped > 0 && <>{preview.skipped} rows couldn’t be read. </>}
          </p>
          {preview.newCount > 0 ? (
            <>
              <p className="money text-sm text-muted">
                New: {preview.newCount} · spent {inr(preview.spentPaise)} · received {inr(preview.receivedPaise)}
              </p>
              <div className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg bg-paper text-sm">
                {preview.preview.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-16 shrink-0 text-xs text-muted">{dateLabel(t.date).replace(/ \d{4}$/, '')}</span>
                    <span className="min-w-0 flex-1 truncate">{t.merchant}</span>
                    <span className="hidden text-xs text-muted sm:inline">{t.category}</span>
                    <span className={`money w-24 text-right ${t.direction === 'credit' ? 'text-leaf' : ''}`}>
                      {t.direction === 'credit' ? '+' : ''}
                      {inr(t.amountPaise)}
                    </span>
                  </div>
                ))}
              </div>
              {preview.newCount > preview.preview.length && <p className="text-xs text-muted">Showing the first {preview.preview.length}.</p>}
              <button onClick={confirm} disabled={state !== 'idle'} className="btn btn-primary">
                {state === 'importing' ? 'Importing…' : `Import ${preview.newCount} transactions`}
              </button>
            </>
          ) : (
            <p className="text-sm text-muted">Nothing new in this statement.</p>
          )}
        </div>
      )}
    </div>
  );
}
