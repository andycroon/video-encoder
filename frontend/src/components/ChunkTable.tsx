import { useRef, useEffect } from 'react';
import type { ChunkData } from '../types';

interface Props { chunks: ChunkData[] }

function vmafColor(v: number): string {
  if (v >= 96) return '#22c55e';
  if (v >= 93) return '#f59e0b';
  return '#ef4444';
}

function passColor(passes: number): string {
  if (passes <= 1) return '#22c55e';
  if (passes <= 3) return '#f59e0b';
  return '#ef4444';
}

const th: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--txt-3)',
  textAlign: 'left',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg)',
  position: 'sticky',
  top: 0,
};

export default function ChunkTable({ chunks }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chunks.length]);
  if (chunks.length === 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 80,
        border: '1px solid var(--border-lo)',
        borderRadius: 6,
        fontSize: 12,
        color: 'var(--txt-3)',
      }}>
        Waiting for chunk data…
      </div>
    );
  }

  return (
    <div ref={scrollRef} style={{
      maxHeight: 220,
      overflowY: 'auto',
      border: '1px solid var(--border)',
      borderRadius: 6,
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={th}>#</th>
            <th style={th}>CRF</th>
            <th style={th}>VMAF</th>
            <th style={th}>Passes</th>
          </tr>
        </thead>
        <tbody>
          {chunks.map((c, i) => (
            <tr
              key={c.chunkIndex}
              style={{ background: i % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent' }}
            >
              <td className="mono" style={{ padding: '7px 12px', color: 'var(--txt-3)' }}>{c.chunkIndex + 1}</td>
              <td className="mono" style={{ padding: '7px 12px', color: 'var(--txt-2)' }}>{c.crf ?? '--'}</td>
              <td className="mono" style={{ padding: '7px 12px', fontWeight: 500 }}>
                {c.vmaf != null
                  ? <span style={{ color: vmafColor(c.vmaf) }}>{c.vmaf.toFixed(2)}</span>
                  : <span style={{ color: 'var(--txt-3)' }}>--</span>
                }
              </td>
              <td style={{ padding: '7px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 60,
                    height: 6,
                    borderRadius: 3,
                    background: 'rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${Math.min((c.passes / 10) * 100, 100)}%`,
                      height: '100%',
                      borderRadius: 3,
                      background: passColor(c.passes),
                    }} />
                  </div>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                    {c.passes}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
