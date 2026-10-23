import type { Clip } from '@editor-ia/project-schema';

export type AudioPresetId = 'voice' | 'music';

export const AUDIO_PRESETS: readonly {
  readonly id: AudioPresetId;
  readonly label: string;
  readonly settings: Partial<NonNullable<Clip['audio']>>;
}[] = [
  {
    id: 'voice',
    label: 'Voz clara',
    settings: {
      highPassHz: 90,
      lowPassHz: 12_000,
      eqMidDb: 2,
      compressor: true,
      deesser: true,
      denoise: 0.12,
      gateDb: -40,
      voiceEffect: undefined,
    },
  },
  {
    id: 'music',
    label: 'Música',
    settings: {
      highPassHz: 35,
      lowPassHz: 18_000,
      eqLowDb: 1,
      compressor: false,
      denoise: 0,
      voiceEffect: undefined,
    },
  },
];
