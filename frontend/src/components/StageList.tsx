import { StageData } from '../types';

const ALL_STAGES = [
  'ffv1_encode', 'scene_detect', 'chunk_split', 'audio_transcode',
  'chunk_encode', 'merge', 'mux', 'cleanup',
];

const STAGE_LABELS: Record<string, string> = {
  ffv1_encode: 'FFV1 encode',
  scene_detect: 'Scene detect',
  chunk_split: 'Chunk split',
  audio_transcode: 'Audio transcode',
  chunk_encode: 'Chunk encode',
  merge: 'Merge',
  mux: 'Mux',
  cleanup: 'Cleanup',
};

interface Props {
  stages: StageData[];
  currentStage: string | null;
  totalChunks?: number | null;
}

export default function StageList({ stages, currentStage, totalChunks }: Props) {
  const completedNames = new Set(stages.filter(s => s.completedAt).map(s => s.name));

  return (
    <ol className="space-y-1">
      {ALL_STAGES.map((name) => {
        const isDone = completedNames.has(name);
        const isActive = name === currentStage;
        const isPending = !isDone && !isActive;
        const label = STAGE_LABELS[name] ?? name;
        const stageData = stages.find(s => s.name === name);
        const durationSec = stageData?.completedAt && stageData?.startedAt
          ? ((new Date(stageData.completedAt).getTime() - new Date(stageData.startedAt).getTime()) / 1000).toFixed(1) + 's'
          : null;

        return (
          <li key={name} className={`flex items-center gap-2 text-sm ${isPending ? 'text-neutral-600' : isDone ? 'text-neutral-400' : 'text-neutral-100'}`}>
            <span className="w-4 text-center">
              {isDone ? '✔' : isActive ? '▶' : '○'}
            </span>
            <span>
              {label}
              {name === 'chunk_encode' && totalChunks && !isDone && (
                <span className="text-neutral-500 text-xs ml-1">
                  {stages.filter(s => s.name.startsWith('chunk_encode')).length}/{totalChunks}
                </span>
              )}
            </span>
            {durationSec && <span className="ml-auto text-xs text-neutral-600">{durationSec}</span>}
          </li>
        );
      })}
    </ol>
  );
}
