import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { listProfiles, createProfile, updateProfile, deleteProfile } from '../api/profiles';
import type { Profile } from '../api/profiles';

interface Props {
  open: boolean;
  onClose: () => void;
}

const EMPTY_CONFIG = {
  vmaf_min: 96.2, vmaf_max: 97.6,
  crf_min: 16, crf_max: 20, crf_start: 17,
  audio_codec: 'eac3',
  x264_params: {},
};

export default function ProfileModal({ open, onClose }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => listProfiles().then(setProfiles).catch(() => {});

  useEffect(() => { if (open) { load(); setEditing(null); setIsNew(false); } }, [open]);

  const startNew = () => {
    setEditing({ id: 0, name: '', is_default: false, config: EMPTY_CONFIG });
    setIsNew(true);
    setError('');
  };

  const startEdit = (p: Profile) => { setEditing({ ...p }); setIsNew(false); setError(''); };

  const updateField = (key: string, value: string | number | boolean) => {
    setEditing(e => e ? { ...e, [key]: value } : e);
  };

  const updateConfig = (key: string, value: string | number) => {
    setEditing(e => e ? { ...e, config: { ...e.config, [key]: value } } : e);
  };

  const handleSave = async () => {
    if (!editing || !editing.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      if (isNew) {
        await createProfile({ name: editing.name, config: editing.config, is_default: editing.is_default });
      } else {
        await updateProfile(editing.id, { name: editing.name, config: editing.config });
      }
      await load();
      setEditing(null);
      setIsNew(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: Profile) => {
    if (!confirm(`Delete profile "${p.name}"?`)) return;
    try {
      await deleteProfile(p.id);
      await load();
      if (editing?.id === p.id) setEditing(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const numInput = (label: string, key: string, step = 1) => (
    <div>
      <label className="block text-xs text-neutral-400 mb-1">{label}</label>
      <input
        type="number" step={step}
        className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500/60 transition-colors"
        value={(editing?.config as unknown as Record<string, number>)?.[key] ?? ''}
        onChange={e => updateConfig(key, step === 1 ? parseInt(e.target.value) : parseFloat(e.target.value))}
      />
    </div>
  );

  return (
    <Dialog.Root open={open} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-40" />
        <Dialog.Content className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-lg w-full max-w-2xl flex overflow-hidden" style={{ maxHeight: '90vh' }}>
            {/* Profile list */}
            <div className="w-52 border-r border-neutral-800 flex flex-col flex-shrink-0">
              <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
                <Dialog.Title className="text-neutral-100 font-semibold text-sm">Profiles</Dialog.Title>
                <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200 text-lg leading-none">×</button>
              </div>
              <div className="flex-1 overflow-y-auto py-1">
                {profiles.map(p => (
                  <button
                    key={p.id}
                    onClick={() => startEdit(p)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${
                      editing?.id === p.id && !isNew
                        ? 'bg-blue-600/20 text-blue-300'
                        : 'text-neutral-300 hover:bg-neutral-800'
                    }`}
                  >
                    <span className="flex-1 truncate">{p.name}</span>
                    {p.is_default && <span className="text-xs text-neutral-500">default</span>}
                  </button>
                ))}
              </div>
              <div className="p-3 border-t border-neutral-800">
                <button
                  onClick={startNew}
                  className="w-full px-3 py-2 text-sm text-neutral-300 border border-neutral-700 rounded hover:border-neutral-500 hover:text-white transition-colors"
                >
                  + New profile
                </button>
              </div>
            </div>

            {/* Editor */}
            <div className="flex-1 flex flex-col overflow-y-auto">
              {!editing ? (
                <div className="flex items-center justify-center flex-1 text-neutral-500 text-sm">
                  Select a profile or create a new one
                </div>
              ) : (
                <>
                  <div className="px-5 py-4 space-y-4 flex-1">
                    <div>
                      <label className="block text-xs text-neutral-400 mb-1">Name</label>
                      <input
                        className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500/60 transition-colors"
                        value={editing.name}
                        onChange={e => updateField('name', e.target.value)}
                        placeholder="Profile name"
                      />
                    </div>

                    <div>
                      <h3 className="text-xs uppercase tracking-widest text-neutral-500 mb-3 font-medium">VMAF targets</h3>
                      <div className="grid grid-cols-2 gap-3">
                        {numInput('Min', 'vmaf_min', 0.1)}
                        {numInput('Max', 'vmaf_max', 0.1)}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs uppercase tracking-widest text-neutral-500 mb-3 font-medium">CRF range</h3>
                      <div className="grid grid-cols-3 gap-3">
                        {numInput('Start', 'crf_start')}
                        {numInput('Min', 'crf_min')}
                        {numInput('Max', 'crf_max')}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-neutral-400 mb-1">Audio codec</label>
                      <select
                        className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500/60 transition-colors"
                        value={(editing.config as unknown as Record<string, string>).audio_codec ?? 'eac3'}
                        onChange={e => updateConfig('audio_codec', e.target.value)}
                      >
                        <option value="eac3">EAC3</option>
                        <option value="aac">AAC</option>
                        <option value="ac3">AC3</option>
                        <option value="copy">Copy</option>
                      </select>
                    </div>

                    {error && <p className="text-red-400 text-xs">{error}</p>}
                  </div>

                  <div className="px-5 py-4 border-t border-neutral-800 flex items-center gap-3">
                    {!editing.is_default && !isNew && (
                      <button
                        onClick={() => handleDelete(editing)}
                        className="px-4 py-2 text-sm text-red-400 hover:text-red-300 border border-red-900/50 rounded hover:border-red-700 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                    <div className="flex-1" />
                    <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors">
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 transition-colors"
                    >
                      {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
