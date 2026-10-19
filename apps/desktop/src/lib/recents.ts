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

export function loadRecents(): RecentProject[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
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
  } catch {
    return [];
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
