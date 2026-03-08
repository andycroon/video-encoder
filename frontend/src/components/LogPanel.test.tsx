import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LogPanel from './LogPanel';

describe('LogPanel — PROG-03', () => {
  it('starts hidden, shows on toggle', () => {
    render(<LogPanel log="ffmpeg stderr output line 1" />);
    expect(screen.queryByText('ffmpeg stderr output line 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show ffmpeg log/i }));
    expect(screen.getByText('ffmpeg stderr output line 1')).toBeInTheDocument();
  });

  it('hides log on second toggle click', () => {
    render(<LogPanel log="some log" />);
    fireEvent.click(screen.getByRole('button', { name: /show ffmpeg log/i }));
    fireEvent.click(screen.getByRole('button', { name: /hide ffmpeg log/i }));
    expect(screen.queryByText('some log')).not.toBeInTheDocument();
  });
});
