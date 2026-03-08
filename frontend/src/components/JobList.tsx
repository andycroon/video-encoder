import { useEffect } from 'react';
import { listJobs } from '../api/jobs';
import { useJobsStore } from '../store/jobsStore';
import JobRow from './JobRow';

export default function JobList() {
  const { jobs, setJobs } = useJobsStore(s => ({ jobs: s.jobs, setJobs: s.setJobs }));

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const data = await listJobs();
        // Normalize SSE-derived fields that the REST response won't have
        const normalized = data.map(j => ({
          ...j,
          currentStage: j.currentStage ?? null,
          stages: j.stages ?? [],
          chunks: j.chunks ?? [],
          totalChunks: j.totalChunks ?? null,
          eta: j.eta ?? null,
        }));
        setJobs(normalized as any);
      } catch {
        // Network error — keep existing state
      }
    };
    fetchJobs();
    const id = setInterval(fetchJobs, 5000);
    return () => clearInterval(id);
  }, [setJobs]);

  if (jobs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-600 text-sm">
        No jobs yet — add a source file path above
      </div>
    );
  }

  return (
    <div>
      {jobs.map(job => (
        <JobRow key={job.id} job={job} />
      ))}
    </div>
  );
}
