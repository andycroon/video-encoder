import { AnimatePresence, motion } from 'motion/react';
import type { Job } from '../types';
import type { JobStatus } from '../types';
import { pauseJob, retryJob } from '../api/jobs';
import { useJobsStore } from '../store/jobsStore';
import StatusBadge from './StatusBadge';
import CancelDialog from './CancelDialog';
import JobCard from './JobCard';

const STATUS_BORDER: Record<JobStatus, string> = {
  QUEUED:    '#64748b',
  RUNNING:   '#4080ff',
  PAUSED:    '#f59e0b',
  DONE:      '#22c55e',
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

  const actionBtn: React.CSSProperties = {
    height: 28, padding: '0 12px',
    fontSize: 12, fontWeight: 500,
    borderRadius: 4,
    cursor: 'pointer',
    border: '1px solid var(--border)',
    background: 'var(--raised)',
    color: 'var(--txt-2)',
    whiteSpace: 'nowrap',
  };

  return (
    <>
      <div
        onClick={() => setExpanded(isExpanded ? null : job.id)}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 130px 200px 160px',
          alignItems: 'center',
          minHeight: 52,
          cursor: 'pointer',
          userSelect: 'none',
          borderLeft: `3px solid ${STATUS_BORDER[job.status]}`,
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        {/* Filename */}
        <div style={{ padding: '0 16px' }}>
          <span className="mono" style={{ fontSize: 13, color: 'var(--txt)' }}>
            {basename(job.source_path)}
          </span>
        </div>

        {/* Status */}
        <div style={{ padding: '0 8px' }}>
          <StatusBadge status={job.status} />
        </div>

        {/* Stage + ETA */}
        <div style={{ padding: '0 8px' }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--txt-2)' }}>{stageDisplay}</span>
          {etaText && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--txt-3)', marginLeft: 10 }}>
              ETA {etaText}
            </span>
          )}
        </div>

        {/* Actions */}
        <div
          style={{ padding: '0 12px 0 8px', display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}
          onClick={e => e.stopPropagation()}
        >
          {job.status === 'RUNNING' && (
            <button onClick={handlePause} style={{ ...actionBtn, color: '#fcd34d', borderColor: '#78450a60', background: '#1f1408' }}>
              Pause
            </button>
          )}
          {(job.status === 'RUNNING' || job.status === 'QUEUED') && (
            <CancelDialog jobId={job.id} onCancelled={() => {}} />
          )}
          {(job.status === 'FAILED' || job.status === 'CANCELLED' || job.status === 'DONE') && (
            <button onClick={handleRetry} style={actionBtn}>
              Retry
            </button>
          )}
          {/* Chevron */}
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none"
            style={{ color: 'var(--txt-3)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', marginLeft: 4, flexShrink: 0 }}
          >
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* Expanded card */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            key="card"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <JobCard job={job} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
