import { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { browse } from '../api/browse';
import type { BrowseEntry } from '../api/browse';
import { moveFiles, copyFiles } from '../api/files';
import type { FileOpResult } from '../api/files';

// ── SVG icons (copied from FilePicker.tsx) ─────────────────────────────────

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

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(1) + ' GB';
  if (bytes >= 1_048_576)     return (bytes / 1_048_576).toFixed(1) + ' MB';
  if (bytes >= 1_024)         return (bytes / 1_024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return '';
  }
}

// ── ConflictDialog ───────────────────────────────────────────────────────────

interface ConflictDialogProps {
  filename: string;
  onOverwrite: () => void;
  onSkip: () => void;
  onCancel: () => void;
}

function ConflictDialog({ filename, onOverwrite, onSkip, onCancel }: ConflictDialogProps) {
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100 }} />
        <Dialog.Content style={{
          position: 'fixed',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 400,
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          zIndex: 101,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          padding: 24,
        }}>
          <Dialog.Title style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)', margin: '0 0 12px' }}>
            File Conflict
          </Dialog.Title>
          <p style={{ fontSize: 13, color: 'var(--txt-2)', margin: '0 0 20px', lineHeight: 1.5 }}>
            <span style={{ fontFamily: 'monospace', color: 'var(--txt)' }}>&ldquo;{filename}&rdquo;</span> already exists at destination.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={onCancel}
              style={{
                height: 34, padding: '0 14px',
                background: 'var(--raised)', border: '1px solid var(--border)',
                borderRadius: 5, cursor: 'pointer', fontSize: 13, color: 'var(--txt-2)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={onSkip}
              style={{
                height: 34, padding: '0 14px',
                background: 'var(--raised)', border: '1px solid var(--border)',
                borderRadius: 5, cursor: 'pointer', fontSize: 13, color: 'var(--txt-2)',
              }}
            >
              Skip
            </button>
            <button
              onClick={onOverwrite}
              style={{
                height: 34, padding: '0 14px',
                background: '#c0392b', border: '1px solid #c0392b',
                borderRadius: 5, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'white',
              }}
            >
              Overwrite
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── FilePanel ────────────────────────────────────────────────────────────────

interface FilePanelProps {
  path: string;
  onNavigate: (path: string) => void;
  side: 'left' | 'right';
  selectedPaths: Set<string>;
  onSelectionChange: (paths: Set<string>) => void;
}

function FilePanel({ path, onNavigate, side, selectedPaths, onSelectionChange }: FilePanelProps) {
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await browse(p);
      setEntries(result.entries);
      setParent(result.parent);
    } catch {
      setError('Could not read directory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(path);
    // Clear selection when navigating (left panel only)
    if (side === 'left') {
      onSelectionChange(new Set());
    }
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirs  = entries.filter(e => e.is_dir);
  const files = entries.filter(e => !e.is_dir);
  const canGoUp = parent !== null || path !== '';

  const allSelected = files.length > 0 && files.every(f => selectedPaths.has(f.path));
  const someSelected = files.some(f => selectedPaths.has(f.path));

  const handleSelectAll = () => {
    if (side !== 'left') return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(files.map(f => f.path)));
    }
  };

  const handleToggle = (filePath: string) => {
    if (side !== 'left') return;
    const next = new Set(selectedPaths);
    if (next.has(filePath)) next.delete(filePath);
    else next.add(filePath);
    onSelectionChange(next);
  };

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      border: '1px solid var(--border)',
      borderRadius: 8,
      overflow: 'hidden',
      background: 'var(--panel)',
    }}>
      {/* Breadcrumb */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 14px',
        borderBottom: '1px solid var(--border-lo)',
        background: 'var(--bg)',
        flexShrink: 0,
        minHeight: 34,
      }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M1 6h10M6 1l5 5-5 5" stroke="var(--txt-3)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="mono" style={{ fontSize: 12, color: path ? 'var(--txt-2)' : 'var(--txt-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {path || 'Computer'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--txt-3)' }}>
          {side === 'left' ? 'Source' : 'Destination'}
        </span>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: side === 'left' ? '28px 20px 1fr 90px 90px' : '20px 1fr 90px 90px',
        alignItems: 'center',
        padding: '0 14px',
        height: 30,
        borderBottom: '1px solid var(--border-lo)',
        flexShrink: 0,
        background: 'var(--bg)',
      }}>
        {side === 'left' && (
          <input
            type="checkbox"
            checked={allSelected}
            ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
            onChange={handleSelectAll}
            style={{ accentColor: '#4080ff', cursor: 'pointer', width: 14, height: 14 }}
            title="Select all"
          />
        )}
        <span /> {/* icon column */}
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--txt-3)' }}>Name</span>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--txt-3)', textAlign: 'right' }}>Size</span>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--txt-3)', textAlign: 'right' }}>Modified</span>
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80, color: 'var(--txt-3)', fontSize: 13 }}>
            Loading…
          </div>
        )}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80, color: '#e74c3c', fontSize: 13 }}>
            {error}
          </div>
        )}
        {!loading && !error && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>

            {/* Parent (..) row */}
            {canGoUp && (
              <li style={{ borderBottom: '1px solid var(--border-lo)' }}>
                <button
                  onClick={() => onNavigate(parent ?? '')}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 14px', background: hovered === '..' ? 'rgba(255,255,255,0.03)' : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--txt-3)', fontSize: 13,
                  }}
                  onMouseEnter={() => setHovered('..')}
                  onMouseLeave={() => setHovered(null)}
                >
                  {side === 'left' && <span style={{ width: 28 }} />}
                  <FolderSvg />
                  <span className="mono" style={{ fontSize: 13 }}>..</span>
                </button>
              </li>
            )}

            {/* Directory rows */}
            {dirs.map(e => (
              <li key={e.path} style={{ borderBottom: '1px solid var(--border-lo)' }}>
                <button
                  onClick={() => onNavigate(e.path)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 14px', background: hovered === e.path ? 'rgba(255,255,255,0.03)' : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--txt)', fontSize: 13,
                  }}
                  onMouseEnter={() => setHovered(e.path)}
                  onMouseLeave={() => setHovered(null)}
                >
                  {side === 'left' && <span style={{ width: 28 }} />}
                  <FolderSvg />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                  <span style={{ width: 90 }} />
                  <span style={{ width: 90 }} />
                </button>
              </li>
            ))}

            {/* File rows */}
            {files.map(e => {
              const isSelected = selectedPaths.has(e.path);
              return (
                <li key={e.path} style={{ borderBottom: '1px solid var(--border-lo)' }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: side === 'left' ? '28px 20px 1fr 90px 90px' : '20px 1fr 90px 90px',
                      alignItems: 'center',
                      padding: '8px 14px',
                      background: isSelected ? 'rgba(64,128,255,0.12)' : hovered === e.path ? 'rgba(255,255,255,0.03)' : 'transparent',
                      cursor: side === 'left' ? 'pointer' : 'default',
                      gap: 8,
                    }}
                    onMouseEnter={() => setHovered(e.path)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => { if (side === 'left') handleToggle(e.path); }}
                  >
                    {side === 'left' && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggle(e.path)}
                        onClick={ev => ev.stopPropagation()}
                        style={{ accentColor: '#4080ff', cursor: 'pointer', width: 14, height: 14 }}
                      />
                    )}
                    <FileSvg />
                    <span
                      className="mono"
                      style={{
                        fontSize: 12,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        color: isSelected ? '#93c5fd' : 'var(--txt)',
                      }}
                    >
                      {e.name}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: 'var(--txt-3)', textAlign: 'right', paddingRight: 4 }}
                    >
                      {formatSize(e.size)}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: 'var(--txt-3)', textAlign: 'right' }}
                    >
                      {formatDate(e.modified_at)}
                    </span>
                  </div>
                </li>
              );
            })}

            {!loading && dirs.length === 0 && files.length === 0 && !canGoUp && (
              <li style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80, color: 'var(--txt-3)', fontSize: 13 }}>
                No files
              </li>
            )}

            {!loading && dirs.length === 0 && files.length === 0 && canGoUp && entries.length === 0 && (
              <li style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80, color: 'var(--txt-3)', fontSize: 13 }}>
                Empty folder
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Conflict resolution state ────────────────────────────────────────────────

