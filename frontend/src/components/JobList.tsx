import { useEffect } from 'react';
import { listJobs } from '../api/jobs';
import { useJobsStore } from '../store/jobsStore';
import JobRow from './JobRow';

const COL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--txt-3)',
  padding: '10px 16px',
};

export default function JobList() {
  const jobs = useJobsStore(s => s.jobs);
  const setJobs = useJobsStore(s => s.setJobs);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const data = await listJobs();
        const normalized = data.map(j => ({
          ...j,
          currentStage: j.currentStage ?? null,
          stages: j.stages ?? [],
          chunks: j.chunks ?? [],
          totalChunks: j.totalChunks ?? null,
          eta: j.eta ?? null,
        }));
        setJobs(normalized as any);
      } catch {}
    };
    fetchJobs();
    const id = setInterval(fetchJobs, 5000);
    return () => clearInterval(id);
  }, [setJobs]);

  if (jobs.length === 0) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: 200,
        border: '1px dashed var(--border)',
        borderRadius: 8,
        gap: 8,
      }}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <rect x="4" y="4" width="24" height="24" rx="4" stroke="#2a2a35" strokeWidth="1.5"/>
          <path d="M12 16h8M16 12v8" stroke="#55555f" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <p style={{ color: 'var(--txt-3)', fontSize: 13, margin: 0 }}>No jobs in queue</p>
        <p style={{ color: 'var(--txt-3)', fontSize: 12, margin: 0 }}>Browse for a source file and click Add Job</p>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 130px 200px 160px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
      }}>
        <span style={COL}>File</span>
        <span style={COL}>Status</span>
        <span style={COL}>Stage</span>
        <span style={{ ...COL, textAlign: 'right' }}>Actions</span>
      </div>

      {jobs.map((job, i) => (
        <div key={job.id} style={{ borderTop: i > 0 ? '1px solid var(--border-lo)' : undefined }}>
          <JobRow job={job} />
        </div>
      ))}
    </div>
  );
}
