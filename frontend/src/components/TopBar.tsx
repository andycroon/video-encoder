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
      <div className="rounded" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
        {/* Source file row */}
        <div className="flex items-center gap-0" style={{ borderBottom: '1px solid var(--border-sub)' }}>
          <span className="px-3 text-xs font-mono tracking-widest uppercase flex-shrink-0" style={{ color: 'var(--text-muted)' }}>SRC</span>
          <button
            onClick={() => setPickerOpen(true)}
            className="flex-1 px-2 py-2.5 text-sm text-left font-mono truncate transition-colors hover:bg-white/[0.02] focus:outline-none"
            style={{ color: path ? 'var(--text-primary)' : 'var(--text-muted)', borderLeft: '1px solid var(--border-sub)' }}
          >
            {path || 'Click to browse for source file…'}
          </button>
          {path && (
            <button
              onClick={() => setPath('')}
              className="px-3 py-2.5 text-sm transition-colors hover:bg-white/[0.03]"
              style={{ color: 'var(--text-muted)', borderLeft: '1px solid var(--border-sub)' }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Controls row */}
        <div className="flex items-stretch">
          {/* Profile picker */}
          <Select.Root value={selectedId} onValueChange={setSelectedId}>
            <Select.Trigger
              className="flex items-center gap-2 px-3 py-2 text-sm focus:outline-none transition-colors hover:bg-white/[0.02] min-w-44"
              style={{ color: 'var(--text-secondary)', borderRight: '1px solid var(--border-sub)' }}
            >
              <span className="text-xs uppercase tracking-widest font-medium flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Profile</span>
              <Select.Value placeholder="—" />
              <Select.Icon className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>▾</Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content
                className="rounded shadow-2xl z-50 overflow-hidden"
                style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
              >
                <Select.Viewport>
                  {profiles.map(p => (
                    <Select.Item
                      key={p.id}
                      value={String(p.id)}
                      className="px-3 py-2 text-sm cursor-pointer focus:outline-none"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <Select.ItemText>{p.name}{p.is_default ? ' ·  default' : ''}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>

          <div className="flex-1" />

          {/* Utility buttons */}
          {onEditProfiles && (
            <button
              onClick={onEditProfiles}
              className="px-4 py-2 text-xs uppercase tracking-wider font-medium transition-colors hover:bg-white/[0.03]"
              style={{ color: 'var(--text-muted)', borderLeft: '1px solid var(--border-sub)' }}
            >
              Profiles
            </button>
          )}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="px-4 py-2 text-xs uppercase tracking-wider font-medium transition-colors hover:bg-white/[0.03]"
              style={{ color: 'var(--text-muted)', borderLeft: '1px solid var(--border-sub)' }}
            >
              Settings
            </button>
          )}

          {/* Add button */}
          <button
            onClick={handleAdd}
            disabled={!path.trim() || !selectedProfile || loading}
            className="px-5 py-2 text-sm font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              color: 'white',
              background: !path.trim() || !selectedProfile || loading ? undefined : '#2563eb',
              borderLeft: '1px solid var(--border-sub)',
            }}
          >
            {loading ? 'Adding…' : 'Add Job'}
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
