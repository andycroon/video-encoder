import type { Job } from '../types';
import useJobStream from '../hooks/useJobStream';
import StageList from './StageList';
import ChunkTable from './ChunkTable';
import LogPanel from './LogPanel';
import VmafChart from './VmafChart';

interface Props { job: Job }

const sectionHead: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--txt-3)',
  marginBottom: 14,
};

function vmafColor(v: number): string {
  if (v >= 96) return '#22c55e';
  if (v >= 93) return '#f59e0b';
  return '#ef4444';
}

export default function JobCard({ job }: Props) {
  useJobStream(job.id, job.status === 'RUNNING');

  const doneChunks = job.chunks.filter(c => c.vmaf !== null && c.crf !== null);
  const avgVmaf = doneChunks.length > 0
    ? doneChunks.reduce((s, c) => s + (c.vmaf ?? 0), 0) / doneChunks.length
    : null;
  const avgCrf = doneChunks.length > 0
    ? doneChunks.reduce((s, c) => s + (c.crf ?? 0), 0) / doneChunks.length
    : null;

  const vmafMin = (job.config.vmaf_min as number) ?? 96.2;
  const vmafMax = (job.config.vmaf_max as number) ?? 97.6;

  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>

      {/* Two-column body */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border-lo)' }}>

        {/* Pipeline stages */}
        <div style={{ padding: '20px 24px', borderRight: '1px solid var(--border-lo)' }}>
          <p style={sectionHead}>Pipeline</p>
          <StageList stages={job.stages} currentStage={job.currentStage} totalChunks={job.totalChunks} completedChunks={doneChunks.length} />
        </div>

        {/* Chunk data */}
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
            <p style={{ ...sectionHead, margin: 0 }}>Chunks</p>
            {job.totalChunks != null && (
              <span className="mono" style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                {doneChunks.length} / {job.totalChunks}
              </span>
            )}

            {/* Averages — shown as soon as any chunks complete */}
            {avgVmaf !== null && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                  avg VMAF{' '}
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: vmafColor(avgVmaf) }}>
                    {avgVmaf.toFixed(2)}
                  </span>
                </span>
                <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                  avg CRF{' '}
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt-2)' }}>
                    {avgCrf!.toFixed(1)}
                  </span>
                </span>
              </div>
            )}
          </div>
          <ChunkTable chunks={job.chunks} />
        </div>
      </div>

      {/* VMAF Chart */}
      <VmafChart chunks={job.chunks} vmafMin={vmafMin} vmafMax={vmafMax} />

      {/* Log */}
      <LogPanel log={job.log} defaultOpen={job.status === 'FAILED'} />
    </div>
  );
}
