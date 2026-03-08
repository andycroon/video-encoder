import { useState } from 'react';
import ScrollToBottom from 'react-scroll-to-bottom';

interface Props { log: string }

export default function LogPanel({ log }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-neutral-800 mt-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-4 py-2 text-xs text-neutral-600 hover:text-neutral-400 flex items-center gap-1 transition-colors"
        aria-label={open ? 'Hide ffmpeg log' : 'Show ffmpeg log'}
      >
        <span className="mr-1">{open ? '▴' : '▾'}</span>
        {open ? 'Hide ffmpeg log' : 'Show ffmpeg log'}
      </button>
      {open && (
        <ScrollToBottom className="h-72 font-mono text-xs px-3 pb-3 overflow-y-auto" style={{ background: '#0a0a0a' }}>
          <pre className="whitespace-pre-wrap text-neutral-400 leading-relaxed">{log || '(no log yet)'}</pre>
        </ScrollToBottom>
      )}
    </div>
  );
}
