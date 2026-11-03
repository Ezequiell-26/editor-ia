import type { OpenedProject } from '../services/project-service';

export interface RecentProject {
  readonly path: string;
  readonly label: string;
  readonly name: string;
  readonly openedAt: string;
}

const KEY = 'editoria.recent.v1';
const MAX = 12;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const INITIAL_DEMO_PROJECTS: readonly RecentProject[] = [
  {
    path: 'demo://reels-vertical',
    label: 'reels-tiktok-9-16.editoria.json',
    name: '🌟 Demo: TikTok / Reels 9:16 con Subtítulos y Música',
    openedAt: new Date().toISOString(),
  },
  {
    path: 'demo://youtube-tutorial',
    label: 'tutorial-youtube-16-9.editoria.json',
    name: '🎬 Demo: Tutorial YouTube 16:9 con Locución IA',
    openedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    path: 'demo://podcast-multicam',
    label: 'podcast-multicam-audio.editoria.json',
    name: '🎙️ Demo: Podcast & Multicámara con Mezcla de Audio',
    openedAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

export function loadRecents(): RecentProject[] {
  const store = storage();
  if (!store) return [...INITIAL_DEMO_PROJECTS];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [...INITIAL_DEMO_PROJECTS];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [...INITIAL_DEMO_PROJECTS];
    const loaded = parsed
      .filter((item): item is RecentProject => {
        if (!item || typeof item !== 'object') return false;
        const record = item as Record<string, unknown>;
        return (
          typeof record.path === 'string' &&
          typeof record.label === 'string' &&
          typeof record.name === 'string' &&
          typeof record.openedAt === 'string'
        );
      })
      .slice(0, MAX);
    return loaded.length > 0 ? loaded : [...INITIAL_DEMO_PROJECTS];
  } catch {
    return [...INITIAL_DEMO_PROJECTS];
  }
}

export function rememberRecent(opened: OpenedProject): RecentProject[] {
  const next: RecentProject[] = [
    {
      path: opened.path,
      label: opened.label,
      name: opened.project.name,
      openedAt: new Date().toISOString(),
    },
    ...loadRecents().filter((item) => item.path !== opened.path),
  ].slice(0, MAX);
  const store = storage();
  try {
    store?.setItem(KEY, JSON.stringify(next));
  } catch {
    // A full or disabled localStorage is not a project failure.
  }
  return next;
}

export function forgetRecent(path: string): RecentProject[] {
  const next = loadRecents().filter((item) => item.path !== path);
  const store = storage();
  try {
    store?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Ignore unavailable storage.
  }
  return next;
}
