import type { Profile } from '../types';
export type { Profile };
import { authFetch } from './authFetch';

const BASE = '/api';

export async function listProfiles(): Promise<Profile[]> {
  const res = await authFetch(`${BASE}/profiles`);
  if (!res.ok) throw new Error(`listProfiles failed: ${res.status}`);
  return res.json();
}

export async function createProfile(data: Omit<Profile, 'id'>): Promise<Profile> {
  const res = await authFetch(`${BASE}/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`createProfile failed: ${res.status}`);
  return res.json();
}

export async function updateProfile(id: number, data: Partial<Profile>): Promise<Profile> {
  const res = await authFetch(`${BASE}/profiles/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`updateProfile failed: ${res.status}`);
  return res.json();
}

export async function deleteProfile(id: number): Promise<void> {
  const res = await authFetch(`${BASE}/profiles/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteProfile failed: ${res.status}`);
}
