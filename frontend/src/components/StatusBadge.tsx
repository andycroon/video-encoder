import type { JobStatus } from '../types';

const STATUS_CONFIG: Record<JobStatus, { dot: string; label: string; style: React.CSSProperties }> = {
  QUEUED:    { dot: '#64748b', label: 'Queued',    style: { color: '#94a3b8', background: '#1e2433', border: '1px solid #2d3748' } },
  RUNNING:   { dot: '#3b82f6', label: 'Running',   style: { color: '#93c5fd', background: '#1a2540', border: '1px solid #2d4a8a' } },
  PAUSED:    { dot: '#f59e0b', label: 'Paused',    style: { color: '#fcd34d', background: '#2a2010', border: '1px solid #78450a' } },
  DONE:      { dot: '#10b981', label: 'Done',      style: { color: '#6ee7b7', background: '#0d2420', border: '1px solid #1a5c3e' } },
  FAILED:    { dot: '#ef4444', label: 'Failed',    style: { color: '#fca5a5', background: '#2a1515', border: '1px solid #7c2323' } },
  CANCELLED: { dot: '#52525b', label: 'Cancelled', style: { color: '#71717a', background: '#18181b', border: '1px solid #27272a' } },
};

export default function StatusBadge({ status }: { status: JobStatus }) {
  const cfg = STATUS_CONFIG[status];
  const isRunning = status === 'RUNNING';
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium tracking-wide"
      style={cfg.style}
    >
      <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
        {isRunning && (
          <span
            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
            style={{ background: cfg.dot }}
          />
        )}
        <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: cfg.dot }} />
      </span>
      {cfg.label}
    </span>
  );
}
