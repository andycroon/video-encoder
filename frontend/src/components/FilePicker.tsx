import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { browse } from '../api/browse';
import type { BrowseEntry } from '../api/browse';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

export default function FilePicker({ open, onClose, onSelect, initialPath }: Props) {
  const [path, setPath] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');

  const load = async (p: string = '') => {
    setLoading(true);
    setError('');
    setSelected('');
    try {
      const result = await browse(p);
      setPath(result.path);
      setParent(result.parent);
      setEntries(result.entries);
    } catch {
      setError('Could not read directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load(initialPath ?? '');
  }, [open]);

  const handleEntry = (entry: BrowseEntry) => {
    if (entry.is_dir) {
      load(entry.path);
    } else {
      setSelected(entry.path);
    }
  };

  const dirs = entries.filter(e => e.is_dir);
  const files = entries.filter(e => !e.is_dir);

  return (
    <Dialog.Root open={open} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-50" />
        <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-lg w-full max-w-lg flex flex-col" style={{ maxHeight: '80vh' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
              <Dialog.Title className="text-neutral-100 font-semibold text-sm">Browse for file</Dialog.Title>
              <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200 text-lg leading-none">×</button>
            </div>

            {/* Path bar */}
            <div className="px-4 py-2 border-b border-neutral-800 flex items-center gap-2">
              <span className="text-neutral-400 text-xs font-mono truncate flex-1">{path || 'Select a drive'}</span>
            </div>

            {/* File list */}
            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center h-32 text-neutral-500 text-sm">Loading…</div>
              )}
              {error && (
                <div className="flex items-center justify-center h-32 text-red-400 text-sm">{error}</div>
              )}
              {!loading && !error && entries.length === 0 && (
                <div className="flex items-center justify-center h-32 text-neutral-500 text-sm">Empty directory</div>
              )}
              {!loading && !error && (
                <ul className="py-1">
                  {(parent !== null || path !== '') && (
                    <li>
                      <button
                        onClick={() => load(parent ?? '')}
                        className="w-full text-left px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800 flex items-center gap-2 transition-colors"
                      >
                        <span className="text-blue-400 text-xs">📁</span>
                        ..
                      </button>
                    </li>
                  )}
                  {dirs.map(e => (
                    <li key={e.path}>
                      <button
                        onClick={() => handleEntry(e)}
                        className="w-full text-left px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800 flex items-center gap-2 transition-colors"
                      >
                        <span className="text-blue-400 text-xs">📁</span>
                        {e.name}
                      </button>
                    </li>
                  ))}
                  {files.map(e => (
                    <li key={e.path}>
                      <button
                        onClick={() => handleEntry(e)}
                        className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition-colors ${
                          selected === e.path
                            ? 'bg-blue-600/20 text-blue-300'
                            : 'text-neutral-200 hover:bg-neutral-800'
                        }`}
                      >
                        <span className="text-neutral-500 text-xs">🎬</span>
                        {e.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-neutral-800 flex items-center gap-3">
              <span className="text-neutral-500 text-xs font-mono truncate flex-1">
                {selected || 'No file selected'}
              </span>
              <button onClick={onClose} className="px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => { if (selected) { onSelect(selected); onClose(); } }}
                disabled={!selected}
                className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Select
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
