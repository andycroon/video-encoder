const BASE = '/api';

export async function checkAuthStatus(): Promise<{ setup_required: boolean }> {
  const res = await fetch(`${BASE}/auth/status`);
  if (!res.ok) throw new Error(`checkAuthStatus failed: ${res.status}`);
  return res.json();
}


export async function login(username: string, password: string): Promise<{ access_token: string }> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.status === 401) {
    const data = await res.json();
    throw new Error(data.detail || 'Invalid username or password.');
  }
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return res.json();
}

export async function register(username: string, password: string): Promise<{ access_token: string }> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.detail || `register failed: ${res.status}`);
  }
  return res.json();
}
