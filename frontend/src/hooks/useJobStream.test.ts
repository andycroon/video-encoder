import { describe, it } from 'vitest';

describe('useJobStream', () => {
  it.todo('PROG-01: stage event updates currentStage in job store');
  it.todo('PROG-02: chunk_complete event populates chunk in job store');
  it.todo('closes EventSource on job_complete terminal event');
  it.todo('does not use onmessage — uses addEventListener for named events');
});
