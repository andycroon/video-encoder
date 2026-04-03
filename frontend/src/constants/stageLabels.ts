export const STAGE_LABELS: Record<string, string> = {
  ffv1_encode:     'Creating Intermediate',
  scene_detect:    'Detecting Scenes',
  chunk_split:     'Splitting into Chunks',
  audio_transcode:  'Transcoding Audio',
  subtitle_extract: 'Extracting Subtitles',
  chunk_encode:     'Encoding Chunks',
  merge:           'Merging Chunks',
  mux:             'Writing Output File',
  cleanup:         'Cleaning Up',
};
