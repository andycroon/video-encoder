import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { listProfiles, createProfile, updateProfile, deleteProfile } from '../api/profiles';
import type { Profile } from '../types';
import { useJobsStore } from '../store/jobsStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

const AUDIO_OPTIONS = ['eac3', 'aac', 'flac', 'copy'];

const DEFAULT_CONFIG: Profile['config'] = {
  vmaf_min: 96.2, vmaf_max: 97.6,
  crf_min: 16, crf_max: 20, crf_start: 17,
  audio_codec: 'eac3',
  subtitle_mode: 'none' as 'none' | 'extract',
  tesseract_lang: 'eng',
  x264_params: {
    partitions: 'i4x4+p8x8+b8x8', trellis: '2', deblock: '-3:-3',
    b_qfactor: '1', i_qfactor: '0.71', qcomp: '0.50',
    maxrate: '12000K', bufsize: '24000k', qmax: '40', subq: '10',
    me_method: 'umh', me_range: '24', b_strategy: '2', bf: '2',
    sc_threshold: '0', g: '48', keyint_min: '48', flags: '-loop',
  },
};

type FormState = {
  id: number | null;
  name: string;
  is_default: boolean;
  config: Profile['config'];
};

function emptyForm(): FormState {
  return {
    id: null,
    name: 'New Profile',
    is_default: false,
    config: { ...DEFAULT_CONFIG, x264_params: { ...DEFAULT_CONFIG.x264_params } },
  };
}

function profileToForm(p: Profile): FormState {
  return {
    id: p.id,
    name: p.name,
    is_default: p.is_default,
    config: { ...p.config, x264_params: { ...p.config.x264_params } },
  };
}

