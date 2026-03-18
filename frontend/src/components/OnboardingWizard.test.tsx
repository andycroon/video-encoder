import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import OnboardingWizard from './OnboardingWizard';
import * as authApi from '../api/auth';

beforeEach(() => {
  vi.spyOn(authApi, 'register').mockResolvedValue({ access_token: 'test-token' });
});

describe('OnboardingWizard', () => {
  it('renders Create Account button text', () => {
    render(<OnboardingWizard />);
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('renders Set up your account heading', () => {
    render(<OnboardingWizard />);
    expect(screen.getByText('Set up your account')).toBeInTheDocument();
  });

  it('renders CONFIRM PASSWORD label', () => {
    render(<OnboardingWizard />);
    expect(screen.getByText(/confirm password/i)).toBeInTheDocument();
  });
});
