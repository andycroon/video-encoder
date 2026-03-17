import type { JobStatus } from '../types';

const CFG: Record<JobStatus, { color: string; bg: string; border: string; label: string; pulse?: boolean }> = {
  QUEUED:    { color: '#94a3b8', bg: '#1e2433',  border: '#334155', label: 'Queued'    },
  RUNNING:   { color: '#93c5fd', bg: '#172035',  border: '#2563eb', label: 'Running', pulse: true },
  PAUSED:    { color: '#fcd34d', bg: '#261d0d',  border: '#92400e', label: 'Paused'    },
  RESUMING:  { color: '#fbbf24', bg: '#1c1600',  border: '#78350f', label: 'Resuming', pulse: true },
  DONE:      { color: '#86efac', bg: '#0d2318',  border: '#166534', label: 'Done'      },
  FAILED:    { color: '#fca5a5', bg: '#220f0f',  border: '#7f1d1d', label: 'Failed'    },
  CANCELLED: { color: '#71717a', bg: '#18181b',  border: '#27272a', label: 'Cancelled' },
};

export default function StatusBadge({ status }: { status: JobStatus }) {
  const c = CFG[status];
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '3px 9px',
      borderRadius: 4,
      fontSize: 12,
      fontWeight: 500,
      letterSpacing: '0.02em',
      color: c.color,
      background: c.bg,
      border: `1px solid ${c.border}`,
    }}>
      <span style={{ position: 'relative', display: 'inline-flex', width: 6, height: 6, flexShrink: 0 }}>
        {c.pulse && (
          <span style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: c.color, opacity: 0.6,
            animation: 'ping 1.2s cubic-bezier(0,0,0.2,1) infinite',
          }} />
        )}
        <span style={{ position: 'relative', display: 'inline-flex', borderRadius: '50%', width: 6, height: 6, background: c.color }} />
      </span>
      {c.label}
      <style>{`@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }`}</style>
    </span>
  );
}
