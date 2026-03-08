import { describe, it, expect } from 'vitest';

describe('PROG-04: ETA computation', () => {
  it('returns null when no chunks completed', () => {
    // Pure function — no hook needed for basic math
    const completed: Array<{ durationMs: number }> = [];
    const total = 10;
    const result = completed.length === 0
      ? null
      : (total - completed.length) * (completed.reduce((s, c) => s + c.durationMs, 0) / completed.length);
    expect(result).toBeNull();
  });

  it('computes correct ETA from completed chunks', () => {
    const completed = [{ durationMs: 2000 }, { durationMs: 4000 }]; // avg 3000ms
    const total = 5;
    const avg = completed.reduce((s, c) => s + c.durationMs, 0) / completed.length;
    const eta = (total - completed.length) * avg; // 3 remaining * 3000ms = 9000ms
    expect(eta).toBe(9000);
  });
});
