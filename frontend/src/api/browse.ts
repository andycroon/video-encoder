const BASE = '/api';

export interface BrowseEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
}

export async function browse(path: string = ''): Promise<BrowseResult> {
  const url = path ? `${BASE}/browse?path=${encodeURIComponent(path)}` : `${BASE}/browse`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`browse failed: ${res.status}`);
  return res.json();
}
