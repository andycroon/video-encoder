import { useState, useEffect } from 'react';
import * as Select from '@radix-ui/react-select';
import { listProfiles } from '../api/profiles';
import { submitJob } from '../api/jobs';
import { Profile } from '../types';
import { useJobsStore } from '../store/jobsStore';

interface Props {
  onEditProfiles?: () => void;
}

export default function TopBar({ onEditProfiles }: Props) {
  const [path, setPath] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const upsertJob = useJobsStore(s => s.upsertJob);

  useEffect(() => {
    listProfiles().then(p => {
      setProfiles(p);
      const def = p.find(x => x.is_default) ?? p[0];
      if (def) setSelectedId(String(def.id));
    });
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
    <div className="flex gap-3 items-center p-4 border-b border-neutral-800">
      <input
        className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
        placeholder="Source file path…"
        value={path}
        onChange={e => setPath(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
      />
      <Select.Root value={selectedId} onValueChange={setSelectedId}>
        <Select.Trigger className="flex items-center gap-2 bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 min-w-32">
          <Select.Value placeholder="Profile" />
          <Select.Icon>▾</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="bg-neutral-900 border border-neutral-700 rounded shadow-xl z-50">
            <Select.Viewport>
              {profiles.map(p => (
                <Select.Item
                  key={p.id}
                  value={String(p.id)}
                  className="px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800 cursor-pointer"
                >
                  <Select.ItemText>{p.name}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      {onEditProfiles && (
        <button
          onClick={onEditProfiles}
          className="px-3 py-2 text-sm text-neutral-400 hover:text-neutral-100 border border-neutral-700 rounded"
        >
          Edit
        </button>
      )}
      <button
        onClick={handleAdd}
        disabled={!path.trim() || loading}
        className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? 'Adding…' : 'Add'}
      </button>
    </div>
  );
}
