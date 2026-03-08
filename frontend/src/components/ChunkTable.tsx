import type { ChunkData } from '../types';

interface Props { chunks: ChunkData[] }

function vmafColor(v: number): string {
  if (v >= 96) return '#10b981';
  if (v >= 93) return '#f59e0b';
  return '#ef4444';
}

export default function ChunkTable({ chunks }: Props) {
  if (chunks.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-xs font-mono rounded" style={{ color: 'var(--text-muted)', background: 'var(--bg-base)', border: '1px solid var(--border-sub)' }}>
        Waiting for chunk data…
      </div>
    );
  }

  return (
    <div className="overflow-y-auto rounded" style={{ maxHeight: '220px', border: '1px solid var(--border-sub)' }}>
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <thead className="sticky top-0" style={{ background: 'var(--bg-raised)' }}>
          <tr>
            {['#', 'CRF', 'VMAF', 'Passes'].map(h => (
              <th
                key={h}
                className="px-3 py-1.5 text-left font-medium uppercase tracking-wider"
                style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', fontSize: '10px' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chunks.map((c, idx) => (
            <tr
              key={c.chunkIndex}
              style={{
                background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <td className="px-3 py-1.5 font-mono" style={{ color: 'var(--text-muted)' }}>{c.chunkIndex + 1}</td>
              <td className="px-3 py-1.5 font-mono" style={{ color: 'var(--text-secondary)' }}>{c.crf ?? '—'}</td>
              <td className="px-3 py-1.5 font-mono font-medium">
                {c.vmaf !== null ? (
                  <span style={{ color: vmafColor(c.vmaf) }}>{c.vmaf.toFixed(2)}</span>
                ) : (
                  <span className="animate-pulse" style={{ color: 'var(--text-muted)' }}>--</span>
                )}
              </td>
              <td className="px-3 py-1.5 font-mono" style={{ color: c.passes > 1 ? '#fcd34d' : 'var(--text-muted)' }}>
                {c.passes}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
