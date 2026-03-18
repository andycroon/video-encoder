import { useEffect, useRef } from 'react';
import { useJobsStore } from '../store/jobsStore';
import useAuthStore from '../store/authStore';

const SSE_EVENT_TYPES = ['stage', 'chunk_progress', 'chunk_complete', 'job_complete', 'error', 'warning', 'log'] as const;
const TERMINAL_EVENTS = new Set(['job_complete', 'error']);

export default function useJobStream(jobId: number, enabled: boolean): void {
  const handleSseEvent = useJobsStore(s => s.handleSseEvent);
  const token = useAuthStore(s => s.token);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;

    // Append ?token= for auth — EventSource cannot send Authorization headers
    let url = `/api/jobs/${jobId}/stream`;
    if (token) {
      url += `?token=${encodeURIComponent(token)}`;
    }

    const es = new EventSource(url);
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
      if (esRef.current) {
        es.close();
        esRef.current = null;
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [jobId, enabled, handleSseEvent, token]);
}
