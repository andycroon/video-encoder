import useAuthStore from '../store/authStore';

/**
 * Wrapper around fetch that injects the Authorization header
 * and handles 401 responses by clearing the token.
 */
export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = useAuthStore.getState().token;
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    useAuthStore.getState().clearToken();
    throw new Error('Session expired');
  }
  return res;
}
