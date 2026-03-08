import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { browse } from '../api/browse';
import type { BrowseEntry } from '../api/browse';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  type?: 'file' | 'folder';
}

const FolderIcon = ({ dim = false }: { dim?: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 14" fill="none" style={{ flexShrink: 0 }}>
    <path
      d="M0 2a2 2 0 0 1 2-2h3.172a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 8.828 2H14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2Z"
      fill={dim ? '#374151' : '#2563eb'}
      opacity={dim ? 0.6 : 0.8}
    />
  </svg>
);

const VideoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
    <rect x="0.5" y="0.5" width="13" height="13" rx="1.5" fill="#1e2533" stroke="#374151" />
    <rect x="1" y="2" width="2" height="1.5" rx="0.3" fill="#4b5563" />
    <rect x="4" y="2" width="2" height="1.5" rx="0.3" fill="#4b5563" />
    <rect x="7" y="2" width="2" height="1.5" rx="0.3" fill="#4b5563" />
    <rect x="10" y="2" width="2" height="1.5" rx="0.3" fill="#4b5563" />
    <rect x="1" y="10.5" width="2" height="1.5" rx="0.3" fill="#4b5563" />
    <rect x="4" y="10.5" width="2" height="1.5" rx="0.3" fill="#4b5563" />
    <rect x="7" y="10.5" width="2" height="1.5" rx="0.3" fill="#4b5563" />
    <rect x="10" y="10.5" width="2" height="1.5" rx="0.3" fill="#4b5563" />
    <path d="M5 5l4 2-4 2V5Z" fill="#6b7280" />
  </svg>
);

export default function FilePicker({ open, onClose, onSelect, initialPath, type = 'file' }: Props) {
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
    if (entry.is_dir) load(entry.path);
    else setSelected(entry.path);
  };

  const dirs = entries.filter(e => e.is_dir);
  const files = entries.filter(e => !e.is_dir);
  const canGoUp = parent !== null || path !== '';

  return (
    <Dialog.Root open={open} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.8)' }} />
        <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="flex flex-col w-full max-w-xl rounded"
            style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', maxHeight: '78vh' }}
          >
            {/* Title bar */}
            <div
              className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <Dialog.Title className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                {type === 'folder' ? 'Select Folder' : 'Select Source File'}
              </Dialog.Title>
              <button
                onClick={onClose}
                className="text-sm w-5 h-5 flex items-center justify-center rounded transition-colors hover:bg-white/[0.06]"
                style={{ color: 'var(--text-muted)' }}
              >
                ✕
              </button>
            </div>

            {/* Path bar */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0 font-mono"
              style={{ borderBottom: '1px solid var(--border-sub)', background: 'var(--bg-base)', fontSize: '11px' }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 5h8M5 1l4 4-4 4" stroke="#52525b" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="truncate flex-1" style={{ color: path ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                {path || 'Computer'}
              </span>
            </div>

            {/* File list */}
            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center h-32 text-xs" style={{ color: 'var(--text-muted)' }}>
                  Loading…
                </div>
              )}
              {error && (
                <div className="flex items-center justify-center h-32 text-xs" style={{ color: '#ef4444' }}>
                  {error}
                </div>
              )}
              {!loading && !error && (
                <ul>
                  {/* Parent (..) entry */}
                  {canGoUp && (
                    <li style={{ borderBottom: '1px solid var(--border-sub)' }}>
                      <button
                        onClick={() => load(parent ?? '')}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-white/[0.04]"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <FolderIcon dim />
                        <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>..</span>
                      </button>
                    </li>
                  )}

                  {/* Directories */}
                  {dirs.map(e => (
                    <li key={e.path} style={{ borderBottom: '1px solid var(--border-sub)' }}>
                      <button
                        onClick={() => handleEntry(e)}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-white/[0.04]"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        <FolderIcon />
                        <span className="truncate">{e.name}</span>
                      </button>
                    </li>
                  ))}

                  {/* Files — hidden in folder mode */}
                  {type === 'file' && files.map(e => (
                    <li key={e.path} style={{ borderBottom: '1px solid var(--border-sub)' }}>
                      <button
                        onClick={() => handleEntry(e)}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors"
                        style={{
                          color: selected === e.path ? '#93c5fd' : 'var(--text-primary)',
                          background: selected === e.path ? '#1a254080' : 'transparent',
                        }}
                      >
                        <VideoIcon />
                        <span className="truncate flex-1 text-left font-mono" style={{ fontSize: '12px' }}>{e.name}</span>
                        {selected === e.path && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    </li>
                  ))}

                  {!loading && dirs.length === 0 && files.length === 0 && !canGoUp && (
                    <li className="flex items-center justify-center h-24 text-xs" style={{ color: 'var(--text-muted)' }}>
                      Empty
                    </li>
                  )}
                </ul>
              )}
            </div>

            {/* Footer */}
            <div
              className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0"
              style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-base)' }}
            >
              <span className="flex-1 text-xs font-mono truncate" style={{ color: 'var(--text-secondary)' }}>
                {type === 'folder' ? (path || 'No folder selected') : (selected || 'No file selected')}
              </span>
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-xs rounded transition-colors"
                style={{ color: 'var(--text-secondary)', background: 'var(--bg-panel)', border: '1px solid var(--border)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const val = type === 'folder' ? path : selected;
                  if (val) { onSelect(val); onClose(); }
                }}
                disabled={type === 'folder' ? !path : !selected}
                className="px-4 py-1.5 text-xs font-semibold rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ color: 'white', background: '#2563eb' }}
              >
                {type === 'folder' ? 'Select this folder' : 'Select'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
