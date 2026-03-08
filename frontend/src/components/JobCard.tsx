import { Job } from '../types';
import useJobStream from '../hooks/useJobStream';
import StageList from './StageList';
import ChunkTable from './ChunkTable';
import LogPanel from './LogPanel';

interface Props { job: Job }

export default function JobCard({ job }: Props) {
  useJobStream(job.id, job.status === 'RUNNING');

  return (
    <div className="border-t border-neutral-800">
      <div className="grid grid-cols-2 gap-6 p-4">
        <div>
          <h4 className="text-xs uppercase tracking-widest text-neutral-600 mb-3">Pipeline</h4>
          <StageList
            stages={job.stages}
            currentStage={job.currentStage}
            totalChunks={job.totalChunks}
          />
        </div>
        <div>
          <h4 className="text-xs uppercase tracking-widest text-neutral-600 mb-3">Chunks</h4>
          <ChunkTable chunks={job.chunks} />
        </div>
      </div>
      <LogPanel log={job.log} />
    </div>
  );
}
