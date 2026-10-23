// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorPreferencesCard } from './EditorPreferencesCard';
import { loadEditorPreferences } from '../../state/editor-preferences';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('tarjeta de preferencias del editor', () => {
  it('persiste una casilla al instante', () => {
    render(<EditorPreferencesCard />);
    const loop = screen.getByLabelText('Reproducción en bucle') as HTMLInputElement;
    expect(loop.checked).toBe(false);

    fireEvent.click(loop);

    expect(loadEditorPreferences().loopPlayback).toBe(true);
  });

  it('persiste el slider recién al soltarlo', () => {
    render(<EditorPreferencesCard />);
    const slider = screen.getByLabelText('Autoguardado') as HTMLInputElement;

    fireEvent.change(slider, { target: { value: '3000' } });
    // Mientras se arrastra no se escribe en disco.
    expect(loadEditorPreferences().autosaveDelayMs).toBe(1_400);

    fireEvent.keyUp(slider);
    expect(loadEditorPreferences().autosaveDelayMs).toBe(3_000);
  });

  it('restablece todos los valores de fábrica', () => {
    render(<EditorPreferencesCard />);
    fireEvent.click(screen.getByLabelText('Miniaturas en los clips'));
    fireEvent.click(screen.getByLabelText('Imán activo al abrir la timeline'));
    expect(loadEditorPreferences().showThumbnails).toBe(false);
    expect(loadEditorPreferences().snapEnabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Restablecer' }));

    expect(loadEditorPreferences().showThumbnails).toBe(true);
    expect(loadEditorPreferences().snapEnabled).toBe(true);
  });
});
