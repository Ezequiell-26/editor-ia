/**
 * Updater Service for Olyvia / Montaje Desktop.
 * Manages checking for releases, downloading simulation/payloads,
 * local update preferences, and auto-check policies.
 */

export interface ReleaseInfo {
  readonly version: string;
  readonly releaseDate: string;
  readonly title: string;
  readonly highlights: readonly string[];
  readonly downloadBytes: number;
  readonly channel: 'stable' | 'beta';
  readonly mandatory: boolean;
}

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'up-to-date'
  | 'error';

export interface UpdaterState {
  readonly currentVersion: string;
  readonly status: UpdaterStatus;
  readonly release: ReleaseInfo | null;
  readonly progress: number; // 0 - 100
  readonly downloadSpeed: string;
  readonly error: string | null;
  readonly lastChecked: string | null;
  readonly autoCheck: boolean;
  readonly channel: 'stable' | 'beta';
}

const STORAGE_KEY = 'editoria.updater.config.v1';
export const CURRENT_APP_VERSION = '0.1.0';

/**
 * Mock latest releases for update checks.
 * In a production distribution with a remote manifest endpoint, this queries GitHub API
 * or a static S3/R2 JSON manifest.
 */
export const AVAILABLE_RELEASES: Record<'stable' | 'beta', ReleaseInfo> = {
  stable: {
    version: '0.2.0',
    releaseDate: '22 de Octubre, 2026',
    title: 'Actualización Mayor · Motor de Video IA & Rendimiento',
    highlights: [
      '🚀 Exportación acelerada por GPU hasta 4.2x más rápida con NVENC y QuickSync.',
      '🎬 Lanzador de inicio renovado con plantillas rápidas y arrastrar medios.',
      '🧽 Modelo de eliminación de fondo ONNX v2 con mayor precisión en bordes.',
      '🎙️ Síntesis de voz mejorada con modulación de tono y velocidad en tiempo real.',
      '✨ Corrección de subtítulos y sincronización automática de ritmo musical.',
    ],
    downloadBytes: 67_108_864, // 64 MB
    channel: 'stable',
    mandatory: false,
  },
  beta: {
    version: '0.3.0-beta.1',
    releaseDate: '22 de Octubre, 2026',
    title: 'Beta 0.3.0 · Smart Reframe & Generación de Efectos',
    highlights: [
      '🔮 Detección facial neuronal en vivo para encuadre automático 9:16.',
      '⚡ Generador de variantes por lotes (Batch Factory) ultra optimizado.',
      '🎨 Nuevos filtros LUT cinemáticos integrados en el inspector.',
    ],
    downloadBytes: 71_303_168, // 68 MB
    channel: 'beta',
    mandatory: false,
  },
};

/**
 * Compare two semver strings (e.g. "0.1.0" and "0.2.0").
 * Returns:
 *   - negative number if a < b (b is newer)
 *   - positive number if a > b (a is newer)
 *   - 0 if equal
 */
export function compareSemver(a: string, b: string): number {
  const cleanA = a.replace(/^[vV]/, '').split('-')[0] ?? '0.0.0';
  const cleanB = b.replace(/^[vV]/, '').split('-')[0] ?? '0.0.0';

  const partsA = cleanA.split('.').map((n) => parseInt(n, 10) || 0);
  const partsB = cleanB.split('.').map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < 3; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA !== numB) return numA - numB;
  }

  // If base versions are equal, non-prerelease is newer than prerelease
  const isPreA = a.includes('-');
  const isPreB = b.includes('-');
  if (isPreA && !isPreB) return -1;
  if (!isPreA && isPreB) return 1;

  return 0;
}

export function loadUpdaterConfig(): { autoCheck: boolean; channel: 'stable' | 'beta'; lastChecked: string | null } {
  try {
    if (typeof window === 'undefined') return { autoCheck: true, channel: 'stable', lastChecked: null };
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { autoCheck: true, channel: 'stable', lastChecked: null };
    const parsed = JSON.parse(raw) as Partial<UpdaterState>;
    return {
      autoCheck: parsed.autoCheck ?? true,
      channel: parsed.channel === 'beta' ? 'beta' : 'stable',
      lastChecked: parsed.lastChecked ?? null,
    };
  } catch {
    return { autoCheck: true, channel: 'stable', lastChecked: null };
  }
}

export function saveUpdaterConfig(config: { autoCheck: boolean; channel: 'stable' | 'beta'; lastChecked?: string | null }) {
  try {
    if (typeof window === 'undefined') return;
    const prev = loadUpdaterConfig();
    const updated = {
      autoCheck: config.autoCheck,
      channel: config.channel,
      lastChecked: config.lastChecked ?? prev.lastChecked,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // LocalStorage quota or access denied ignored
  }
}

/**
 * Checks for updates against the specified channel.
 */
export async function checkForUpdates(channel: 'stable' | 'beta' = 'stable'): Promise<{
  readonly available: boolean;
  readonly release: ReleaseInfo | null;
}> {
  // Simulate network check latency
  await new Promise((resolve) => setTimeout(resolve, 800));

  const candidate = AVAILABLE_RELEASES[channel];
  const isNewer = compareSemver(CURRENT_APP_VERSION, candidate.version) < 0;

  saveUpdaterConfig({
    ...loadUpdaterConfig(),
    channel,
    lastChecked: new Date().toISOString(),
  });

  if (isNewer) {
    return { available: true, release: candidate };
  }
  return { available: false, release: null };
}
