import { useState, useEffect } from 'react';
import * as Select from '@radix-ui/react-select';
import { listProfiles } from '../api/profiles';
import { submitJob } from '../api/jobs';
import type { Profile } from '../types';
import { useJobsStore } from '../store/jobsStore';
import FilePicker from './FilePicker';

interface Props {
  onEditProfiles?: () => void;
  onOpenSettings?: () => void;
}

export default function TopBar({ onEditProfiles, onOpenSettings }: Props) {
  const [path, setPath] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const upsertJob = useJobsStore(s => s.upsertJob);

  useEffect(() => {
    listProfiles().then(p => {
      setProfiles(p);
      const def = p.find(x => x.is_default) ?? p[0];
      if (def) setSelectedId(String(def.id));
    }).catch(() => {});
  }, []);

  const selectedProfile = profiles.find(p => String(p.id) === selectedId);

  const handleAdd = async () => {
    if (!path.trim() || !selectedProfile) return;
    setLoading(true);
    try {
      const job = await submitJob(path.trim(), selectedProfile.config as Record<string, unknown>);
      upsertJob(job as any);
      setPath('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
        {/* File row */}
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setPickerOpen(true)}
            className="flex-1 bg-neutral-800 border border-neutral-700/80 rounded px-3 py-2 text-sm text-left font-mono transition-colors hover:border-neutral-600 focus:outline-none focus:border-blue-500/60 truncate"
          >
            {path ? (
              <span className="text-neutral-200">{path}</span>
            ) : (
              <span className="text-neutral-500">Browse for source file…</span>
            )}
          </button>
          {path && (
            <button
              onClick={() => setPath('')}
              className="text-neutral-500 hover:text-neutral-300 px-2 py-2 text-sm transition-colors"
              title="Clear"
            >
              ×
            </button>
          )}
        </div>

        {/* Controls row */}
        <div className="flex gap-2 items-center">
          <Select.Root value={selectedId} onValueChange={setSelectedId}>
            <Select.Trigger className="flex items-center gap-2 bg-neutral-800 border border-neutral-700/80 rounded px-3 py-2 text-sm text-neutral-200 min-w-36 focus:outline-none focus:border-blue-500/60 transition-colors">
              <Select.Value placeholder="Select profile" />
              <Select.Icon className="text-neutral-400 ml-auto">▾</Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50 overflow-hidden">
                <Select.Viewport>
                  {profiles.map(p => (
                    <Select.Item
                      key={p.id}
                      value={String(p.id)}
                      className="px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800 cursor-pointer focus:outline-none focus:bg-neutral-800"
                    >
                      <Select.ItemText>{p.name}{p.is_default ? ' (default)' : ''}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>

          {onEditProfiles && (
            <button
              onClick={onEditProfiles}
              className="px-3 py-2 text-sm text-neutral-300 hover:text-white border border-neutral-700/80 rounded hover:border-neutral-500 transition-colors"
            >
              Profiles
            </button>
          )}

          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="px-3 py-2 text-sm text-neutral-300 hover:text-white border border-neutral-700/80 rounded hover:border-neutral-500 transition-colors"
            >
              Settings
            </button>
          )}

          <button
            onClick={handleAdd}
            disabled={!path.trim() || !selectedProfile || loading}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ml-auto"
          >
            {loading ? 'Adding…' : 'Add job'}
          </button>
        </div>
      </div>

      <FilePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={p => setPath(p)}
      />
    </>
  );
}
