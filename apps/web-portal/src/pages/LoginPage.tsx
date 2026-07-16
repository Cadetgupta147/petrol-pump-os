import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';

// Section 2 — web portal login, Staff.phone + password (see
// apps/backend/src/auth/dto/login.dto.ts). Owner/Accountant only today,
// since those are the only roles seed.ts provisions passwordHash for.
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(phone.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      // The backend gives the same "Invalid credentials" message for every
      // failure mode (unknown phone, wrong password, inactive staff) on
      // purpose — see LoginDto's comment on login-enumeration hygiene. We
      // surface that message as-is rather than guessing which part failed,
      // except when the server was simply unreachable.
      setError(err instanceof ApiError ? err.message : "Can't reach the server — check that the backend is running.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="topbar-brand" style={{ marginBottom: 24 }}>
          <div className="topbar-drop" style={{ background: 'var(--orange)' }} />
          <span className="topbar-title" style={{ color: 'var(--navy)', fontSize: 18 }}>
            PumpOS
          </span>
        </div>
        <div className="login-field">
          <label htmlFor="phone">Phone</label>
          <input
            id="phone"
            type="tel"
            autoComplete="username"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="9990000001"
            required
          />
        </div>
        <div className="login-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <div className="login-error">{error}</div>}
        <button className="login-submit" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
