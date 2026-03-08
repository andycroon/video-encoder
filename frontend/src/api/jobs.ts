import { Job } from '../types';

const BASE = '/api';

export async function listJobs(status?: string): Promise<Job[]> {
  const url = status ? `${BASE}/jobs?status=${status}` : `${BASE}/jobs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`listJobs failed: ${res.status}`);
  return res.json();
}

export async function getJob(id: number): Promise<Job> {
  const res = await fetch(`${BASE}/jobs/${id}`);
  if (!res.ok) throw new Error(`getJob failed: ${res.status}`);
  return res.json();
}

export async function submitJob(sourcePath: string, config: Record<string, unknown>): Promise<Job> {
  const res = await fetch(`${BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_path: sourcePath, config }),
  });
  if (!res.ok) throw new Error(`submitJob failed: ${res.status}`);
  return res.json();
}

export async function pauseJob(id: number): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${id}/pause`, { method: 'PATCH' });
  if (!res.ok) throw new Error(`pauseJob failed: ${res.status}`);
}

export async function cancelJob(id: number): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`cancelJob failed: ${res.status}`);
}

export async function retryJob(id: number): Promise<Job> {
  const res = await fetch(`${BASE}/jobs/${id}/retry`, { method: 'POST' });
  if (!res.ok) throw new Error(`retryJob failed: ${res.status}`);
  return res.json();
}
