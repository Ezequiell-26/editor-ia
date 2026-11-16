import { VIDEO_EFFECTS } from './video.ts';
import { TRANSITIONS } from './transitions.ts';
import { AUDIO_EFFECTS } from './audio.ts';
import { CONCAT_AUDIO_EFFECTS } from './concat-audio.ts';

export const ALL_EFFECTS = [
  ...VIDEO_EFFECTS,
  ...TRANSITIONS,
  ...AUDIO_EFFECTS,
  ...CONCAT_AUDIO_EFFECTS,
];
