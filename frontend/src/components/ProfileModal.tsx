interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ProfileModal({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-neutral-100 font-semibold text-lg mb-2">Encoder Profiles</h2>
        <p className="text-neutral-500 text-sm mb-4">Profile management will be available in a future update.</p>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
