import { useState, useEffect } from 'react';
import * as Select from '@radix-ui/react-select';
import { listProfiles } from '../api/profiles';
import { submitJob } from '../api/jobs';

import { useJobsStore } from '../store/jobsStore';
import FilePicker from './FilePicker';

interface Props {
  onEditProfiles?: () => void;
  onOpenSettings?: () => void;
}

const label: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--txt-3)',
  display: 'block',
  marginBottom: 6,
};

export default function TopBar({ onEditProfiles, onOpenSettings }: Props) {
  const [path, setPath] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const upsertJob = useJobsStore(s => s.upsertJob);
  const storeProfiles = useJobsStore(s => s.profiles);
  const setStoreProfiles = useJobsStore(s => s.setProfiles);

  // Load profiles into store on mount
  useEffect(() => {
    listProfiles().then(p => {
      setStoreProfiles(p);
      const def = p.find(x => x.is_default) ?? p[0];
      if (def) setSelectedId(String(def.id));
    }).catch(() => {});
  }, []);

  // Keep selectedId valid when store profiles change (e.g. after ProfileModal saves)
  useEffect(() => {
    if (storeProfiles.length === 0) return;
    const stillExists = storeProfiles.find(p => String(p.id) === selectedId);
    if (!stillExists) {
      const def = storeProfiles.find(p => p.is_default) ?? storeProfiles[0];
      if (def) setSelectedId(String(def.id));
    }
  }, [storeProfiles]);

  const profiles = storeProfiles;

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

  const canAdd = !!path.trim() && !!selectedProfile && !loading;

  return (
    <>
      <div style={{
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 20,
      }}>

        {/* Source File */}
        <div style={{ marginBottom: 16 }}>
          <span style={label}>Source File</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setPickerOpen(true)}
              style={{
                flex: 1,
                height: 42,
                background: 'var(--raised)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '0 14px',
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#4080ff80')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              <span className="mono" style={{
                fontSize: 13,
                color: path ? 'var(--txt)' : 'var(--txt-3)',
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {path || 'Click to browse for a source file…'}
              </span>
            </button>
            {path && (
              <button
                onClick={() => setPath('')}
                style={{
                  height: 42, width: 42,
                  background: 'var(--raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: 'var(--txt-3)',
                  fontSize: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--txt)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--txt-3)')}
                title="Clear"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Controls row */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>

          {/* Profile */}
          <div style={{ flex: 1 }}>
            <span style={label}>Encoding Profile</span>
            <Select.Root value={selectedId} onValueChange={setSelectedId}>
              <Select.Trigger style={{
                width: '100%', height: 38,
                background: 'var(--raised)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '0 12px',
                display: 'flex', alignItems: 'center', gap: 8,
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--txt-2)',
                outline: 'none',
              }}>
                <Select.Value placeholder="Select profile…" />
                <Select.Icon style={{ marginLeft: 'auto', color: 'var(--txt-3)', fontSize: 11 }}>▾</Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Content style={{
                  background: 'var(--raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  overflow: 'hidden',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  zIndex: 100,
                }}>
                  <Select.Viewport>
                    {profiles.map(p => (
                      <Select.Item
                        key={p.id}
                        value={String(p.id)}
                        style={{
                          padding: '9px 14px',
                          fontSize: 13,
                          color: 'var(--txt-2)',
                          cursor: 'pointer',
                          outline: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#ffffff08')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <Select.ItemText>
                          {p.name}{p.is_default ? <span style={{ color: 'var(--txt-3)', marginLeft: 6, fontSize: 11 }}>default</span> : ''}
                        </Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </div>

          {/* Utility buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            {onEditProfiles && (
              <button
                onClick={onEditProfiles}
                style={{
                  height: 38, padding: '0 16px',
                  background: 'var(--raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontSize: 13, fontWeight: 500,
                  color: 'var(--txt-2)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#4a4a5a'; e.currentTarget.style.color = 'var(--txt)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--txt-2)'; }}
              >
                Profiles
              </button>
            )}
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                style={{
                  height: 38, padding: '0 16px',
                  background: 'var(--raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontSize: 13, fontWeight: 500,
                  color: 'var(--txt-2)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#4a4a5a'; e.currentTarget.style.color = 'var(--txt)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--txt-2)'; }}
              >
                Settings
              </button>
            )}
          </div>

          {/* Add Job */}
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            style={{
              height: 38, padding: '0 22px',
              background: canAdd ? '#4080ff' : '#1a1a2e',
              border: `1px solid ${canAdd ? '#4080ff' : '#2a2a45'}`,
              borderRadius: 6,
              fontSize: 13, fontWeight: 600,
              color: canAdd ? 'white' : 'var(--txt-3)',
              cursor: canAdd ? 'pointer' : 'not-allowed',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => { if (canAdd) e.currentTarget.style.background = '#5590ff'; }}
            onMouseLeave={e => { if (canAdd) e.currentTarget.style.background = '#4080ff'; }}
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
