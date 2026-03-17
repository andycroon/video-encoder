import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { deleteJob } from '../api/jobs';
import { useJobsStore } from '../store/jobsStore';

interface Props {
  jobId: number;
  filename: string;
  onDeleted?: () => void;
}

export default function DeleteJobDialog({ jobId, filename, onDeleted }: Props) {
  const removeJob = useJobsStore(s => s.removeJob);

  const handleConfirm = async () => {
    try {
      await deleteJob(jobId);
      removeJob(jobId);
      onDeleted?.();
    } catch {
      // Silent failure — no toast system exists
    }
  };

  const btn: React.CSSProperties = {
    height: 34, padding: '0 16px',
    fontSize: 13, fontWeight: 500,
    borderRadius: 5, cursor: 'pointer',
  };

  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button
          style={{
            height: 28, padding: '0 12px',
            fontSize: 12, fontWeight: 400,
            borderRadius: 4, cursor: 'pointer',
            color: '#fca5a5',
            background: '#220f0f',
            border: '1px solid #7f1d1d60',
          }}
        >
          Delete
        </button>
      </AlertDialog.Trigger>

      <AlertDialog.Portal>
        <AlertDialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 40 }} />
        <AlertDialog.Content
          role="alertdialog"
          style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 340,
            background: 'var(--raised)',
            border: '1px solid var(--border)',
            borderRadius: 8, padding: 24, zIndex: 50,
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          }}
        >
          {/* Icon */}
          <div style={{
            width: 40, height: 40, borderRadius: 8,
            background: '#220f0f', border: '1px solid #7f1d1d',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4M6.67 7.33v4M9.33 7.33v4" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3.33 4h9.34l-.67 9.33a1.33 1.33 0 01-1.33 1.34H5.33A1.33 1.33 0 014 13.33L3.33 4z" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          <AlertDialog.Title style={{ fontSize: 15, fontWeight: 600, color: 'var(--txt)', margin: '0 0 8px' }}>
            Remove this job?
          </AlertDialog.Title>
          <AlertDialog.Description style={{ fontSize: 13, color: 'var(--txt-2)', margin: '0 0 24px', lineHeight: 1.6 }}>
            Remove <span className="mono" style={{ color: 'var(--txt)' }}>{filename}</span>? This will permanently delete the job record and all associated logs. This cannot be undone.
          </AlertDialog.Description>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <AlertDialog.Cancel asChild>
              <button style={{ ...btn, color: 'var(--txt-2)', background: 'var(--panel)', border: '1px solid var(--border)' }}>
                Keep
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button onClick={handleConfirm} style={{ ...btn, color: 'white', background: '#b91c1c', border: '1px solid #991b1b', fontWeight: 600 }}>
                Delete job
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
