import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
} from 'recharts';
import type { ChunkData } from '../types';

interface Props {
  chunks: ChunkData[];
  vmafMin: number;
  vmafMax: number;
}

const sectionHead: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--txt-3)',
  marginBottom: 14,
};

export default function VmafChart({ chunks, vmafMin, vmafMax }: Props) {
  const completedChunks = chunks.filter(c => c.vmaf !== null);

  if (completedChunks.length === 0) {
    return null;
  }

  const data = completedChunks.map(c => ({
    chunk: c.chunkIndex + 1,
    vmaf: c.vmaf as number,
  }));

  const yMin = Math.max(88, vmafMin - 2);
  const yMax = Math.min(100, vmafMax + 2);

  return (
    <div style={{
      padding: '20px 24px',
      borderBottom: '1px solid var(--border-lo)',
    }}>
      <p style={sectionHead}>VMAF</p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
          <ReferenceArea y1={vmafMin} y2={vmafMax} fill="#4080ff20" strokeOpacity={0} />
          <XAxis
            dataKey="chunk"
            tick={{ fontSize: 11, fill: 'var(--txt-3)' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[yMin, yMax]}
            ticks={[vmafMin, vmafMax]}
            tick={{ fontSize: 11, fill: 'var(--txt-3)' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--raised)',
              border: '1px solid var(--border)',
              fontSize: 12,
              borderRadius: 6,
            }}
            labelFormatter={(v) => `Chunk ${v}`}
            formatter={(v) => [typeof v === 'number' ? v.toFixed(2) : v, 'VMAF']}
          />
          <Line
            type="monotone"
            dataKey="vmaf"
            stroke="#4080ff"
            strokeWidth={2}
            dot={{ r: 3, fill: '#4080ff' }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
