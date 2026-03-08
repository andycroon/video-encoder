import type { StageData } from '../types';

const ALL_STAGES = [
  'ffv1_encode', 'scene_detect', 'chunk_split', 'audio_transcode',
  'chunk_encode', 'merge', 'mux', 'cleanup',
];

const STAGE_LABELS: Record<string, string> = {
  ffv1_encode:     'FFV1 Encode',
  scene_detect:    'Scene Detect',
  chunk_split:     'Chunk Split',
  audio_transcode: 'Audio Transcode',
  chunk_encode:    'Chunk Encode',
  merge:           'Merge',
  mux:             'Mux',
  cleanup:         'Cleanup',
};

interface Props {
  stages: StageData[];
  currentStage: string | null;
  totalChunks?: number | null;
}

export default function StageList({ stages, currentStage, totalChunks }: Props) {
  const completedNames = new Set(stages.filter(s => s.completedAt).map(s => s.name));

  return (
    <ol className="space-y-0">
      {ALL_STAGES.map((name, idx) => {
        const isDone = completedNames.has(name);
        const isActive = name === currentStage;

        const stageData = stages.find(s => s.name === name);
        const durationSec = stageData?.completedAt && stageData?.startedAt
          ? ((new Date(stageData.completedAt).getTime() - new Date(stageData.startedAt).getTime()) / 1000).toFixed(1) + 's'
          : null;

        return (
          <li
            key={name}
            className="flex items-center gap-3 py-1"
          >
            {/* Step number / indicator */}
            <span
              className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 text-xs font-mono font-medium"
              style={
                isDone
                  ? { background: '#0f2e22', color: '#10b981', border: '1px solid #1a5c3e' }
                  : isActive
                  ? { background: '#1a2540', color: '#3b82f6', border: '1px solid #2d4a8a' }
                  : { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' }
              }
            >
              {isDone ? (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5l2.5 2.5 3.5-4" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : isActive ? (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-400" />
                </span>
              ) : (
                idx + 1
              )}
            </span>

            {/* Label */}
            <span
              className="flex-1 text-xs font-medium"
              style={{
                color: isDone ? '#6ee7b7' : isActive ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {STAGE_LABELS[name] ?? name}
              {name === 'chunk_encode' && totalChunks && !isDone && (
                <span className="ml-2 font-mono" style={{ color: 'var(--text-muted)' }}>
                  {stages.filter(s => s.name === 'chunk_encode').length}/{totalChunks}
                </span>
              )}
            </span>

            {/* Duration */}
            {durationSec && (
              <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                {durationSec}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
