import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { session } from './lib/api';
import { Budgets } from './pages/Budgets';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Setup } from './pages/Setup';
import { Signup } from './pages/Signup';
import { Transactions } from './pages/Transactions';

function RequireAuth({ children }: { children: ReactNode }) {
  return session.get() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Overview />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="budgets" element={<Budgets />} />
          <Route path="setup" element={<Setup />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
