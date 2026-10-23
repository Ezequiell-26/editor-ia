import type { ViewId } from '../app/navigation';
import { NAV_VIEWS } from '../app/navigation';

const STORAGE_KEY = 'editor-ia.learning-progress.v2';
const LEGACY_KEY = 'editor-ia.learn-progress.v1';
export const LEARNING_UPDATED_EVENT = 'editor-ia:learning-updated';

const VIEW_IDS = new Set<ViewId>(NAV_VIEWS.map((view) => view.id));

/** Which tutorial cards are covered by using each tool. */
export const LEARNING_VIEW_SECTIONS: Partial<Record<ViewId, readonly string[]>> = {
  projects: ['project'],
  assets: ['assets'],
  script: ['script'],
  settings: ['voice'],
  production: ['automatic'],
  director: ['director'],
  editor: ['editor', 'export'],
  factory: ['factory'],
  download: ['download'],
  convert: ['convert'],
  mcp: ['mcp'],
  learn: ['shortcuts'],
};

export interface LearningState {
  readonly version: 2;
  readonly visits: Partial<Record<ViewId, number>>;
  readonly seen: readonly ViewId[];
  readonly completed: readonly string[];
  readonly lastView: ViewId | null;
  readonly updatedAt: string;
}

function isView(value: unknown): value is ViewId {
  return typeof value === 'string' && VIEW_IDS.has(value as ViewId);
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === 'string'))];
}

function uniqueViews(values: unknown): ViewId[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(isView))];
}

function normalizeVisits(value: unknown): Partial<Record<ViewId, number>> {
  if (!value || typeof value !== 'object') return {};
  const visits: Partial<Record<ViewId, number>> = {};
  for (const [key, count] of Object.entries(value)) {
    if (!isView(key) || typeof count !== 'number' || !Number.isFinite(count)) continue;
    visits[key] = Math.max(0, Math.min(99_999, Math.round(count)));
  }
  return visits;
}

export function normalizeLearningState(value: unknown): LearningState {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    version: 2,
    visits: normalizeVisits(raw.visits),
    seen: uniqueViews(raw.seen),
    completed: uniqueStrings(raw.completed),
    lastView: isView(raw.lastView) ? raw.lastView : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
  };
}

function emptyState(): LearningState {
  return {
    version: 2,
    visits: {},
    seen: [],
    completed: [],
    lastView: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function readLegacyCompleted(): string[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return uniqueStrings(parsed);
  } catch {
    return [];
  }
}

export function loadLearningState(): LearningState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed) {
      const state = normalizeLearningState(parsed);
      const legacy = readLegacyCompleted();
      if (legacy.length === 0) return state;
      return {
        ...state,
        completed: [...new Set([...state.completed, ...legacy])],
      };
    }
    return { ...emptyState(), completed: readLegacyCompleted() };
  } catch {
    return emptyState();
  }
}

function persist(state: LearningState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.localStorage.removeItem(LEGACY_KEY);
    window.dispatchEvent(new CustomEvent(LEARNING_UPDATED_EVENT, { detail: state }));
  } catch {
    // Progress is a convenience; the tutorial keeps working without storage.
  }
}

export function recordViewVisit(
  view: ViewId,
  now: string = new Date().toISOString(),
): LearningState {
  const current = loadLearningState();
  const visits = { ...current.visits, [view]: (current.visits[view] ?? 0) + 1 };
  const seen = current.seen.includes(view) ? [...current.seen] : [...current.seen, view];
  const autoSections = LEARNING_VIEW_SECTIONS[view] ?? [];
  const completed = [...new Set([...current.completed, ...autoSections])];
  const next: LearningState = {
    ...current,
    visits,
    seen,
    completed,
    lastView: view,
    updatedAt: now,
  };
  persist(next);
  return next;
}

export function setSectionCompleted(
  sectionId: string,
  completed: boolean,
  now: string = new Date().toISOString(),
): LearningState {
  const current = loadLearningState();
  const values = new Set(current.completed);
  if (completed) values.add(sectionId);
  else values.delete(sectionId);
  const next: LearningState = {
    ...current,
    completed: [...values],
    updatedAt: now,
  };
  persist(next);
  return next;
}
