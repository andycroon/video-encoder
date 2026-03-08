import { JobStatus } from '../types';

const COLORS: Record<JobStatus, string> = {
  QUEUED:    'bg-neutral-700 text-neutral-300',
  RUNNING:   'bg-blue-900 text-blue-300',
  PAUSED:    'bg-yellow-900 text-yellow-300',
  DONE:      'bg-green-900 text-green-300',
  FAILED:    'bg-red-900 text-red-300',
  CANCELLED: 'bg-neutral-700 text-neutral-400',
};

export default function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${COLORS[status]}`}>
      {status}
    </span>
  );
}
