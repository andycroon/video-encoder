import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { deleteJobsBulk } from '../api/jobs';
import { useJobsStore } from '../store/jobsStore';
import type { Job } from '../types';

interface Props {
  historyJobs: Job[];
}

export default function BulkActions({ historyJobs }: Props) {
  const removeJobsByStatus = useJobsStore(s => s.removeJobsByStatus);
  const doneCount = historyJobs.filter(j => j.status === 'DONE').length;
  const failedCount = historyJobs.filter(j => j.status === 'FAILED').length;

  const ghostBtn: React.CSSProperties = {
    height: 34, padding: '0 14px',
    fontSize: 12, fontWeight: 500,
    borderRadius: 5, cursor: 'pointer',
    background: 'var(--raised)',
    border: '1px solid var(--border)',
    color: 'var(--txt-2)',
    fontFamily: 'inherit',
  };

  const dialogBtn: React.CSSProperties = {
    height: 34, padding: '0 16px',
    fontSize: 13, fontWeight: 500,
    borderRadius: 5, cursor: 'pointer',
  };

  const BulkDialog = ({ status, count, label }: { status: 'DONE' | 'FAILED'; count: number; label: string }) => {
    const title = status === 'DONE' ? 'Clear completed jobs?' : 'Clear failed jobs?';
    const description = status === 'DONE'
      ? `Remove all ${count} completed jobs? Active and queued jobs are not affected. This cannot be undone.`
      : `Remove all ${count} failed jobs? Active and queued jobs are not affected. This cannot be undone.`;

    const handleConfirm = async () => {
      try {
        await deleteJobsBulk(status);
        removeJobsByStatus(status);
      } catch {
        // Silent failure
      }
    };

    return (
      <AlertDialog.Root>
        <AlertDialog.Trigger asChild>
          <button
            style={{
              ...ghostBtn,
              opacity: count === 0 ? 0.4 : 1,
              cursor: count === 0 ? 'not-allowed' : 'pointer',
            }}
            disabled={count === 0}
          >
            {label}
          </button>
        </AlertDialog.Trigger>

        <AlertDialog.Portal>
          <AlertDialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 40 }} />
          <AlertDialog.Content
            role="alertdialog"
            style={{
              position: 'fixed', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 340, background: 'var(--raised)',
              border: '1px solid var(--border)',
              borderRadius: 8, padding: 24, zIndex: 50,
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            }}
          >
            <AlertDialog.Title style={{ fontSize: 15, fontWeight: 600, color: 'var(--txt)', margin: '0 0 8px' }}>
              {title}
            </AlertDialog.Title>
            <AlertDialog.Description style={{ fontSize: 13, color: 'var(--txt-2)', margin: '0 0 24px', lineHeight: 1.6 }}>
              {description}
            </AlertDialog.Description>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <AlertDialog.Cancel asChild>
                <button style={{ ...dialogBtn, color: 'var(--txt-2)', background: 'var(--panel)', border: '1px solid var(--border)' }}>
                  Keep jobs
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button onClick={handleConfirm} style={{ ...dialogBtn, color: 'white', background: '#b91c1c', border: '1px solid #991b1b', fontWeight: 600 }}>
                  Clear all
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    );
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <BulkDialog status="DONE" count={doneCount} label="Clear completed" />
      <BulkDialog status="FAILED" count={failedCount} label="Clear failed" />
    </div>
  );
}
