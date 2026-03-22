import { authFetch } from './authFetch';

const BASE = '/api';

export interface RenameResult {
  path: string;
  name: string;
}

export interface FileOpEntry {
  path: string;
  status: 'ok' | 'not_found' | 'conflict';
  conflict_name?: string;
}

export interface FileOpResult {
  results: FileOpEntry[];
}

export async function renameFile(path: string, newName: string): Promise<RenameResult> {
  const res = await authFetch(`${BASE}/files/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, new_name: newName }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: 'Rename failed' }));
    throw new Error(data.detail || `rename failed: ${res.status}`);
  }
  return res.json();
}

export async function moveFiles(
  paths: string[],
  destination: string,
  overwrite: boolean = false,
): Promise<FileOpResult> {
  const res = await authFetch(`${BASE}/files/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths, destination, overwrite }),
  });
  if (!res.ok) throw new Error(`move failed: ${res.status}`);
  return res.json();
}

export async function createFolder(path: string, name: string): Promise<{ path: string; name: string }> {
  const res = await authFetch(`${BASE}/files/mkdir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: 'Create folder failed' }));
    throw new Error(data.detail || `mkdir failed: ${res.status}`);
  }
  return res.json();
}

export async function copyFiles(
  paths: string[],
  destination: string,
  overwrite: boolean = false,
): Promise<FileOpResult> {
  const res = await authFetch(`${BASE}/files/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths, destination, overwrite }),
  });
  if (!res.ok) throw new Error(`copy failed: ${res.status}`);
  return res.json();
}
