import { AnimatePresence, motion } from 'motion/react';
import type { Job } from '../types';
import { pauseJob, retryJob } from '../api/jobs';
import { useJobsStore } from '../store/jobsStore';
import StatusBadge from './StatusBadge';
import CancelDialog from './CancelDialog';
import JobCard from './JobCard';

function basename(p: string): string {
  const name = p.split(/[\\/]/).pop() ?? p;
  return name.length > 40 ? name.slice(0, 37) + '…' : name;
}

function formatEta(ms: number | null): string {
  if (ms === null) return '--';
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
    ? `ETA ${formatEta(job.eta)}`
    : null;

  const stageDisplay = job.currentStage
    ? job.currentStage.replace(/_/g, ' ')
    : job.status.toLowerCase();

  return (
    <div className="border-b border-neutral-800/70">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.03] select-none transition-colors"
        onClick={() => setExpanded(isExpanded ? null : job.id)}
      >
        <span className="flex-1 text-sm text-neutral-200 font-mono truncate">
          {basename(job.source_path)}
        </span>
        <StatusBadge status={job.status} />
        <span className="text-xs text-neutral-500 min-w-32 text-right">
          {stageDisplay}
          {etaText && <span className="ml-2 text-neutral-600">{etaText}</span>}
        </span>
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          {job.status === 'RUNNING' && (
            <button
              onClick={handlePause}
              className="px-2 py-1 text-xs rounded bg-amber-900/30 text-amber-400 hover:bg-amber-900/60 transition-colors"
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
              className="px-2 py-1 text-xs rounded bg-neutral-700 text-neutral-300 hover:bg-neutral-600 transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      </div>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            key="card"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <JobCard job={job} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
