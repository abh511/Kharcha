import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IncomeFields, type IncomeValue } from '../components/IncomeFields';
import { api, session } from '../lib/api';

export function Signup() {
  const navigate = useNavigate();
  const [allowSignup, setAllowSignup] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [income, setIncome] = useState<IncomeValue>({ incomeType: 'salary', monthlyIncome: '', savingsGoal: '' });
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
      const { token } = await api<{ token: string }>('/api/auth/register', {
        method: 'POST',
        json: { name, email, password, incomeType: income.incomeType, monthlyIncome: income.monthlyIncome, savingsGoal: income.savingsGoal || null },
      });
      session.set(token);
      navigate('/setup');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/icon.svg" alt="" className="mx-auto mb-4 size-14" />
          <h1 className="font-display text-4xl">Create your account</h1>
          <p className="mt-2 text-muted">Tell us what comes in each month, and we'll help you keep some of it.</p>
        </div>
        {allowSignup ? (
          <form onSubmit={submit} className="card space-y-4 p-6">
            <label className="block">
              <span className="mb-1 block text-sm text-muted">Name</span>
              <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
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
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <span className="mt-1 block text-xs text-muted">At least 8 characters.</span>
            </label>
            <div className="border-t border-line pt-4">
              <IncomeFields value={income} onChange={setIncome} />
            </div>
            {error && <p className="text-sm text-clay">{error}</p>}
            <button className="btn btn-primary w-full" disabled={busy}>
              {busy ? 'Please wait…' : 'Create account'}
            </button>
          </form>
        ) : (
          <p className="card p-6 text-center text-muted">Sign-ups are turned off on this server.</p>
        )}
        <p className="mt-5 text-center text-sm text-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-leaf underline-offset-2 hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
