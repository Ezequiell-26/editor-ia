import type { DenoisePreset } from '../../services/project-service';

export interface DenoisePresetOption {
  readonly id: DenoisePreset;
  readonly label: string;
  readonly detail: string;
  readonly badge: string;
}

export const DENOISE_PRESETS: readonly DenoisePresetOption[] = [
  {
    id: 'fast',
    label: 'Rápido',
    detail: 'hqdn3d · para revisar y para redes',
    badge: '0–10 s',
  },
  {
    id: 'balanced',
    label: 'Equilibrado',
    detail: 'hqdn3d + temporal · recomendado',
    badge: '10–60 s',
  },
  {
    id: 'quality',
    label: 'Máxima calidad',
    detail: 'nlmeans · lento, para archivo',
    badge: '1–10 min',
  },
];

export function clampDenoiseStrength(value: number): number {
  if (!Number.isFinite(value)) return 55;
  return Math.max(1, Math.min(100, Math.round(value)));
}

export function denoisePreset(id: DenoisePreset): DenoisePresetOption {
  return DENOISE_PRESETS.find((preset) => preset.id === id) ?? DENOISE_PRESETS[1]!;
}

export function denoiseFilterSummary(
  preset: DenoisePreset,
  strength: number,
  temporal: boolean,
  preserveDetail: boolean,
): string {
  const safeStrength = clampDenoiseStrength(strength);
  const parts = [denoisePreset(preset).label, `${safeStrength}%`];
  if (temporal && preset !== 'quality') parts.push('temporal');
  if (preserveDetail) parts.push('detalle');
  return parts.join(' · ');
}

export function formatDenoiseDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} min ${rest} s`;
}

export function formatDenoiseBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
