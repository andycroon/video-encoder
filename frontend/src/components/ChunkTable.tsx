import { ChunkData } from '../types';

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
            <th className="pb-2 pr-4">Chunk</th>
            <th className="pb-2 pr-4">CRF</th>
            <th className="pb-2 pr-4">VMAF</th>
            <th className="pb-2">Passes</th>
          </tr>
        </thead>
        <tbody>
          {chunks.map(c => (
            <tr key={c.chunkIndex} className="border-b border-neutral-800/50">
              <td className="py-1 pr-4 text-neutral-300">{c.chunkIndex + 1}</td>
              <td className="py-1 pr-4 text-neutral-300">{c.crf ?? '--'}</td>
              <td className="py-1 pr-4 text-neutral-300">
                {c.vmaf !== null ? c.vmaf.toFixed(2) : (
                  <span className="text-neutral-600 animate-pulse">--</span>
                )}
              </td>
              <td className="py-1 text-neutral-400">{c.passes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
