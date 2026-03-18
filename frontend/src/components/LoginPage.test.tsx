import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoginPage from './LoginPage';
import * as authApi from '../api/auth';

beforeEach(() => {
  vi.spyOn(authApi, 'login').mockResolvedValue({ access_token: 'test-token' });
});

describe('LoginPage', () => {
  it('renders Sign In button text', () => {
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('renders USERNAME and PASSWORD labels', () => {
    render(<LoginPage />);
    expect(screen.getByText(/username/i)).toBeInTheDocument();
    expect(screen.getByText(/password/i)).toBeInTheDocument();
  });

  it('submit button is disabled when fields are empty', () => {
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });
});
