import { useState } from 'react';
import type { Job } from '../types';
import StatusBadge from './StatusBadge';
import DeleteJobDialog from './DeleteJobDialog';
import { retryJob } from '../api/jobs';
import { useJobsStore } from '../store/jobsStore';

const COL: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: 'var(--txt-3)', padding: '10px 16px',
};

const STATUS_BORDER: Record<string, string> = {
  DONE: '#22c55e', FAILED: '#ef4444',
};

function basename(p: string): string {
  const name = p.split(/[\\/]/).pop() ?? p;
  return name.length > 48 ? name.slice(0, 45) + '...' : name;
}

function avgVmaf(job: Job): string {
  const done = job.chunks.filter(c => c.vmaf !== null);
  if (!done.length) return '\u2014';
  const avg = done.reduce((s, c) => s + (c.vmaf ?? 0), 0) / done.length;
  return avg.toFixed(2);
}

function avgCrf(job: Job): string {
  const done = job.chunks.filter(c => c.crf !== null);
  if (!done.length) return '\u2014';
  const avg = done.reduce((s, c) => s + (c.crf ?? 0), 0) / done.length;
  return avg.toFixed(1);
}

function totalDuration(job: Job): string {
  if (!job.finished_at || !job.created_at) return '\u2014';
  const ms = new Date(job.finished_at).getTime() - new Date(job.created_at).getTime();
  if (isNaN(ms) || ms < 0) return '\u2014';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

interface Props {
  jobs: Job[];
}

export default function HistoryList({ jobs }: Props) {
  const upsertJob = useJobsStore(s => s.upsertJob);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);

  const handleRetry = async (jobId: number) => {
    const updated = await retryJob(jobId);
    upsertJob(updated as any);
  };

  const actionBtn: React.CSSProperties = {
    height: 28, padding: '0 12px',
    fontSize: 12, fontWeight: 500,
    borderRadius: 4, cursor: 'pointer',
    border: '1px solid var(--border)',
    background: 'var(--raised)',
    color: 'var(--txt-2)',
    whiteSpace: 'nowrap',
  };

  if (jobs.length === 0) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: 200,
        border: '1px dashed var(--border)', borderRadius: 8, gap: 8,
      }}>
        <p style={{ color: 'var(--txt-3)', fontSize: 13, margin: 0 }}>No history yet</p>
        <p style={{ color: 'var(--txt-3)', fontSize: 12, margin: 0 }}>Completed and failed jobs will appear here</p>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--panel)', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 120px 110px 90px 110px 140px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
      }}>
        <span style={COL}>File</span>
        <span style={COL}>Status</span>
        <span style={COL}>Avg VMAF</span>
        <span style={COL}>Avg CRF</span>
        <span style={COL}>Duration</span>
        <span style={{ ...COL, textAlign: 'right' }}>Actions</span>
      </div>

      {jobs.map((job, i) => (
        <div key={job.id}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 120px 110px 90px 110px 140px',
              alignItems: 'center',
              minHeight: 52,
              borderTop: i > 0 ? '1px solid var(--border-lo)' : undefined,
              borderLeft: `3px solid ${STATUS_BORDER[job.status] ?? '#3f3f46'}`,
            }}
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

            {/* Avg VMAF */}
            <div style={{ padding: '0 8px' }}>
              <span className="mono" style={{ fontSize: 12, color: 'var(--txt-2)' }}>{avgVmaf(job)}</span>
            </div>

            {/* Avg CRF */}
            <div style={{ padding: '0 8px' }}>
              <span className="mono" style={{ fontSize: 12, color: 'var(--txt-2)' }}>{avgCrf(job)}</span>
            </div>

            {/* Duration */}
            <div style={{ padding: '0 8px' }}>
              <span className="mono" style={{ fontSize: 12, color: 'var(--txt-2)' }}>{totalDuration(job)}</span>
            </div>

            {/* Actions */}
            <div style={{ padding: '0 12px 0 8px', display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
              {job.status === 'FAILED' && (
                <button
                  onClick={() => setExpandedLog(expandedLog === job.id ? null : job.id)}
                  style={{ ...actionBtn, color: '#ef4444', borderColor: '#ef4444' }}
                >
                  {expandedLog === job.id ? 'Hide Error' : 'View Error'}
                </button>
              )}
              <button onClick={() => handleRetry(job.id)} style={actionBtn}>
                Retry
              </button>
              <DeleteJobDialog jobId={job.id} filename={basename(job.source_path)} />
            </div>
          </div>

          {/* Error log expansion for FAILED jobs */}
          {job.status === 'FAILED' && expandedLog === job.id && (
            <div style={{ borderTop: '1px solid var(--border-lo)', background: '#060608', padding: '12px 20px', borderLeft: '3px solid #ef4444' }}>
              <pre className="mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: '#f87171', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {job.log || '— no error details recorded —'}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
