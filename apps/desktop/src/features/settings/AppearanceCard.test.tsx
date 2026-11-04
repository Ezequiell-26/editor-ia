// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APPEARANCE_STORAGE_KEY } from '../../state/appearance';
import { AppearanceProvider } from '../../state/AppearanceProvider';
import { THEME_PALETTES } from '../../state/theme-palette';
import { AppearanceCard } from './AppearanceCard';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('style');
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute('style');
});

function renderCard() {
  return render(
    <AppearanceProvider>
      <AppearanceCard />
    </AppearanceProvider>,
  );
}

function savedAppearance(): Record<string, unknown> {
  const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
  if (!raw) throw new Error('la apariencia todavía no se guardó');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('AppearanceCard', () => {
  it('aplica la paleta completa al elegir un preset y la persiste', async () => {
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Tema Menta' }));

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe(
        THEME_PALETTES.mint.accent,
      ),
    );
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe(
      THEME_PALETTES.mint.bg,
    );
    expect(document.documentElement.style.getPropertyValue('--commercial-accent')).toBe(
      THEME_PALETTES.mint.accent,
    );

    await waitFor(
      () => {
        const saved = savedAppearance();
        expect(saved.preset).toBe('mint');
        expect((saved.palette as Record<string, string>).accent).toBe(
          THEME_PALETTES.mint.accent,
        );
        expect((saved.palette as Record<string, string>).bg).toBe(THEME_PALETTES.mint.bg);
      },
      { timeout: 2_000 },
    );
  });

  it('conserva densidad y escala al cambiar de preset', async () => {
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Compacta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tema Océano' }));

    await waitFor(
      () => {
        const saved = savedAppearance();
        expect(saved.preset).toBe('ocean');
        expect(saved.density).toBe('compact');
        expect(saved.scale).toBe(1);
      },
      { timeout: 2_000 },
    );
  });

  it('aplica el preset claro nativo, cambia color-scheme y lo persiste', async () => {
    renderCard();

    expect(screen.getByRole('button', { name: 'Tema Claro neutro' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tema Claro neutro' }));

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe(
        THEME_PALETTES.light.bg,
      ),
    );
    expect(document.documentElement.style.getPropertyValue('--color-text')).toBe(
      THEME_PALETTES.light.text,
    );
    expect(document.documentElement.style.colorScheme).toBe('light');

    await waitFor(
      () => {
        const saved = savedAppearance();
        expect(saved.preset).toBe('light');
        const palette = saved.palette as Record<string, string>;
        expect(palette.bg).toBe(THEME_PALETTES.light.bg);
        expect(palette.surface).toBe(THEME_PALETTES.light.surface);
        expect(palette.text).toBe(THEME_PALETTES.light.text);
      },
      { timeout: 2_000 },
    );

    // Volver a un preset oscuro restaura color-scheme dark (mismo motor).
    fireEvent.click(screen.getByRole('button', { name: 'Tema Olyvia' }));
    await waitFor(() =>
      expect(document.documentElement.style.colorScheme).toBe('dark'),
    );
  });

  it('sigue ofreciendo densidad, escala, esquinas, filas y comprobaciones', () => {
    renderCard();

    expect(screen.getByRole('group', { name: 'Densidad' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: /^Escala/ })).toBeTruthy();
    expect(screen.getByRole('slider', { name: /^Esquinas/ })).toBeTruthy();
    expect(screen.getByRole('slider', { name: /^Filas/ })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Color de acento' })).toBeTruthy();
    expect(screen.getByText('Etiquetas en el rail')).toBeTruthy();
    expect(screen.getByText('Barra de estado')).toBeTruthy();
    expect(screen.getByText('Reducir animaciones')).toBeTruthy();
  });
});
