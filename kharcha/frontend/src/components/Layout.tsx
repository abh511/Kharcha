import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { session } from '../lib/api';
import { AddTransaction } from './TxnForms';

const NAV = [
  { to: '/', label: 'Overview', icon: 'M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6v-9h-6v9zm0-16v5h6V4h-6z' },
  { to: '/transactions', label: 'Activity', icon: 'M4 6h16M4 12h16M4 18h10' },
  { to: '/budgets', label: 'Budgets', icon: 'M12 3a9 9 0 109 9h-9V3z' },
  { to: '/setup', label: 'Setup', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 00-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 002 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z' },
];

export function Layout() {
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 pb-28 sm:px-6 sm:pb-12">
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="" className="size-8" />
          <span className="font-display text-2xl">Kharcha</span>
        </div>
        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => `rounded-full px-4 py-2 text-sm font-semibold transition ${isActive ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}
            >
              {n.label}
            </NavLink>
          ))}
          <button onClick={() => setAdding(true)} className="btn btn-primary ml-2 text-sm">
            + Add
          </button>
        </nav>
        <button
          onClick={() => {
            session.clear();
            navigate('/login');
          }}
          className="text-sm text-muted hover:text-ink sm:hidden"
        >
          Log out
        </button>
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="mt-10 hidden justify-end sm:flex">
        <button
          onClick={() => {
            session.clear();
            navigate('/login');
          }}
          className="text-sm text-muted hover:text-ink"
        >
          Log out
        </button>
      </footer>

      {/* Phone: floating add button + bottom tab bar */}
      <button
        onClick={() => setAdding(true)}
        aria-label="Add transaction"
        className="fixed bottom-24 right-5 z-30 grid size-14 place-items-center rounded-full bg-leaf text-paper shadow-lg shadow-leaf/30 sm:hidden"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => `flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${isActive ? 'text-leaf' : 'text-muted'}`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d={n.icon} />
            </svg>
            {n.label}
          </NavLink>
        ))}
      </nav>

      <AddTransaction open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
