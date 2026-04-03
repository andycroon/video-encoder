import { authFetch } from './authFetch';

const BASE = '/api';

export interface BrowseEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;        // bytes, null for directories
  modified_at: string | null; // ISO 8601 string, null for directories
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
}

export async function browse(path: string = ''): Promise<BrowseResult> {
  const url = path ? `${BASE}/browse?path=${encodeURIComponent(path)}` : `${BASE}/browse`;
  const res = await authFetch(url);
  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json();
}
