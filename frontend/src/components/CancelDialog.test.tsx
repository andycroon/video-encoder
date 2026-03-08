import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CancelDialog from './CancelDialog';
import * as jobsApi from '../api/jobs';

describe('CancelDialog — QUEUE-03', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('calls cancelJob only after user confirms', async () => {
    const cancel = vi.spyOn(jobsApi, 'cancelJob').mockResolvedValue();
    render(<CancelDialog jobId={5} onCancelled={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    // Dialog should appear
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    // Confirm
    fireEvent.click(screen.getByRole('button', { name: /cancel job/i }));
    expect(cancel).toHaveBeenCalledWith(5);
  });

  it('does not call cancelJob when user dismisses', async () => {
    const cancel = vi.spyOn(jobsApi, 'cancelJob').mockResolvedValue();
    render(<CancelDialog jobId={5} onCancelled={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    fireEvent.click(screen.getByRole('button', { name: /keep running/i }));
    expect(cancel).not.toHaveBeenCalled();
  });
});
