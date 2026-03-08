import { useState } from 'react';
import ScrollToBottom from 'react-scroll-to-bottom';

interface Props { log: string }

export default function LogPanel({ log }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-neutral-800 mt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-4 py-2 text-xs text-neutral-500 hover:text-neutral-300 flex items-center gap-1"
        aria-label={open ? 'Hide ffmpeg log' : 'Show ffmpeg log'}
      >
        {open ? 'Hide ffmpeg log ▴' : 'Show ffmpeg log ▾'}
      </button>
      {open && (
        <ScrollToBottom className="h-72 font-mono text-xs bg-neutral-950 px-3 pb-3 overflow-y-auto">
          <pre className="whitespace-pre-wrap text-neutral-400">{log || '(no log yet)'}</pre>
        </ScrollToBottom>
      )}
    </div>
  );
}
