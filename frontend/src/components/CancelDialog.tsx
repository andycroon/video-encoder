import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { cancelJob } from '../api/jobs';

interface Props {
  jobId: number;
  onCancelled: () => void;
}

export default function CancelDialog({ jobId, onCancelled }: Props) {
  const handleConfirm = async () => {
    await cancelJob(jobId);
    onCancelled();
  };
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button className="px-2 py-1 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/70">
          Cancel
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 bg-black/60 z-40" />
        <AlertDialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-neutral-900 border border-neutral-700 rounded-lg p-6 w-96"
          role="alertdialog"
        >
          <AlertDialog.Title className="text-neutral-100 font-semibold mb-2">
            Cancel encoding job?
          </AlertDialog.Title>
          <AlertDialog.Description className="text-neutral-400 text-sm mb-4">
            ffmpeg will be stopped and temp files cleaned up.
          </AlertDialog.Description>
          <div className="flex gap-3 justify-end">
            <AlertDialog.Cancel asChild>
              <button className="px-4 py-2 text-sm rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700">
                Keep running
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                onClick={handleConfirm}
                className="px-4 py-2 text-sm rounded bg-red-700 text-white hover:bg-red-600"
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
