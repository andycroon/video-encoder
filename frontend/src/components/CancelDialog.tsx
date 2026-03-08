import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { cancelJob } from '../api/jobs';

interface Props { jobId: number; onCancelled: () => void; }

export default function CancelDialog({ jobId, onCancelled }: Props) {
  const handleConfirm = async () => {
    await cancelJob(jobId);
    onCancelled();
  };

  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button
          className="px-2 py-0.5 text-xs rounded transition-colors"
          style={{ color: '#fca5a5', background: '#2a1515', border: '1px solid #7c232340' }}
        >
          Cancel
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 bg-black/75 z-40" />
        <AlertDialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 z-50 rounded shadow-2xl p-5"
          style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
          role="alertdialog"
        >
          <div className="flex items-start gap-3 mb-4">
            <div
              className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
              style={{ background: '#2a1515', border: '1px solid #7c2323' }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2v5M7 10v.5" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <AlertDialog.Title className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                Cancel encoding job?
              </AlertDialog.Title>
              <AlertDialog.Description className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                ffmpeg will be terminated and temp files cleaned up.
              </AlertDialog.Description>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <AlertDialog.Cancel asChild>
              <button
                className="px-4 py-1.5 text-xs rounded transition-colors"
                style={{ color: 'var(--text-secondary)', background: 'var(--bg-panel)', border: '1px solid var(--border)' }}
              >
                Keep running
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                onClick={handleConfirm}
                className="px-4 py-1.5 text-xs font-semibold rounded transition-colors"
                style={{ color: 'white', background: '#b91c1c', border: '1px solid #991b1b' }}
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
