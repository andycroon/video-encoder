import { useState } from 'react';
import ScrollToBottom from 'react-scroll-to-bottom';

interface Props { log: string }

export default function LogPanel({ log }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs transition-colors hover:bg-white/[0.02]"
        style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border-sub)' }}
        aria-label={open ? 'Hide ffmpeg log' : 'Show ffmpeg log'}
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
        >
          <path d="M3 2l4 3-4 3V2Z" fill="currentColor"/>
        </svg>
        <span className="uppercase tracking-widest font-medium" style={{ fontSize: '10px' }}>
          ffmpeg log
        </span>
        {log && (
          <span className="ml-auto font-mono" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {log.split('\n').length} lines
          </span>
        )}
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border-sub)' }}>
      <ScrollToBottom className="h-64 font-mono text-xs pb-2 bg-[#050508]">
          <pre
            className="px-4 py-3 whitespace-pre-wrap leading-relaxed"
            style={{ color: '#4ade80', opacity: 0.85 }}
          >
            {log || '— no output yet —'}
          </pre>
        </ScrollToBottom>
      </div>
      )}
    </div>
  );
}
