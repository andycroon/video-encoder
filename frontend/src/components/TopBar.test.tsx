import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TopBar from './TopBar';
import * as jobsApi from '../api/jobs';
import * as profilesApi from '../api/profiles';

const mockProfile = {
  id: 1, name: 'Default', is_default: true,
  config: { vmaf_min: 96.2, vmaf_max: 97.6, crf_min: 16, crf_max: 20, crf_start: 17, audio_codec: 'eac3', x264_params: {} }
};

beforeEach(() => {
  vi.spyOn(profilesApi, 'listProfiles').mockResolvedValue([mockProfile]);
  vi.spyOn(jobsApi, 'submitJob').mockResolvedValue({ id: 1 } as any);
});

describe('TopBar — QUEUE-01', () => {
  it('Add button is disabled when path input is empty', async () => {
    render(<TopBar />);
    await waitFor(() => screen.getByRole('button', { name: /add/i }));
    expect(screen.getByRole('button', { name: /add/i })).toBeDisabled();
  });

  it('submits POST /jobs with source_path and selected profile config', async () => {
    render(<TopBar />);
    await waitFor(() => screen.getByPlaceholderText(/source file path/i));
    await userEvent.type(screen.getByPlaceholderText(/source file path/i), '/videos/test.mkv');
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    await waitFor(() => {
      expect(jobsApi.submitJob).toHaveBeenCalledWith('/videos/test.mkv', mockProfile.config);
    });
  });
});