interface ConflictState {
  pending: string[];   // paths still to process
  destination: string;
  operation: 'move' | 'copy';
  resolved: string[];  // paths to retry with overwrite
  skipped: string[];
}

// ── FileBrowser (top-level) ──────────────────────────────────────────────────

export default function FileBrowser() {
  const [leftPath, setLeftPath]   = useState('');
  const [rightPath, setRightPath] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [opLoading, setOpLoading] = useState(false);
  const [opError, setOpError]     = useState('');
  const [conflict, setConflict]   = useState<ConflictState | null>(null);
  const [leftRefreshKey, setLeftRefreshKey]   = useState(0);
  const [rightRefreshKey, setRightRefreshKey] = useState(0);

  const refreshBoth = () => {
    setLeftRefreshKey(k => k + 1);
    setRightRefreshKey(k => k + 1);
    setSelectedPaths(new Set());
  };

  // ── Execute a move or copy, handle conflicts ──────────────────────────────

  const executeOp = async (op: 'move' | 'copy', paths: string[], destination: string, overwrite = false) => {
    setOpLoading(true);
    setOpError('');
    try {
      const result: FileOpResult = op === 'move'
        ? await moveFiles(paths, destination, overwrite)
        : await copyFiles(paths, destination, overwrite);

      const conflicts = result.results.filter(r => r.status === 'conflict');
      if (conflicts.length > 0) {
        // Show conflict dialog for first conflict
        setConflict({
          pending: conflicts.map(c => c.path),
          destination,
          operation: op,
          resolved: [],
          skipped: [],
        });
      } else {
        // All done
        refreshBoth();
      }
    } catch {
      setOpError('Operation failed. Please try again.');
    } finally {
      setOpLoading(false);
    }
  };

  const handleMove = () => {
    if (selectedPaths.size === 0 || !rightPath) return;
    executeOp('move', Array.from(selectedPaths), rightPath);
  };

  const handleCopy = () => {
    if (selectedPaths.size === 0 || !rightPath) return;
    executeOp('copy', Array.from(selectedPaths), rightPath);
  };

  // ── Conflict resolution handlers ──────────────────────────────────────────

  const handleOverwrite = async () => {
    if (!conflict) return;
    const [current, ...remaining] = conflict.pending;
    setOpLoading(true);
    try {
      await (conflict.operation === 'move'
        ? moveFiles([current], conflict.destination, true)
        : copyFiles([current], conflict.destination, true));
    } catch {
      setOpError('Overwrite failed.');
    } finally {
      setOpLoading(false);
    }
    if (remaining.length > 0) {
      setConflict({ ...conflict, pending: remaining });
    } else {
      setConflict(null);
      refreshBoth();
    }
  };

  const handleSkip = () => {
    if (!conflict) return;
    const [, ...remaining] = conflict.pending;
    if (remaining.length > 0) {
      setConflict({ ...conflict, pending: remaining });
    } else {
      setConflict(null);
      refreshBoth();
    }
  };

  const handleCancelConflict = () => {
    setConflict(null);
    refreshBoth();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const conflictFilename = conflict
    ? conflict.pending[0].split(/[\\/]/).pop() ?? conflict.pending[0]
    : '';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 53px)',
      background: 'var(--bg)',
      padding: '12px 16px',
      gap: 0,
    }}>

      {/* Panels row */}
      <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0 }}>
        {/* Left panel wrapper with action bar */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <FilePanel
              key={`left-${leftRefreshKey}`}
              path={leftPath}
              onNavigate={setLeftPath}
              side="left"
              selectedPaths={selectedPaths}
              onSelectionChange={setSelectedPaths}
            />
          </div>

          {/* Action bar — only visible when files selected */}
          {selectedPaths.size > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              marginTop: 6,
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 13, color: 'var(--txt-2)', flex: 1 }}>
                {selectedPaths.size} selected
              </span>
              {!rightPath && (
                <span style={{ fontSize: 12, color: '#e67e22' }}>Navigate destination panel to enable Move/Copy</span>
              )}
              <button
                onClick={handleMove}
                disabled={opLoading || !rightPath}
                style={{
                  height: 32, padding: '0 14px',
                  background: !rightPath ? '#1a1a2e' : 'var(--raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 5, cursor: !rightPath ? 'not-allowed' : 'pointer',
                  fontSize: 13, fontWeight: 500,
                  color: !rightPath ? 'var(--txt-3)' : 'var(--txt-2)',
                  whiteSpace: 'nowrap',
                  opacity: opLoading ? 0.5 : 1,
                }}
              >
                Move {'->'}
              </button>
              <button
                onClick={handleCopy}
                disabled={opLoading || !rightPath}
                style={{
                  height: 32, padding: '0 14px',
                  background: !rightPath ? '#1a1a2e' : 'var(--raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 5, cursor: !rightPath ? 'not-allowed' : 'pointer',
                  fontSize: 13, fontWeight: 500,
                  color: !rightPath ? 'var(--txt-3)' : 'var(--txt-2)',
                  whiteSpace: 'nowrap',
                  opacity: opLoading ? 0.5 : 1,
                }}
              >
                Copy {'->'}
              </button>
              <button
                onClick={() => setSelectedPaths(new Set())}
                style={{
                  height: 32, padding: '0 10px',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 5, cursor: 'pointer',
                  fontSize: 13, color: 'var(--txt-3)',
                }}
              >
                x Clear
              </button>
            </div>
          )}

          {opError && (
            <div style={{ fontSize: 12, color: '#e74c3c', marginTop: 4, padding: '0 4px' }}>
              {opError}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <FilePanel
            key={`right-${rightRefreshKey}`}
            path={rightPath}
            onNavigate={setRightPath}
            side="right"
            selectedPaths={new Set()}
            onSelectionChange={() => {}}
          />
        </div>
      </div>

      {/* Conflict dialog */}
      {conflict && (
        <ConflictDialog
          filename={conflictFilename}
          onOverwrite={handleOverwrite}
          onSkip={handleSkip}
          onCancel={handleCancelConflict}
        />
      )}
    </div>
  );
}
