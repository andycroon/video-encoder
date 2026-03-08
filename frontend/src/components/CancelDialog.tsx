import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { cancelJob } from '../api/jobs';

interface Props { jobId: number; onCancelled: () => void; }

export default function CancelDialog({ jobId, onCancelled }: Props) {
  const handleConfirm = async () => {
    await cancelJob(jobId);
    onCancelled();
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
            fontSize: 12, fontWeight: 500,
            borderRadius: 4, cursor: 'pointer',
            color: '#fca5a5',
            background: '#220f0f',
            border: '1px solid #7f1d1d60',
          }}
        >
          Cancel
        </button>
      </AlertDialog.Trigger>

      <AlertDialog.Portal>
        <AlertDialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 40 }} />
        <AlertDialog.Content
          role="alertdialog"
          style={{
            position: 'fixed',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 340,
            background: 'var(--raised)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 24,
            zIndex: 50,
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
              <path d="M8 3v6M8 12v.5" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>

          <AlertDialog.Title style={{ fontSize: 15, fontWeight: 600, color: 'var(--txt)', margin: '0 0 8px' }}>
            Cancel encoding job?
          </AlertDialog.Title>
          <AlertDialog.Description style={{ fontSize: 13, color: 'var(--txt-2)', margin: '0 0 24px', lineHeight: 1.6 }}>
            ffmpeg will be stopped and temporary files cleaned up. This cannot be undone.
          </AlertDialog.Description>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <AlertDialog.Cancel asChild>
              <button style={{
                ...btn,
                color: 'var(--txt-2)',
                background: 'var(--panel)',
                border: '1px solid var(--border)',
              }}>
                Keep running
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                onClick={handleConfirm}
                style={{
                  ...btn,
                  color: 'white',
                  background: '#b91c1c',
                  border: '1px solid #991b1b',
                  fontWeight: 600,
                }}
              >
                Cancel job
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
