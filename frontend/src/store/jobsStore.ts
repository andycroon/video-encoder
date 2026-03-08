import { create } from 'zustand';
import type { Job, Profile, ChunkData } from '../types';

interface JobsState {
  jobs: Job[];
  profiles: Profile[];
  expandedJobId: number | null;
  setJobs: (jobs: Job[]) => void;
  setProfiles: (profiles: Profile[]) => void;
  upsertJob: (job: Job) => void;
  setExpanded: (id: number | null) => void;
  handleSseEvent: (jobId: number, type: string, data: unknown) => void;
}

function applyEvent(job: Job, type: string, data: unknown): Job {
  const now = Date.now();
  switch (type) {
    case 'stage': {
      const d = data as { name: string; started_at?: string };
      const now = new Date().toISOString();
      // Mark the previous stage as completed
      const updatedStages = job.stages.map(s =>
        s.completedAt === null ? { ...s, completedAt: now } : s
      );
      return {
        ...job,
        currentStage: d.name,
        stages: [...updatedStages, { name: d.name, startedAt: d.started_at ?? now, completedAt: null }],
      };
    }
    case 'chunk_progress': {
      const d = data as { chunk_index: number; crf: number; pass: number };
      const existing = job.chunks.find(c => c.chunkIndex === d.chunk_index);
      if (existing) return job; // already have this chunk
      const newChunk: ChunkData = {
        chunkIndex: d.chunk_index,
        crf: d.crf,
        vmaf: null,
        passes: d.pass,
        startedAt: now,
        completedAt: null,
        durationMs: null,
      };
      return { ...job, chunks: [...job.chunks, newChunk] };
    }
    case 'chunk_complete': {
      const d = data as { chunk_index: number; crf_used: number; vmaf_score: number };
      const chunks = job.chunks.map(c => {
        if (c.chunkIndex !== d.chunk_index) return c;
        const durationMs = c.startedAt ? now - c.startedAt : null;
        return { ...c, crf: d.crf_used, vmaf: d.vmaf_score, completedAt: now, durationMs };
      });
      // Compute ETA from completed chunks
      const completed = chunks.filter(c => c.durationMs !== null);
      const total = job.totalChunks ?? chunks.length;
      let eta: number | null = null;
      if (completed.length > 0 && total > completed.length) {
        const avgMs = completed.reduce((s, c) => s + (c.durationMs ?? 0), 0) / completed.length;
        eta = (total - completed.length) * avgMs;
      }
      return { ...job, chunks, eta };
    }
    case 'job_complete': {
      const d = data as { status: string; duration: number };
      return { ...job, status: d.status as Job['status'], currentStage: null, eta: null };
    }
    case 'log': {
      const d = data as { line: string };
      const lines = job.log ? job.log.split('\n') : [];
      // Replace last line if it looks like a progress update (contains fps=), otherwise append
      const isProgress = d.line.includes('fps=') || d.line.includes('frame=');
      const lastIsProgress = lines.length > 0 && (lines[lines.length - 1].includes('fps=') || lines[lines.length - 1].includes('frame='));
      if (isProgress && lastIsProgress) {
        lines[lines.length - 1] = d.line;
      } else {
        lines.push(d.line);
      }
      return { ...job, log: lines.join('\n') };
    }
    case 'error': {
      return { ...job, status: 'FAILED', currentStage: null, eta: null };
    }
    default:
      return job;
  }
}

export const useJobsStore = create<JobsState>((set) => ({
  jobs: [],
  profiles: [],
  expandedJobId: null,
  setJobs: (jobs) => set((state) => ({
    jobs: jobs.map(incoming => {
      const existing = state.jobs.find(j => j.id === incoming.id);
      if (!existing) return incoming;
      // Preserve SSE-accumulated live state — REST poll doesn't have it
      return {
        ...incoming,
        log: existing.log.length > incoming.log.length ? existing.log : incoming.log,
        currentStage: existing.currentStage ?? incoming.currentStage,
        stages: existing.stages.length > 0 ? existing.stages : incoming.stages,
        chunks: existing.chunks.length > incoming.chunks.length ? existing.chunks : incoming.chunks,
        totalChunks: existing.totalChunks ?? incoming.totalChunks,
        eta: existing.eta ?? incoming.eta,
      };
    }),
  })),
  setProfiles: (profiles) => set({ profiles }),
  upsertJob: (job) =>
    set((state) => {
      const exists = state.jobs.find(j => j.id === job.id);
      const normalized = {
        ...job,
        currentStage: job.currentStage ?? null,
        stages: job.stages ?? [],
        chunks: job.chunks ?? [],
        totalChunks: job.totalChunks ?? null,
        eta: job.eta ?? null,
      };
      if (!exists) return { jobs: [...state.jobs, normalized] };
      return { jobs: state.jobs.map(j => j.id === job.id ? { ...normalized, ...j, status: job.status } : j) };
    }),
  setExpanded: (id) => set({ expandedJobId: id }),
  handleSseEvent: (jobId, type, data) =>
    set((state) => ({
      jobs: state.jobs.map(j => j.id === jobId ? applyEvent(j, type, data) : j),
    })),
}));
