import type { StageData } from '../types';

const ALL_STAGES = [
  'subtitle_extract', 'ffv1_encode', 'scene_detect', 'chunk_split', 'audio_transcode',
  'chunk_encode', 'merge', 'mux', 'cleanup',
];

import { STAGE_LABELS } from '../constants/stageLabels';

interface Props {
  stages: StageData[];
  currentStage: string | null;
  totalChunks?: number | null;
  completedChunks?: number;
}

export default function StageList({ stages, currentStage, totalChunks, completedChunks = 0 }: Props) {
  const completedNames = new Set(stages.filter(s => s.completedAt).map(s => s.name));

  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {ALL_STAGES.map((name, idx) => {
        const isDone   = completedNames.has(name);
        const isActive = name === currentStage;

        const stageData = stages.find(s => s.name === name);
        const dur = stageData?.completedAt && stageData?.startedAt
          ? ((new Date(stageData.completedAt).getTime() - new Date(stageData.startedAt).getTime()) / 1000).toFixed(1) + 's'
          : null;

        return (
          <li
            key={name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '5px 0',
              opacity: 1,
            }}
          >
            {/* Step indicator */}
            <div style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 600,
              background: isDone ? '#0d2318' : isActive ? '#172035' : 'var(--raised)',
              border: `1px solid ${isDone ? '#166534' : isActive ? '#2563eb' : 'var(--border)'}`,
              color: isDone ? '#22c55e' : isActive ? '#93c5fd' : 'var(--txt-3)',
              position: 'relative',
            }}>
              {isDone ? (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5.5L4 7.5L8 3" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : isActive ? (
                <span style={{ position: 'relative', display: 'inline-flex', width: 7, height: 7 }}>
                  <span style={{
                    position: 'absolute', inset: 0, borderRadius: '50%',
                    background: '#f59e0b', opacity: 0.7,
                    animation: 'ping 1.2s cubic-bezier(0,0,0.2,1) infinite',
                  }} />
                  <span style={{ position: 'relative', borderRadius: '50%', width: 7, height: 7, background: '#f59e0b', display: 'inline-flex' }} />
                  <style>{`@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }`}</style>
                </span>
              ) : (
                idx + 1
              )}
            </div>

            {/* Label */}
            <span style={{
              flex: 1,
              fontSize: 13,
              color: isDone ? 'var(--txt-2)' : isActive ? 'var(--txt)' : 'var(--txt-3)',
              fontWeight: isActive ? 500 : 400,
            }}>
              {STAGE_LABELS[name] ?? name}
              {name === 'chunk_encode' && totalChunks && !isDone && (
                <span className="mono" style={{ fontSize: 11, color: 'var(--txt-3)', marginLeft: 8 }}>
                  {completedChunks}/{totalChunks}
                </span>
              )}
            </span>

            {/* Duration */}
            {dur && (
              <span className="mono" style={{ fontSize: 11, color: 'var(--txt-3)', flexShrink: 0 }}>
                {dur}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
