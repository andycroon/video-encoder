const BASE = '/api';

export interface Settings {
  vmaf_min: number;
  vmaf_max: number;
  crf_min: number;
  crf_max: number;
  crf_start: number;
  audio_codec: string;
  output_path: string;
  temp_path: string;
  watch_folder_path: string;
}

export async function getSettings(): Promise<Settings> {
  const res = await fetch(`${BASE}/settings`);
  if (!res.ok) throw new Error(`getSettings failed: ${res.status}`);
  return res.json();
}

export async function saveSettings(data: Partial<Settings>): Promise<Settings> {
  const res = await fetch(`${BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`saveSettings failed: ${res.status}`);
  return res.json();
}
