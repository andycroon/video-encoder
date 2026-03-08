import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import JobRow from './JobRow';
import * as jobsApi from '../api/jobs';
import { Job } from '../types';

const baseJob: Job = {
  id: 1, source_path: '/videos/test.mkv', status: 'RUNNING', config: {}, created_at: '',
  log: '', currentStage: 'chunk_encode', stages: [], chunks: [], totalChunks: 12, eta: 90000,
};

describe('JobRow — QUEUE-02 / QUEUE-04', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('QUEUE-02: Pause button calls pauseJob for RUNNING job', async () => {
    const pause = vi.spyOn(jobsApi, 'pauseJob').mockResolvedValue();
    render(<JobRow job={baseJob} />);
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(pause).toHaveBeenCalledWith(1);
  });

  it('QUEUE-04: Retry button calls retryJob for FAILED job', async () => {
    const retry = vi.spyOn(jobsApi, 'retryJob').mockResolvedValue({ id: 2 } as any);
    const failedJob: Job = { ...baseJob, status: 'FAILED', currentStage: null };
    render(<JobRow job={failedJob} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledWith(1);
  });

  it('shows filename (not full path) in collapsed row', () => {
    render(<JobRow job={baseJob} />);
    expect(screen.getByText('test.mkv')).toBeInTheDocument();
  });
});
