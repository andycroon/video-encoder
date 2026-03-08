import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChunkTable from './ChunkTable';
import type { ChunkData } from '../types';

const completedChunk: ChunkData = {
  chunkIndex: 0, crf: 17, vmaf: 96.8, passes: 1,
  startedAt: 1000, completedAt: 3000, durationMs: 2000,
};
const activeChunk: ChunkData = {
  chunkIndex: 1, crf: 17, vmaf: null, passes: 1,
  startedAt: 3000, completedAt: null, durationMs: null,
};

describe('ChunkTable — PROG-02', () => {
  it('renders a row per completed chunk with CRF and VMAF values', () => {
    render(<ChunkTable chunks={[completedChunk]} />);
    expect(screen.getByText('96.80')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
  });

  it('shows "--" for VMAF on currently-encoding chunk', () => {
    render(<ChunkTable chunks={[activeChunk]} />);
    expect(screen.getAllByText('--').length).toBeGreaterThan(0);
  });
});
