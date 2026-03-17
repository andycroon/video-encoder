import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useJobStream from './useJobStream';
import { useJobsStore } from '../store/jobsStore';

// Mock EventSource for jsdom
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  onerror: ((e: Event) => void) | null = null;
  readyState = 1; // OPEN
  constructor(url: string) { this.url = url; MockEventSource.instances.push(this); }
  addEventListener(type: string, handler: (e: MessageEvent) => void) {
    this.listeners[type] ??= [];
    this.listeners[type].push(handler);
  }
  emit(type: string, data: unknown) {
    const e = { data: JSON.stringify(data) } as MessageEvent;
    (this.listeners[type] ?? []).forEach(h => h(e));
  }
  close = vi.fn();
}

beforeEach(() => {
  MockEventSource.instances = [];
  (globalThis as any).EventSource = MockEventSource;
  useJobsStore.setState({ jobs: [
    { id: 1, source_path: '/test.mkv', status: 'RUNNING', config: {}, created_at: '',
      finished_at: null, log: '', currentStage: null, stages: [], chunks: [], totalChunks: null, eta: null }
  ]});
});

afterEach(() => { delete (globalThis as any).EventSource; });

describe('useJobStream — PROG-01 / PROG-02', () => {
  it('PROG-01: stage event updates currentStage via store', () => {
    renderHook(() => useJobStream(1, true));
    const es = MockEventSource.instances[0];
    es.emit('stage', { name: 'ffv1_encode', started_at: '2026-03-08T10:00:00Z' });
    const job = useJobsStore.getState().jobs.find(j => j.id === 1);
    expect(job?.currentStage).toBe('ffv1_encode');
  });

  it('PROG-02: chunk_complete event populates chunk in store', () => {
    renderHook(() => useJobStream(1, true));
    const es = MockEventSource.instances[0];
    // chunk_progress first to record startedAt
    es.emit('chunk_progress', { chunk_index: 0, crf: 17, pass: 1 });
    es.emit('chunk_complete', { chunk_index: 0, crf_used: 17, vmaf_score: 96.8 });
    const job = useJobsStore.getState().jobs.find(j => j.id === 1);
    expect(job?.chunks[0]?.vmaf).toBe(96.8);
  });

  it('closes EventSource on job_complete terminal event', () => {
    renderHook(() => useJobStream(1, true));
    const es = MockEventSource.instances[0];
    es.emit('job_complete', { status: 'DONE', duration: 60 });
    expect(es.close).toHaveBeenCalled();
  });

  it('does not open EventSource when enabled=false', () => {
    renderHook(() => useJobStream(1, false));
    expect(MockEventSource.instances.length).toBe(0);
  });
});
