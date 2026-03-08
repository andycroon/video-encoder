import { useEffect, useRef } from 'react';
import { useJobsStore } from '../store/jobsStore';

const SSE_EVENT_TYPES = ['stage', 'chunk_progress', 'chunk_complete', 'job_complete', 'error', 'warning'] as const;
const TERMINAL_EVENTS = new Set(['job_complete', 'error']);

export default function useJobStream(jobId: number, enabled: boolean): void {
  const handleSseEvent = useJobsStore(s => s.handleSseEvent);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const es = new EventSource(`/api/jobs/${jobId}/stream`);
    esRef.current = es;

    const makeHandler = (type: string) => (e: MessageEvent) => {
      let data: unknown;
      try { data = JSON.parse(e.data); } catch { data = e.data; }
      handleSseEvent(jobId, type, data);
      if (TERMINAL_EVENTS.has(type)) {
        es.close();
        esRef.current = null;
      }
    };

    SSE_EVENT_TYPES.forEach(type => {
      es.addEventListener(type, makeHandler(type));
    });

    es.onerror = () => {
      // onerror fires when backend closes the stream
      // If we already handled a terminal event, do nothing
      if (esRef.current) {
        es.close();
        esRef.current = null;
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [jobId, enabled, handleSseEvent]);
}
