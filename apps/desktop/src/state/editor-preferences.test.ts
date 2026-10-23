// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EDITOR_PREFERENCES,
  EDITOR_PREFS_CHANGED_EVENT,
  EDITOR_PREFS_STORAGE_KEY,
  loadEditorPreferences,
  normalizeEditorPreferences,
  resetEditorPreferences,
  saveEditorPreferences,
  subscribeEditorPreferences,
  updateEditorPreferences,
  type PreferencesStorage,
} from './editor-preferences';

function memoryStorage(): PreferencesStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('preferencias del editor', () => {
  it('acota cada número y descarta los tipos equivocados', () => {
    const preferences = normalizeEditorPreferences({
      autosaveDelayMs: 99_999,
      historyLimit: -4,
      defaultZoom: 'mucho',
      snapEnabled: 'sí',
      snapPixels: 900,
      followPlayhead: null,
      showWaveforms: false,
      showThumbnails: 0,
      loopPlayback: true,
      jumpStepFrames: 0,
      safeMargins: 'no',
    });
    expect(preferences.autosaveDelayMs).toBe(8_000);
    expect(preferences.historyLimit).toBe(20);
    expect(preferences.defaultZoom).toBe(DEFAULT_EDITOR_PREFERENCES.defaultZoom);
    expect(preferences.snapEnabled).toBe(DEFAULT_EDITOR_PREFERENCES.snapEnabled);
    expect(preferences.snapPixels).toBe(24);
    expect(preferences.followPlayhead).toBe(DEFAULT_EDITOR_PREFERENCES.followPlayhead);
    expect(preferences.showWaveforms).toBe(false);
    expect(preferences.showThumbnails).toBe(DEFAULT_EDITOR_PREFERENCES.showThumbnails);
    expect(preferences.loopPlayback).toBe(true);
    expect(preferences.jumpStepFrames).toBe(1);
    expect(preferences.safeMargins).toBe(DEFAULT_EDITOR_PREFERENCES.safeMargins);
  });

  it('ignora objetos que no son preferencias', () => {
    expect(normalizeEditorPreferences(null)).toEqual(DEFAULT_EDITOR_PREFERENCES);
    expect(normalizeEditorPreferences('texto')).toEqual(DEFAULT_EDITOR_PREFERENCES);
    expect(normalizeEditorPreferences([1, 2, 3])).toEqual(DEFAULT_EDITOR_PREFERENCES);
  });

  it('guarda, recupera y actualiza de forma parcial', () => {
    const storage = memoryStorage();
    saveEditorPreferences({ ...DEFAULT_EDITOR_PREFERENCES, defaultZoom: 1.8 }, storage);
    expect(storage.data.has(EDITOR_PREFS_STORAGE_KEY)).toBe(true);
    expect(loadEditorPreferences(storage).defaultZoom).toBe(1.8);

    const updated = updateEditorPreferences({ snapEnabled: false, jumpStepFrames: 5 }, storage);
    expect(updated.snapEnabled).toBe(false);
    expect(updated.jumpStepFrames).toBe(5);
    // El resto se conserva.
    expect(updated.defaultZoom).toBe(1.8);
    expect(loadEditorPreferences(storage).snapEnabled).toBe(false);
  });

  it('vuelve a los valores de fábrica al restablecer', () => {
    const storage = memoryStorage();
    updateEditorPreferences({ historyLimit: 150, loopPlayback: true }, storage);
    expect(loadEditorPreferences(storage).historyLimit).toBe(150);

    const reset = resetEditorPreferences(storage);
    expect(reset).toEqual(DEFAULT_EDITOR_PREFERENCES);
    expect(loadEditorPreferences(storage)).toEqual(DEFAULT_EDITOR_PREFERENCES);
  });

  it('tolera un almacenamiento corrupto o ausente', () => {
    const broken = memoryStorage();
    broken.data.set(EDITOR_PREFS_STORAGE_KEY, '{no es json');
    expect(loadEditorPreferences(broken)).toEqual(DEFAULT_EDITOR_PREFERENCES);
    expect(loadEditorPreferences(null)).toEqual(DEFAULT_EDITOR_PREFERENCES);
    expect(saveEditorPreferences(DEFAULT_EDITOR_PREFERENCES, null)).toEqual(
      DEFAULT_EDITOR_PREFERENCES,
    );
  });

  it('avisa a los suscriptores y permite desuscribir', () => {
    window.localStorage.clear();
    const listener = vi.fn();
    const unsubscribe = subscribeEditorPreferences(listener);

    saveEditorPreferences({ ...DEFAULT_EDITOR_PREFERENCES, loopPlayback: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ loopPlayback: true });

    unsubscribe();
    window.dispatchEvent(new CustomEvent(EDITOR_PREFS_CHANGED_EVENT));
    expect(listener).toHaveBeenCalledTimes(1);
    window.localStorage.clear();
  });
});
