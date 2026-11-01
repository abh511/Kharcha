import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, session } from '../lib/api';

export function Login() {
  const navigate = useNavigate();
  const [allowSignup, setAllowSignup] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ allowSignup: boolean }>('/api/auth/config').then((c) => setAllowSignup(c.allowSignup)).catch(() => {});
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token } = await api<{ token: string }>('/api/auth/login', { method: 'POST', json: { email, password } });
      session.set(token);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/icon.svg" alt="" className="mx-auto mb-4 size-14" />
          <h1 className="font-display text-4xl">Kharcha</h1>
          <p className="mt-2 text-muted">Every UPI payment, tracked from your bank SMS.</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          <label className="block">
            <span className="mb-1 block text-sm text-muted">Email</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-muted">Password</span>
            <input
              className="input"
              type="password"
              minLength={8}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-clay">{error}</p>}
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? 'Please wait…' : 'Log in'}
          </button>
        </form>
        {allowSignup && (
          <p className="mt-5 text-center text-sm text-muted">
            First time here?{' '}
            <Link to="/signup" className="font-semibold text-leaf underline-offset-2 hover:underline">
              Create an account
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
