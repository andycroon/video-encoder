import type { Job } from '../types';
import useJobStream from '../hooks/useJobStream';
import StageList from './StageList';
import ChunkTable from './ChunkTable';
import LogPanel from './LogPanel';

interface Props { job: Job }

const sectionHead: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--txt-3)',
  marginBottom: 14,
};

export default function JobCard({ job }: Props) {
  useJobStream(job.id, job.status === 'RUNNING');

  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>

      {/* Two-column body */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border-lo)' }}>

        {/* Pipeline stages */}
        <div style={{ padding: '20px 24px', borderRight: '1px solid var(--border-lo)' }}>
          <p style={sectionHead}>Pipeline</p>
          <StageList stages={job.stages} currentStage={job.currentStage} totalChunks={job.totalChunks} />
        </div>

        {/* Chunk data */}
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
            <p style={{ ...sectionHead, margin: 0 }}>Chunks</p>
            {job.totalChunks != null && (
              <span className="mono" style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                {job.chunks.filter(c => c.completedAt != null).length} / {job.totalChunks}
              </span>
            )}
          </div>
          <ChunkTable chunks={job.chunks} />
        </div>
      </div>

      {/* Log */}
      <LogPanel log={job.log} />
    </div>
  );
}
