import { useState } from 'react';
import useAuthStore from '../store/authStore';
import { login } from '../api/auth';

export default function LoginPage() {
  const setToken = useAuthStore(s => s.setToken);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const disabled = loading || !username || !password;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setError('');
    setLoading(true);
    try {
      const data = await login(username, password);
      setToken(data.access_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid username or password.');
    } finally {
      setLoading(false);
    }
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--txt-3)',
    display: 'block',
    marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 42,
    background: 'var(--raised)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '0 12px',
    color: 'var(--txt)',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <div style={{
        maxWidth: 400,
        width: '100%',
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 24,
        margin: '0 16px',
      }}>
        {/* Logo row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect width="22" height="22" rx="5" fill="#4080ff" />
            <path d="M7.5 6v10l9-5-9-5Z" fill="white" />
          </svg>
          <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em', color: 'var(--txt)' }}>VibeCoder</span>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--txt-3)', marginLeft: 2 }}>Encoder</span>
        </div>

        {/* Divider */}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, marginBottom: 16 }} />

        <form onSubmit={handleSubmit}>
          {/* Username */}
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="login-username" style={labelStyle}>Username</label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              style={inputStyle}
              disabled={loading}
              onFocus={e => { e.currentTarget.style.border = '1px solid #4080ff80'; }}
              onBlur={e => { e.currentTarget.style.border = '1px solid var(--border)'; }}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="login-password" style={labelStyle}>Password</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              style={inputStyle}
              disabled={loading}
              onFocus={e => { e.currentTarget.style.border = '1px solid #4080ff80'; }}
              onBlur={e => { e.currentTarget.style.border = '1px solid var(--border)'; }}
            />
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={disabled}
            style={{
              width: '100%',
              height: 42,
              background: disabled ? '#1a1a2e' : '#4080ff',
              border: `1px solid ${disabled ? '#2a2a45' : '#4080ff'}`,
              color: disabled ? 'var(--txt-3)' : 'white',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = '#5590ff'; }}
            onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = '#4080ff'; }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          {/* Error */}
          {error && (
            <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>
              {error}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
