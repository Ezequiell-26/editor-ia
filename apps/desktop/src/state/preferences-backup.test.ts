// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, loadAppearance, saveAppearance } from './appearance';
import {
  DEFAULT_EDITOR_PREFERENCES,
  loadEditorPreferences,
  saveEditorPreferences,
} from './editor-preferences';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUTS_STORAGE_KEY,
  loadShortcuts,
  saveShortcuts,
} from './shortcuts';
import {
  PREFERENCES_BUNDLE_KIND,
  PREFERENCES_BUNDLE_VERSION,
  applyPreferencesBundle,
  buildPreferencesBundle,
  importPreferencesFromText,
  parsePreferencesBundle,
  preferencesFileName,
  serializePreferencesBundle,
} from './preferences-backup';

beforeEach(() => {
  window.localStorage.clear();
});

describe('respaldo de preferencias', () => {
  it('reúne los tres bloques y los vuelve a leer sin pérdida', () => {
    saveAppearance({ ...DEFAULT_APPEARANCE, accent: '#ffab70', preset: 'custom' });
    saveEditorPreferences({ ...DEFAULT_EDITOR_PREFERENCES, defaultZoom: 1.6, loopPlayback: true });
    saveShortcuts({ ...DEFAULT_SHORTCUTS, 'file.save': 'Ctrl+Alt+S' });

    const bundle = buildPreferencesBundle(new Date('2026-10-22T13:00:00.000Z'));
    expect(bundle.kind).toBe(PREFERENCES_BUNDLE_KIND);
    expect(bundle.version).toBe(PREFERENCES_BUNDLE_VERSION);
    expect(bundle.exportedAt).toBe('2026-10-22T13:00:00.000Z');

    const parsed = parsePreferencesBundle(serializePreferencesBundle(bundle));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.bundle.appearance.accent).toBe('#ffab70');
    expect(parsed.bundle.appearance.preset).toBe('custom');
    expect(parsed.bundle.editor.defaultZoom).toBe(1.6);
    expect(parsed.bundle.editor.loopPlayback).toBe(true);
    expect(parsed.bundle.shortcuts['file.save']).toBe('Ctrl+Alt+S');
  });

  it('restaura apariencia, preferencias y atajos en el almacenamiento', () => {
    const parsed = parsePreferencesBundle({
      kind: PREFERENCES_BUNDLE_KIND,
      version: 1,
      exportedAt: '2026-10-01T00:00:00.000Z',
      appearance: { ...DEFAULT_APPEARANCE, accent: '#38bdf8', preset: 'ocean' },
      editor: { ...DEFAULT_EDITOR_PREFERENCES, historyLimit: 160, snapEnabled: false },
      shortcuts: { ...DEFAULT_SHORTCUTS, 'edit.undo': 'Ctrl+Alt+Z' },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const summary = applyPreferencesBundle(parsed.bundle);
    expect(summary.appearance).toBe(true);
    expect(summary.editor).toBe(true);
    expect(summary.shortcuts).toBeGreaterThan(0);

    expect(loadAppearance().accent).toBe('#38bdf8');
    expect(loadAppearance().preset).toBe('ocean');
    expect(loadEditorPreferences().historyLimit).toBe(160);
    expect(loadEditorPreferences().snapEnabled).toBe(false);
    expect(loadShortcuts()['edit.undo']).toBe('Ctrl+Alt+Z');
  });

  it('rechaza archivos ajenos, vacíos, rotos o de versión futura', () => {
    const empty = parsePreferencesBundle('   ');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toContain('vacío');

    const broken = parsePreferencesBundle('{ no json');
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error).toContain('JSON');

    const foreign = parsePreferencesBundle({ kind: 'otra-cosa', version: 1 });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error).toContain('Editor IA');

    const future = parsePreferencesBundle({
      kind: PREFERENCES_BUNDLE_KIND,
      version: PREFERENCES_BUNDLE_VERSION + 1,
    });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.error).toContain('más nueva');
  });

  it('descarta atajos inválidos sin romper el resto del respaldo', () => {
    const parsed = parsePreferencesBundle({
      kind: PREFERENCES_BUNDLE_KIND,
      version: 1,
      appearance: { ...DEFAULT_APPEARANCE, accent: '#b8a1ff' },
      editor: DEFAULT_EDITOR_PREFERENCES,
      shortcuts: {
        'file.save': 'A',
        'file.open': 'Ctrl+O',
        'no.existe': 'Ctrl+Q',
        42: 'Ctrl+R',
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Una letra pelada rompería la escritura: se ignora y queda el default.
    expect(parsed.bundle.shortcuts['file.save']).toBe(DEFAULT_SHORTCUTS['file.save']);
    expect(parsed.bundle.shortcuts['file.open']).toBe('Ctrl+O');
    expect(Object.keys(parsed.bundle.shortcuts)).not.toContain('no.existe');
    expect(parsed.bundle.appearance.accent).toBe('#b8a1ff');
  });

  it('importa desde texto y devuelve un resumen utilizable', () => {
    const text = serializePreferencesBundle(buildPreferencesBundle());
    const result = importPreferencesFromText(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.shortcuts).toBeGreaterThan(0);

    const failure = importPreferencesFromText('{"kind":"nada"}');
    expect(failure.ok).toBe(false);
  });

  it('nombra el archivo con fecha y hora local', () => {
    const name = preferencesFileName(new Date(2026, 9, 22, 9, 5));
    expect(name).toBe('editor-ia-preferencias-20261022-0905.json');
  });

  it('no escribe nada si el paquete no se pudo validar', () => {
    saveAppearance({ ...DEFAULT_APPEARANCE, accent: '#5eead4' });
    const before = window.localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    const result = importPreferencesFromText('{"kind":"otro"}');
    expect(result.ok).toBe(false);
    expect(window.localStorage.getItem(SHORTCUTS_STORAGE_KEY)).toBe(before);
    expect(loadAppearance().accent).toBe('#5eead4');
  });
});
