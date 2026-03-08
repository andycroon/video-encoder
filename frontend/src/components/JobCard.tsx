import type { Job } from '../types';
import useJobStream from '../hooks/useJobStream';
import StageList from './StageList';
import ChunkTable from './ChunkTable';
import LogPanel from './LogPanel';

interface Props { job: Job }

export default function JobCard({ job }: Props) {
  useJobStream(job.id, job.status === 'RUNNING');

  return (
    <div style={{ background: 'var(--bg-panel)', borderTop: '1px solid var(--border)' }}>
      <div className="grid grid-cols-2" style={{ borderBottom: '1px solid var(--border-sub)' }}>
        {/* Pipeline */}
        <div className="p-4" style={{ borderRight: '1px solid var(--border-sub)' }}>
          <div className="text-xs uppercase tracking-widest font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
            Pipeline
          </div>
          <StageList stages={job.stages} currentStage={job.currentStage} totalChunks={job.totalChunks} />
        </div>

        {/* Chunks */}
        <div className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs uppercase tracking-widest font-medium" style={{ color: 'var(--text-muted)' }}>Chunks</span>
            {job.totalChunks && (
              <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                {job.chunks.filter(c => c.completedAt !== null).length}/{job.totalChunks}
              </span>
            )}
          </div>
          <ChunkTable chunks={job.chunks} />
        </div>
      </div>

      <LogPanel log={job.log} />
    </div>
  );
}
