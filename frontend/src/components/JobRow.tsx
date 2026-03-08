import { AnimatePresence, motion } from 'motion/react';
import type { Job } from '../types';
import type { JobStatus } from '../types';
import { pauseJob, retryJob } from '../api/jobs';
import { useJobsStore } from '../store/jobsStore';
import StatusBadge from './StatusBadge';
import CancelDialog from './CancelDialog';
import JobCard from './JobCard';

const STATUS_BAR: Record<JobStatus, string> = {
  QUEUED:    '#64748b',
  RUNNING:   '#3b82f6',
  PAUSED:    '#f59e0b',
  DONE:      '#10b981',
  FAILED:    '#ef4444',
  CANCELLED: '#3f3f46',
};

function basename(p: string): string {
  const name = p.split(/[\\/]/).pop() ?? p;
  return name.length > 48 ? name.slice(0, 45) + '…' : name;
}

function formatEta(ms: number | null): string {
  if (ms === null) return '';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

interface Props { job: Job }

export default function JobRow({ job }: Props) {
  const expandedJobId = useJobsStore(s => s.expandedJobId);
  const setExpanded = useJobsStore(s => s.setExpanded);
  const upsertJob = useJobsStore(s => s.upsertJob);
  const isExpanded = expandedJobId === job.id;

  const handlePause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await pauseJob(job.id);
  };

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = await retryJob(job.id);
    upsertJob(updated as any);
  };

  const etaText = job.currentStage === 'chunk_encode' && job.eta !== null
    ? formatEta(job.eta)
    : null;

  const stageDisplay = job.currentStage
    ? job.currentStage.replace(/_/g, ' ')
    : '—';

  return (
    <div style={{ borderBottom: '1px solid var(--border-sub)' }}>
      <div
        className="flex items-center cursor-pointer select-none transition-colors hover:bg-white/[0.025]"
        style={{ borderLeft: `2px solid ${STATUS_BAR[job.status]}` }}
        onClick={() => setExpanded(isExpanded ? null : job.id)}
      >
        {/* Filename */}
        <span className="flex-1 px-4 py-2.5 text-sm font-mono truncate" style={{ color: 'var(--text-primary)' }}>
          {basename(job.source_path)}
        </span>

        {/* Status */}
        <span className="w-[100px] px-2 flex-shrink-0">
          <StatusBadge status={job.status} />
        </span>

        {/* Stage + ETA */}
        <span className="w-[160px] px-2 flex-shrink-0">
          <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{stageDisplay}</span>
          {etaText && (
            <span className="text-xs font-mono ml-2" style={{ color: 'var(--text-muted)' }}>{etaText}</span>
          )}
        </span>

        {/* Actions */}
        <span className="w-[120px] px-3 flex-shrink-0 flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
          {job.status === 'RUNNING' && (
            <button
              onClick={handlePause}
              className="px-2 py-0.5 text-xs rounded transition-colors hover:bg-white/[0.06]"
              style={{ color: '#fcd34d', background: '#2a200e', border: '1px solid #78450a40' }}
            >
              Pause
            </button>
          )}
          {(job.status === 'RUNNING' || job.status === 'QUEUED') && (
            <CancelDialog jobId={job.id} onCancelled={() => {}} />
          )}
          {(job.status === 'FAILED' || job.status === 'CANCELLED' || job.status === 'DONE') && (
            <button
              onClick={handleRetry}
              className="px-2 py-0.5 text-xs rounded transition-colors"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
            >
              Retry
            </button>
          )}
          <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>
            {isExpanded ? '▴' : '▾'}
          </span>
        </span>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            key="card"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <JobCard job={job} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
