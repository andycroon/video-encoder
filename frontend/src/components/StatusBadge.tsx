import type { JobStatus } from '../types';

const COLORS: Record<JobStatus, string> = {
  QUEUED:    'bg-slate-600 text-slate-300',
  RUNNING:   'bg-blue-600 text-white',
  PAUSED:    'bg-amber-700 text-amber-100',
  DONE:      'bg-emerald-800 text-emerald-200',
  FAILED:    'bg-red-800 text-red-200',
  CANCELLED: 'bg-neutral-700 text-neutral-400',
};

export default function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${COLORS[status]}`}>
      {status}
    </span>
  );
}
