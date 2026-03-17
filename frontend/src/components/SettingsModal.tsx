import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { getSettings, saveSettings } from '../api/settings';
import type { Settings } from '../api/settings';
import FilePicker from './FilePicker';

interface Props {
  open: boolean;
  onClose: () => void;
}

type FolderField = 'output_path' | 'temp_path' | 'watch_folder_path';

export default function SettingsModal({ open, onClose }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pickerField, setPickerField] = useState<FolderField | null>(null);
  const [cpuCount, setCpuCount] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      getSettings().then(setSettings).catch(() => {});
      fetch('/api/system').then(r => r.json()).then(d => setCpuCount(d.cpu_count)).catch(() => {});
    }
  }, [open]);

  const update = (key: keyof Settings, value: string | number) => {
    setSettings(s => s ? { ...s, [key]: value } : s);
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const pathField = (label: string, field: FolderField) => (
    <div>
      <label className="block text-xs text-neutral-400 mb-1">{label}</label>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 font-mono focus:outline-none focus:border-blue-500/60 transition-colors"
          value={settings?.[field] ?? ''}
          onChange={e => update(field, e.target.value)}
          placeholder="Not set"
        />
        <button
          onClick={() => setPickerField(field)}
          className="px-3 py-2 text-sm text-neutral-300 border border-neutral-700 rounded hover:border-neutral-500 hover:text-white transition-colors"
        >
          Browse
        </button>
      </div>
    </div>
  );

  const numField = (label: string, field: keyof Settings, step = 1) => (
    <div>
      <label className="block text-xs text-neutral-400 mb-1">{label}</label>
      <input
        type="number"
        step={step}
        className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500/60 transition-colors"
        value={settings?.[field] ?? ''}
        onChange={e => update(field, step === 1 ? parseInt(e.target.value) : parseFloat(e.target.value))}
      />
    </div>
  );

  return (
    <>
      <Dialog.Root open={open} onOpenChange={o => !o && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/70 z-40" />
          <Dialog.Content className="fixed inset-0 z-40 flex items-center justify-center p-4">
            <div className="bg-neutral-900 border border-neutral-700 rounded-lg w-full max-w-lg overflow-y-auto" style={{ maxHeight: '90vh' }}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
                <Dialog.Title className="text-neutral-100 font-semibold">Settings</Dialog.Title>
                <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200 text-lg leading-none">×</button>
              </div>

              {!settings ? (
                <div className="flex items-center justify-center h-32 text-neutral-500 text-sm">Loading…</div>
              ) : (
                <div className="px-5 py-4 space-y-5">
                  <div>
                    <h3 className="text-xs uppercase tracking-widest text-neutral-500 mb-3 font-medium">Paths</h3>
                    <div className="space-y-3">
                      {pathField('Output folder', 'output_path')}
                      {pathField('Temp folder', 'temp_path')}
                      {pathField('Watch folder', 'watch_folder_path')}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs uppercase tracking-widest text-neutral-500 mb-3 font-medium">Default encoding</h3>
                    <div className="grid grid-cols-3 gap-3">
                      {numField('CRF start', 'crf_start')}
                      {numField('CRF min', 'crf_min')}
                      {numField('CRF max', 'crf_max')}
                      {numField('VMAF min', 'vmaf_min', 0.1)}
                      {numField('VMAF max', 'vmaf_max', 0.1)}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs uppercase tracking-widest text-neutral-500 mb-3 font-medium">Performance</h3>
                    <div>
                      <label className="block text-xs text-neutral-400 mb-1">Max parallel encoders</label>
                      <input
                        type="number"
                        min={1}
                        max={cpuCount ?? undefined}
                        step={1}
                        className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500/60 transition-colors"
                        value={settings?.max_parallel_chunks ?? 1}
                        onChange={e => update('max_parallel_chunks', parseInt(e.target.value) || 1)}
                      />
                      {cpuCount && (
                        <p className="text-xs text-neutral-500 mt-1">{cpuCount} CPU cores available</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="px-5 py-4 border-t border-neutral-800 flex justify-end gap-3">
                <button onClick={onClose} className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !settings}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 transition-colors min-w-16"
                >
                  {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <FilePicker
        open={pickerField !== null}
        onClose={() => setPickerField(null)}
        onSelect={p => { if (pickerField) update(pickerField, p); }}
        type="folder"
      />
    </>
  );
}
