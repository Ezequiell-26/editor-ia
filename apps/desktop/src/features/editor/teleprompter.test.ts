import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { addScene } from '../../state/project-actions';
import {
  TELEPROMPTER_DEFAULT_PREFS,
  TELEPROMPTER_DEFAULT_WPM,
  TELEPROMPTER_MAX_WPM,
  TELEPROMPTER_MIN_WPM,
  TELEPROMPTER_PREFS_STORAGE_KEY,
  TELEPROMPTER_SCRIPT_STORAGE_PREFIX,
  clampTeleprompterFontSize,
  clampTeleprompterWpm,
  countTeleprompterWords,
  loadTeleprompterPrefs,
  loadTeleprompterScript,
  saveTeleprompterPrefs,
  saveTeleprompterScript,
  scriptFromProject,
  splitTeleprompterLines,
  teleprompterLineAt,
  teleprompterLineDurationMs,
  teleprompterScriptStorageKey,
  teleprompterTotalDurationMs,
  type TeleprompterStorage,
} from './teleprompter';

function fakeStorage(initial: Record<string, string> = {}): TeleprompterStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('splitTeleprompterLines', () => {
  it('parte por renglón y descarta vacíos', () => {
    expect(splitTeleprompterLines('uno\n\ndos  \r\ntres')).toEqual(['uno', 'dos', 'tres']);
  });

  it('normaliza CRLF y CR sueltos', () => {
    expect(splitTeleprompterLines('a\r\nb\rc')).toEqual(['a', 'b', 'c']);
  });

  it('devuelve vacío para texto vacío o sólo espacios', () => {
    expect(splitTeleprompterLines('')).toEqual([]);
    expect(splitTeleprompterLines('  \n \n')).toEqual([]);
  });
});

describe('duraciones por WPM', () => {
  it('una línea de 10 palabras a 120 wpm dura 5 s', () => {
    expect(teleprompterLineDurationMs('uno dos tres cuatro cinco seis siete ocho nueve diez', 120)).toBe(5_000);
  });

  it('cuenta palabras separadas por espacios', () => {
    expect(countTeleprompterWords('hola   mundo\t de nuevo')).toBe(4);
    expect(countTeleprompterWords('   ')).toBe(0);
  });

  it('clampea el WPM al rango válido', () => {
    expect(clampTeleprompterWpm(10)).toBe(TELEPROMPTER_MIN_WPM);
    expect(clampTeleprompterWpm(999)).toBe(TELEPROMPTER_MAX_WPM);
    expect(clampTeleprompterWpm(Number.NaN)).toBe(TELEPROMPTER_DEFAULT_WPM);
    expect(teleprompterLineDurationMs('a b', 10)).toBe(
      teleprompterLineDurationMs('a b', TELEPROMPTER_MIN_WPM),
    );
  });

  it('suma la duración total', () => {
    expect(teleprompterTotalDurationMs([100, 250, 150])).toBe(500);
    expect(teleprompterTotalDurationMs([])).toBe(0);
  });
});

describe('teleprompterLineAt', () => {
  const durations = [1_000, 2_000, 1_000];

  it('devuelve la línea que contiene el tiempo transcurrido', () => {
    expect(teleprompterLineAt(0, durations)).toBe(0);
    expect(teleprompterLineAt(999, durations)).toBe(0);
    expect(teleprompterLineAt(1_000, durations)).toBe(1);
    expect(teleprompterLineAt(2_500, durations)).toBe(1);
    expect(teleprompterLineAt(3_500, durations)).toBe(2);
  });

  it('devuelve el largo cuando se pasó del final', () => {
    expect(teleprompterLineAt(4_000, durations)).toBe(3);
    expect(teleprompterLineAt(10_000, durations)).toBe(3);
  });

  it('sin líneas devuelve 0', () => {
    expect(teleprompterLineAt(500, [])).toBe(0);
  });
});

describe('persistencia', () => {
  it('guarda el guion por proyecto y una clave compartida sin proyecto', () => {
    const storage = fakeStorage();
    saveTeleprompterScript(storage, 'hola', 'proj-1');
    saveTeleprompterScript(storage, 'chau', null);
    expect(loadTeleprompterScript(storage, 'proj-1')).toBe('hola');
    expect(loadTeleprompterScript(storage, null)).toBe('chau');
    expect(loadTeleprompterScript(storage, 'otro')).toBe('');
    expect(teleprompterScriptStorageKey('proj-1')).toBe(
      `${TELEPROMPTER_SCRIPT_STORAGE_PREFIX}proj-1`,
    );
  });

  it('las preferencias se guardan clampeadas y se leen con defaults', () => {
    const storage = fakeStorage();
    expect(loadTeleprompterPrefs(storage)).toEqual(TELEPROMPTER_DEFAULT_PREFS);
    saveTeleprompterPrefs(storage, { wpm: 5, fontSize: 200, wrap: false });
    const prefs = loadTeleprompterPrefs(storage);
    expect(prefs.wpm).toBe(TELEPROMPTER_MIN_WPM);
    expect(prefs.fontSize).toBe(64);
    expect(prefs.wrap).toBe(false);
    expect(storage.data.get(TELEPROMPTER_PREFS_STORAGE_KEY)).toContain('"wpm"');
  });

  it('prefs corruptas caen a defaults', () => {
    const storage = fakeStorage({ [TELEPROMPTER_PREFS_STORAGE_KEY]: '{no-json' });
    expect(loadTeleprompterPrefs(storage)).toEqual(TELEPROMPTER_DEFAULT_PREFS);
  });
});

describe('scriptFromProject', () => {
  it('junta la narración de las escenas en orden', () => {
    const project = createEmptyProject('Demo', '2026-01-01T00:00:00.000Z');
    const first = addScene(project, { title: 'A', intent: 'explainer', narration: 'primera' });
    const final = addScene(first.project, {
      title: 'B',
      intent: 'explainer',
      narration: 'segunda',
    });
    expect(scriptFromProject(final.project)).toBe('primera\n\nsegunda');
  });

  it('devuelve vacío sin proyecto o sin escenas con narración', () => {
    const project = createEmptyProject('Demo', '2026-01-01T00:00:00.000Z');
    expect(scriptFromProject(project)).toBe('');
    expect(scriptFromProject(null)).toBe('');
    expect(scriptFromProject(undefined)).toBe('');
  });
});

describe('clampTeleprompterFontSize', () => {
  it('mantiene el tamaño dentro del rango', () => {
    expect(clampTeleprompterFontSize(10)).toBe(20);
    expect(clampTeleprompterFontSize(500)).toBe(64);
    expect(clampTeleprompterFontSize(30)).toBe(30);
  });
});
