import { useState } from 'react';
import ScrollToBottom from 'react-scroll-to-bottom';

interface Props { log: string }

export default function LogPanel({ log }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Hide ffmpeg log' : 'Show ffmpeg log'}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 20px',
          background: 'transparent',
          border: 'none',
          borderTop: '1px solid var(--border-lo)',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--txt-3)',
          textAlign: 'left',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--txt-2)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--txt-3)')}
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}
        >
          <path d="M3 2l4 3-4 3V2Z" fill="currentColor" />
        </svg>
        ffmpeg log
        {log && (
          <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--txt-3)', letterSpacing: 0, textTransform: 'none', fontWeight: 400 }}>
            {log.split('\n').length} lines
          </span>
        )}
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border-lo)', background: '#060608', height: 260, overflow: 'hidden' }}>
          <ScrollToBottom className="mono h-full">
            <pre style={{
              margin: 0,
              padding: '14px 20px',
              fontSize: 12,
              lineHeight: 1.7,
              color: '#4ade80',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {log || '— no output yet —'}
            </pre>
          </ScrollToBottom>
        </div>
      )}
    </div>
  );
}
