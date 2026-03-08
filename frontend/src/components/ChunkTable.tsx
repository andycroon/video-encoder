import type { ChunkData } from '../types';

interface Props { chunks: ChunkData[] }

export default function ChunkTable({ chunks }: Props) {
  if (chunks.length === 0) {
    return <div className="text-neutral-600 text-xs italic">Chunk data will appear here during encoding</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-left">
        <thead>
          <tr className="text-neutral-500 border-b border-neutral-800">
            <th className="pb-2 pr-4 font-medium">Chunk</th>
            <th className="pb-2 pr-4 font-medium">CRF</th>
            <th className="pb-2 pr-4 font-medium">VMAF</th>
            <th className="pb-2 font-medium">Passes</th>
          </tr>
        </thead>
        <tbody>
          {chunks.map((c, idx) => (
            <tr
              key={c.chunkIndex}
              className={`border-b border-neutral-800/30 ${idx % 2 === 1 ? 'bg-white/[0.02]' : ''}`}
            >
              <td className="py-1.5 pr-4 text-neutral-300 font-mono">{c.chunkIndex + 1}</td>
              <td className="py-1.5 pr-4 text-neutral-300 font-mono">{c.crf ?? '--'}</td>
              <td className="py-1.5 pr-4 font-mono">
                {c.vmaf !== null ? (
                  <span className="text-emerald-400">{c.vmaf.toFixed(2)}</span>
                ) : (
                  <span className="text-neutral-600 animate-pulse">--</span>
                )}
              </td>
              <td className="py-1.5 text-neutral-400 font-mono">{c.passes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
