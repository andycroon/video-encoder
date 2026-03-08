import { useEffect } from 'react';
import { listJobs } from '../api/jobs';
import { useJobsStore } from '../store/jobsStore';
import JobRow from './JobRow';

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
      <div
        className="flex flex-col items-center justify-center h-56 rounded"
        style={{ border: '1px solid var(--border-sub)', borderStyle: 'dashed' }}
      >
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>No jobs in queue</div>
        <div className="text-xs mt-1" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>Browse for a source file above and click Add Job</div>
      </div>
    );
  }

  return (
    <div className="rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {/* Column headers */}
      <div
        className="grid text-xs uppercase tracking-widest font-medium px-4 py-1.5"
        style={{
          gridTemplateColumns: '1fr 100px 160px 120px',
          color: 'var(--text-muted)',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span>File</span>
        <span>Status</span>
        <span>Stage</span>
        <span className="text-right">Actions</span>
      </div>
      {jobs.map(job => <JobRow key={job.id} job={job} />)}
    </div>
  );
}
