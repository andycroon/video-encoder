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

const FolderSvg = ({ open: o = false }: { open?: boolean }) => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none" style={{ flexShrink: 0 }}>
    {o ? (
      <path d="M0 3a2 2 0 0 1 2-2h3.17a2 2 0 0 1 1.41.59L7.83 3H14a2 2 0 0 1 2 2l-.5 6A2 2 0 0 1 13.5 13H2A2 2 0 0 1 0 11V3Z" fill="#4080ff" opacity={0.7}/>
    ) : (
      <>
        <path d="M0 3a2 2 0 0 1 2-2h3.17a2 2 0 0 1 1.41.59L7.83 3H14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3Z" fill="#4080ff" opacity={0.65}/>
        <path d="M0 5h16v6a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V5Z" fill="#4080ff" opacity={0.9}/>
      </>
    )}
  </svg>
);

const FileSvg = () => (
  <svg width="14" height="16" viewBox="0 0 14 16" fill="none" style={{ flexShrink: 0 }}>
    <path d="M2 0h7l5 5v9a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2Z" fill="#1e2533" stroke="#374151" strokeWidth="0.5"/>
    <path d="M9 0v5h5" fill="none" stroke="#374151" strokeWidth="0.5"/>
    <rect x="3" y="8"  width="8" height="1" rx="0.5" fill="#4b5563"/>
    <rect x="3" y="11" width="6" height="1" rx="0.5" fill="#374151"/>
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

  const dirs  = entries.filter(e => e.is_dir);
  const files = entries.filter(e => !e.is_dir);
  const canGoUp = parent !== null || path !== '';

  const selectValue = type === 'folder' ? path : selected;
  const canConfirm  = type === 'folder' ? !!path : !!selected;

  const rowStyle = (active = false): React.CSSProperties => ({
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 16px',
    background: active ? 'rgba(64,128,255,0.12)' : 'transparent',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    color: active ? '#93c5fd' : 'var(--txt)',
    fontSize: 13,
    transition: 'background 0.1s',
  });

  return (
    <Dialog.Root open={open} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 50 }} />
        <Dialog.Content style={{
          position: 'fixed',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 540,
          maxHeight: '78vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          zIndex: 51,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}>

          {/* Title bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}>
            <Dialog.Title style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', margin: 0 }}>
              {type === 'folder' ? 'Select Folder' : 'Select Source File'}
            </Dialog.Title>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--txt-3)', fontSize: 18, lineHeight: 1, padding: 4 }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--txt)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--txt-3)')}
            >
              ×
            </button>
          </div>

          {/* Path breadcrumb */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 18px',
            borderBottom: '1px solid var(--border-lo)',
            background: 'var(--bg)',
            flexShrink: 0,
          }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 6h10M6 1l5 5-5 5" stroke="var(--txt-3)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="mono" style={{ fontSize: 12, color: path ? 'var(--txt-2)' : 'var(--txt-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {path || 'Computer'}
            </span>
          </div>

          {/* File list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: 'var(--txt-3)', fontSize: 13 }}>
                Loading…
              </div>
            )}
            {error && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: 'var(--red)', fontSize: 13 }}>
                {error}
              </div>
            )}
            {!loading && !error && (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>

                {/* Parent (..) */}
                {canGoUp && (
                  <li style={{ borderBottom: '1px solid var(--border-lo)' }}>
                    <button
                      onClick={() => load(parent ?? '')}
                      style={rowStyle()}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <FolderSvg />
                      <span className="mono" style={{ color: 'var(--txt-3)', fontSize: 13 }}>..</span>
                    </button>
                  </li>
                )}

                {/* Directories */}
                {dirs.map(e => (
                  <li key={e.path} style={{ borderBottom: '1px solid var(--border-lo)' }}>
                    <button
                      onClick={() => handleEntry(e)}
                      style={rowStyle()}
                      onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                      onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
                    >
                      <FolderSvg />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                    </button>
                  </li>
                ))}

                {/* Files (file mode only) */}
                {type === 'file' && files.map(e => {
                  const isSelected = selected === e.path;
                  return (
                    <li key={e.path} style={{ borderBottom: '1px solid var(--border-lo)' }}>
                      <button
                        onClick={() => handleEntry(e)}
                        style={rowStyle(isSelected)}
                        onMouseEnter={ev => { if (!isSelected) ev.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                        onMouseLeave={ev => { if (!isSelected) ev.currentTarget.style.background = 'transparent'; }}
                      >
                        <FileSvg />
                        <span className="mono" style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isSelected ? '#93c5fd' : 'var(--txt)' }}>
                          {e.name}
                        </span>
                        {isSelected && (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M2.5 7L6 10.5L11.5 4" stroke="#4080ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </button>
                    </li>
                  );
                })}

                {!loading && dirs.length === 0 && (type === 'folder' || files.length === 0) && !canGoUp && (
                  <li style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 100, color: 'var(--txt-3)', fontSize: 13 }}>
                    Empty
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 18px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg)',
            flexShrink: 0,
          }}>
            <span className="mono" style={{
              flex: 1, fontSize: 12,
              color: selectValue ? 'var(--txt-2)' : 'var(--txt-3)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {selectValue || (type === 'folder' ? 'No folder selected' : 'No file selected')}
            </span>
            <button
              onClick={onClose}
              style={{
                height: 34, padding: '0 16px',
                background: 'var(--raised)', border: '1px solid var(--border)',
                borderRadius: 5, cursor: 'pointer',
                fontSize: 13, color: 'var(--txt-2)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => { if (canConfirm) { onSelect(selectValue); onClose(); } }}
              disabled={!canConfirm}
              style={{
                height: 34, padding: '0 18px',
                background: canConfirm ? '#4080ff' : '#1a1a2e',
                border: `1px solid ${canConfirm ? '#4080ff' : '#2a2a45'}`,
                borderRadius: 5, cursor: canConfirm ? 'pointer' : 'not-allowed',
                fontSize: 13, fontWeight: 600,
                color: canConfirm ? 'white' : 'var(--txt-3)',
              }}
            >
              {type === 'folder' ? 'Select this folder' : 'Select'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