export default function ProfileModal({ open, onClose }: Props) {
  const [profiles, setProfilesLocal] = useState<Profile[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const setProfiles = useJobsStore(s => s.setProfiles);

  const reload = async () => {
    const ps = await listProfiles();
    setProfilesLocal(ps);
    setProfiles(ps);
  };

  useEffect(() => { if (open) { reload(); setForm(emptyForm()); } }, [open]);

  const setConfig = (key: keyof Profile['config'], value: unknown) => {
    setForm(f => ({ ...f, config: { ...f.config, [key]: value } }));
  };

  const setX264Param = (k: string, v: string) => {
    setForm(f => ({
      ...f,
      config: { ...f.config, x264_params: { ...f.config.x264_params, [k]: v } },
    }));
  };

  const renameX264Param = (oldKey: string, newKey: string) => {
    setForm(f => {
      const params = Object.fromEntries(
        Object.entries(f.config.x264_params).map(([k, v]) => [k === oldKey ? newKey : k, v])
      );
      return { ...f, config: { ...f.config, x264_params: params } };
    });
  };

  const removeX264Param = (k: string) => {
    setForm(f => {
      const params = { ...f.config.x264_params };
      delete params[k];
      return { ...f, config: { ...f.config, x264_params: params } };
    });
  };

  const addX264Param = () => {
    setX264Param('new_param', '');
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = { name: form.name, is_default: form.is_default, config: form.config };
      if (form.id === null) {
        await createProfile(payload);
      } else {
        await updateProfile(form.id, payload);
      }
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: Profile) => {
    if (p.is_default) return;
    try {
      await deleteProfile(p.id);
      await reload();
      if (form.id === p.id) setForm(emptyForm());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-[760px] max-h-[80vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
            <Dialog.Title className="text-neutral-100 font-semibold">Encoder Profiles</Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-neutral-500 hover:text-neutral-300 text-lg leading-none">×</button>
            </Dialog.Close>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Profile list */}
            <div className="w-48 border-r border-neutral-800 flex flex-col flex-shrink-0">
              <div className="flex-1 overflow-y-auto py-2">
                {profiles.map(p => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between px-3 py-2 cursor-pointer text-sm ${
                      form.id === p.id
                        ? 'bg-blue-900/30 text-blue-300'
                        : 'text-neutral-300 hover:bg-neutral-800'
                    }`}
                    onClick={() => { setForm(profileToForm(p)); setError(''); }}
                  >
                    <span className="truncate flex-1">{p.name}</span>
                    {p.is_default && <span className="text-xs text-neutral-600 ml-1">default</span>}
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(p); }}
                      disabled={p.is_default}
                      className="ml-2 text-neutral-600 hover:text-red-400 disabled:opacity-20 disabled:cursor-not-allowed"
                      title={p.is_default ? 'Cannot delete the default profile' : 'Delete profile'}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-neutral-800">
                <button
                  onClick={() => { setForm(emptyForm()); setError(''); }}
                  className="w-full py-1.5 text-xs rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 transition-colors"
                >
                  + New Profile
                </button>
              </div>
            </div>

            {/* Editor form */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Name</label>
                <input
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500/60 transition-colors"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Profile name"
                />
              </div>

              <div>
                <h3 className="text-xs uppercase tracking-widest text-neutral-500 mb-3 font-medium">VMAF targets</h3>
                <div className="grid grid-cols-2 gap-3">
                  {(['vmaf_min', 'vmaf_max'] as const).map(k => (
                    <div key={k}>
                      <label className="text-xs text-neutral-500 block mb-1">
                        {k === 'vmaf_min' ? 'Min' : 'Max'}
                      </label>
                      <input
                        type="number" step="0.1"
                        className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500/60 transition-colors"
                        value={form.config[k]}
                        onChange={e => setConfig(k, parseFloat(e.target.value))}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-xs uppercase tracking-widest text-neutral-500 mb-3 font-medium">CRF range</h3>
                <div className="grid grid-cols-3 gap-3">
                  {(['crf_start', 'crf_min', 'crf_max'] as const).map(k => (
                    <div key={k}>
                      <label className="text-xs text-neutral-500 block mb-1">
                        {k === 'crf_start' ? 'Start' : k === 'crf_min' ? 'Min' : 'Max'}
                      </label>
                      <input
                        type="number" step="1"
                        className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500/60 transition-colors"
                        value={form.config[k]}
                        onChange={e => setConfig(k, parseInt(e.target.value))}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-neutral-500 block mb-1">Audio codec</label>
                <select
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500/60 transition-colors"
                  value={form.config.audio_codec}
                  onChange={e => setConfig('audio_codec', e.target.value)}
                >
                  {AUDIO_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              <div>
                <h3 className="text-xs uppercase tracking-widest text-neutral-500 mb-3 font-medium">Subtitles</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1">Mode</label>
                    <select
                      className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500/60 transition-colors"
                      value={form.config.subtitle_mode}
                      onChange={e => setConfig('subtitle_mode', e.target.value as 'none' | 'extract')}
                    >
                      <option value="none">None (strip subtitles)</option>
                      <option value="extract">Extract &amp; convert to SRT</option>
                    </select>
                  </div>
                  {form.config.subtitle_mode === 'extract' && (
                    <p className="text-xs text-neutral-500">All subtitle streams are extracted. Each stream is OCR'd using its own language tag automatically.</p>
                  )}
                </div>
              </div>

              {/* x264 params — key-value pair editor */}
              <div>
                <h3 className="text-xs uppercase tracking-widest text-neutral-500 mb-2 font-medium">x264 params</h3>
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                  {Object.entries(form.config.x264_params).map(([k, v]) => (
                    <div key={k} className="flex gap-2 items-center">
                      <input
                        className="w-36 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs font-mono text-neutral-300 focus:outline-none focus:border-blue-500/60 transition-colors"
                        value={k}
                        onChange={e => renameX264Param(k, e.target.value)}
                      />
                      <input
                        className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs font-mono text-neutral-300 focus:outline-none focus:border-blue-500/60 transition-colors"
                        value={v}
                        onChange={e => setX264Param(k, e.target.value)}
                      />
                      <button
                        onClick={() => removeX264Param(k)}
                        className="text-neutral-600 hover:text-red-400 text-sm transition-colors flex-shrink-0"
                        title="Remove param"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addX264Param}
                  className="mt-2 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  + Add param
                </button>
              </div>

              {error && <p className="text-red-400 text-xs">{error}</p>}

              <div className="flex justify-end pt-2 border-t border-neutral-800">
                <button
                  onClick={handleSave}
                  disabled={saving || !form.name.trim()}
                  className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 transition-colors"
                >
                  {saving ? 'Saving…' : form.id === null ? 'Create' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
