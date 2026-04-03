export type JobStatus = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'DONE' | 'FAILED' | 'CANCELLED' | 'RESUMING';

export interface ChunkData {
  chunkIndex: number;
  crf: number | null;
  vmaf: number | null;
  passes: number;
  startedAt: number | null;     // Date.now() when chunk_progress arrived
  completedAt: number | null;   // Date.now() when chunk_complete arrived
  durationMs: number | null;
}

export interface StageData {
  name: string;
  startedAt: string;
  completedAt: string | null;
}

export interface Job {
  id: number;
  source_path: string;
  status: JobStatus;
  config: Record<string, unknown>;
  created_at: string;
  finished_at: string | null;
  log: string;
  // SSE-derived live state (not from REST)
  currentStage: string | null;
  stages: StageData[];
  chunks: ChunkData[];
  totalChunks: number | null;
  eta: number | null;          // milliseconds remaining, null if unknown
}

export interface Profile {
  id: number;
  name: string;
  is_default: boolean;
  config: {
    vmaf_min: number;
    vmaf_max: number;
    crf_min: number;
    crf_max: number;
    crf_start: number;
    audio_codec: string;
    subtitle_mode: 'none' | 'extract';
    tesseract_lang: string;
    x264_params: Record<string, string>;
  };
}

export type SseEventType = 'stage' | 'chunk_progress' | 'chunk_complete' | 'job_complete' | 'error' | 'warning' | 'log';
