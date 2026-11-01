import { useState, type ReactNode } from 'react';
import { api, type RawMessage } from '../lib/api';
import { StatementImport } from '../components/StatementImport';
import { dataChanged, useAsync } from '../lib/hooks';

const SAMPLE_SMS = {
  from: 'VM-HDFCBK',
  text: 'Sent Rs.149.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn {date}\nRef {ref}\nNot You? Call 18002586161',
};

export function Setup() {
  const me = useAsync(() => api<{ email: string; hasIngestToken: boolean }>('/api/me'), []);
  const messages = useAsync(() => api<RawMessage[]>('/api/messages'), []);
  const rules = useAsync(() => api<{ id: number; pattern: string; category: string }[]>('/api/rules'), []);
  const [token, setToken] = useState<string | null>(null);
  const [testState, setTestState] = useState('');

  const webhookUrl = `${window.location.origin}/api/ingest/sms`;
  const headers = token ? `{"Authorization": "Bearer ${token}"}` : '{"Authorization": "Bearer <your token>"}';
  const template = '{"from":"%from%","text":"%text%","receivedStamp":%receivedStamp%}';

  async function makeToken() {
    if (me.data?.hasIngestToken && !window.confirm('This replaces your current token. Your phone will stop syncing until you paste the new one. Continue?')) return;
    const r = await api<{ token: string }>('/api/me/ingest-token', { method: 'POST' });
    setToken(r.token);
    me.reload();
  }

  async function sendTest() {
    if (!token) return;
    setTestState('Sending…');
    const now = new Date();
    const date = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(2)}`;
    const ref = String(Math.floor(1e11 + Math.random() * 9e11));
    const res = await fetch('/api/ingest/sms', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ from: SAMPLE_SMS.from, text: SAMPLE_SMS.text.replace('{date}', date).replace('{ref}', ref), receivedStamp: Date.now() }),
    });
    const body = await res.json();
    setTestState(res.ok ? `Server said: ${body.status}. Processing…` : `Failed: ${body.error}`);
    setTimeout(() => {
      messages.reload();
      dataChanged.emit();
      setTestState(res.ok ? 'Done — check the log below and your Overview. (Delete the test ₹149 Swiggy entry when you like.)' : '');
    }, 1500);
  }

  async function reparse(id: number) {
    await api(`/api/messages/${id}/reparse`, { method: 'POST' });
    setTimeout(() => {
      messages.reload();
      dataChanged.emit();
    }, 1000);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl">Connect your bank</h1>
        <p className="mt-1 max-w-2xl text-muted">
          Your bank texts you after every payment. Kharcha reads those texts and turns them into transactions, so you don't have to type
          anything in.
        </p>
      </div>

      <section className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold">Automatic: the Kharcha app for Android</h2>
          <p className="mt-1 text-sm text-muted">Records every UPI payment as it happens, and brings in your last 90 days on day one.</p>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            On your Android phone, open this page and tap{' '}
            <a href="/kharcha.apk" download className="font-semibold text-leaf underline">
              Download the app
            </a>
            . If Android asks, allow your browser to install apps.
          </li>
          <li>
            Open Kharcha and log in with <b>{me.data?.email ?? 'this account'}</b>. Server address:{' '}
            <code className="break-all">{window.location.origin}</code>
          </li>
          <li>
            Tap <b>Allow</b> when it asks to read SMS. Only bank messages about money are sent; personal texts never leave your phone.
          </li>
        </ol>
      </section>

      <section className="card space-y-3 p-5">
        <div>
          <h2 className="font-semibold">Upload a bank statement</h2>
          <p className="mt-1 text-sm text-muted">
            For iPhone, or to bring in older months. Download a statement from your bank's app or netbanking. Payments already in Kharcha are
            skipped, so uploading again is safe.
          </p>
        </div>
        <StatementImport />
      </section>

      <details className="group card p-5">
        <summary className="cursor-pointer font-semibold">Advanced: use a different SMS-forwarder app</summary>
        <div className="mt-4 space-y-5">
      <Step n={1} title="Get your secret token">
        {token ? (
          <div className="space-y-2">
            <p className="text-sm text-clay">Copy it now. For safety it won't be shown again.</p>
            <Copyable value={token} />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={makeToken} className="btn btn-primary">
              {me.data?.hasIngestToken ? 'Replace token' : 'Create token'}
            </button>
            {me.data?.hasIngestToken && <span className="text-sm text-muted">You already have a token. Only replace it if you lost it.</span>}
          </div>
        )}
      </Step>

      <Step n={2} title="Install an SMS forwarder on your Android phone">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Install an app that forwards incoming SMS to a URL (webhook). The open-source <b>“Incoming SMS to URL forwarder”</b> works well.
          </li>
          <li>
            Add a forwarding rule. Set <b>sender</b> to your bank's ID (like <code>HDFCBK</code> or <code>SBIUPI</code>) or use <code>*</code>. Kharcha drops any SMS that isn't a bank transaction without storing it.
          </li>
          <li>
            <span className="block">Webhook URL:</span>
            <Copyable value={webhookUrl} />
          </li>
          <li>
            <span className="block">Headers:</span>
            <Copyable value={headers} />
          </li>
          <li>
            <span className="block">JSON body template (field names can differ by app; <code>from</code> and <code>text</code> are what matter):</span>
            <Copyable value={template} />
          </li>
          <li>Let the app ignore battery optimisation, so Android doesn't stop it in the background.</li>
        </ol>
              </Step>

      <Step n={3} title="Test it">
        {token ? (
          <div className="space-y-2">
            <button onClick={sendTest} className="btn btn-ghost">Send a sample bank SMS</button>
            {testState && <p className="text-sm text-muted">{testState}</p>}
          </div>
        ) : (
          <p className="text-sm text-muted">Create a token first, or pay ₹1 to a friend and watch it show up in the log below.</p>
        )}
      </Step>
        </div>
      </details>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="font-semibold">Message log</h2>
          <button onClick={messages.reload} className="text-sm font-semibold text-leaf">Refresh</button>
        </div>
        <p className="px-5 pb-3 text-sm text-muted">Every SMS the server received, and what the parser did with it.</p>
        <div className="divide-y divide-line">
          {messages.data?.length === 0 && <p className="px-5 pb-5 text-sm text-muted">Nothing received yet.</p>}
          {messages.data?.map((m) => (
            <div key={m.id} className="flex gap-3 px-5 py-3 text-sm">
              <StatusPill status={m.status} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted">
                  {m.sender || 'unknown sender'} · {new Date(m.receivedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  {m.note && <> · {m.note}</>}
                </p>
                <p className="mt-0.5 line-clamp-2 break-words">{m.body}</p>
              </div>
              {(m.status === 'ignored' || m.status === 'failed') && (
                <button onClick={() => reparse(m.id)} className="self-start text-xs font-semibold text-leaf">Re-parse</button>
              )}
            </div>
          ))}
        </div>
      </section>

      {rules.data && rules.data.length > 0 && (
        <section className="card p-5">
          <h2 className="font-semibold">Your category rules</h2>
          <p className="mb-3 text-sm text-muted">Created when you change a category and tick “always”.</p>
          <ul className="divide-y divide-line text-sm">
            {rules.data.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <span>
                  <code>{r.pattern}</code> → <b>{r.category}</b>
                </span>
                <button
                  onClick={async () => {
                    await api(`/api/rules/${r.id}`, { method: 'DELETE' });
                    rules.reload();
                  }}
                  className="text-xs text-clay"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="card flex gap-4 p-5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-leaf font-display text-paper">{n}</span>
      <div className="min-w-0 flex-1">
        <h2 className="mb-3 font-semibold">{title}</h2>
        {children}
      </div>
    </section>
  );
}

function Copyable({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-1 flex items-center gap-2 rounded-xl border border-line bg-paper p-2 pl-3">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs">{value}</code>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          } catch {
            /* clipboard blocked: user can select manually */
          }
        }}
        className="btn btn-ghost shrink-0 px-3 py-1 text-xs"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function StatusPill({ status }: { status: RawMessage['status'] }) {
  const styles: Record<RawMessage['status'], string> = {
    parsed: 'bg-leaf-soft text-leaf',
    duplicate: 'bg-paper text-muted',
    ignored: 'bg-paper text-muted',
    queued: 'bg-[#f6ecd2] text-[#8a6a17]',
    failed: 'bg-clay-soft text-clay',
  };
  return <span className={`h-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${styles[status]}`}>{status}</span>;
}
