// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPEARANCE_STORAGE_KEY } from '../../state/appearance';
import { AppearanceProvider } from '../../state/AppearanceProvider';
import { THEME_PALETTES, serializeThemeFile } from '../../state/theme-palette';
import { ColorStudioCard } from './ColorStudioCard';

const createObjectURL = vi.fn((_blob: Blob) => 'blob:olyvia-tema');

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('style');
  // jsdom no implementa createObjectURL/revokeObjectURL: se reemplazan para
  // poder ejecutar la exportación sin abrir una descarga real.
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute('style');
  delete (URL as unknown as Record<string, unknown>).createObjectURL;
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  vi.restoreAllMocks();
  createObjectURL.mockClear();
});

function renderCard() {
  return render(
    <AppearanceProvider>
      <ColorStudioCard />
    </AppearanceProvider>,
  );
}

function tokenRow(container: HTMLElement, token: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`.color-row[data-token="${token}"]`);
  if (!row) throw new Error(`no se encontró la fila del token ${token}`);
  return row;
}

function rootVariable(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

/** jsdom no implementa `Blob.text()`: se lee con FileReader como el navegador. */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('no se pudo leer el blob'));
    reader.readAsText(blob);
  });
}

describe('ColorStudioCard · estructura', () => {
  it('renderiza los 5 grupos, las 34 filas y el preview del shell', () => {
    const { container } = renderCard();

    expect(container.querySelectorAll('.color-group').length).toBe(5);
    expect(container.querySelectorAll('.color-row').length).toBe(34);
    for (const group of ['superficies', 'acento', 'estados', 'medios', 'marca']) {
      expect(container.querySelector(`.color-group[data-group="${group}"]`)).toBeTruthy();
    }
    expect(container.querySelector('.theme-preview')).toBeTruthy();
    expect(container.querySelector('.theme-preview-primary')).toBeTruthy();
    expect(container.querySelector('.theme-preview-badge')).toBeTruthy();
    expect(container.querySelector('.theme-preview-notice')).toBeTruthy();
  });

  it('cada fila expone color, hex y label; y el reset sólo aparece si difiere del preset', () => {
    const { container } = renderCard();
    const row = tokenRow(container, 'accent');

    expect(row.querySelector('input.color-input')).toBeTruthy();
    expect(row.querySelector('input.color-hex')).toBeTruthy();
    expect(row.querySelector('button.color-reset')).toBeNull();
  });
});

describe('ColorStudioCard · edición de tokens', () => {
  it('previsualiza en vivo y persiste el acento al confirmar', async () => {
    const { container } = renderCard();
    const row = tokenRow(container, 'accent');
    const color = row.querySelector<HTMLInputElement>('input.color-input')!;

    fireEvent.change(color, { target: { value: '#ff2d55' } });

    // El proveedor pinta las variables en el próximo frame, sin re-render.
    await waitFor(() => expect(rootVariable('--color-accent')).toBe('#ff2d55'));
    expect(rootVariable('--commercial-accent')).toBe('#ff2d55');

    fireEvent.blur(color);

    await waitFor(
      () => {
        const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
        expect(raw).toBeTruthy();
        expect(JSON.parse(raw!).palette.accent).toBe('#ff2d55');
      },
      { timeout: 2_000 },
    );
  });

  it('vuelve al color del preset con el botón de reset del token', async () => {
    const { container } = renderCard();
    const row = tokenRow(container, 'accent');
    const color = row.querySelector<HTMLInputElement>('input.color-input')!;

    fireEvent.change(color, { target: { value: '#ff2d55' } });
    fireEvent.blur(color);

    const reset = await waitFor(() => {
      const button = row.querySelector<HTMLButtonElement>('button.color-reset');
      expect(button).toBeTruthy();
      return button!;
    });

    fireEvent.click(reset);

    await waitFor(() =>
      expect(rootVariable('--color-accent')).toBe(THEME_PALETTES.olyvia.accent),
    );
  });

  it('acepta hex #rgb y #rrggbb, y revierte un texto inválido', async () => {
    const { container } = renderCard();
    const row = tokenRow(container, 'surface');
    const hex = row.querySelector<HTMLInputElement>('input.color-hex')!;

    fireEvent.change(hex, { target: { value: '#abc' } });
    fireEvent.blur(hex);
    await waitFor(() => expect(rootVariable('--color-surface')).toBe('#aabbcc'));

    fireEvent.change(hex, { target: { value: 'no-es-un-color' } });
    fireEvent.blur(hex);
    expect(hex.value).toBe(rootVariable('--color-surface'));
    expect(rootVariable('--color-surface')).toBe('#aabbcc');
  });
});

describe('ColorStudioCard · contraste', () => {
  it('marca un par ilegible como is-fail y «Corregir texto» lo vuelve is-pass', async () => {
    const { container } = renderCard();
    const row = tokenRow(container, 'text');
    const hex = row.querySelector<HTMLInputElement>('input.color-hex')!;
    const bg = THEME_PALETTES.olyvia.bg;

    // Texto del mismo color que el fondo: el par texto/fondo no puede pasar.
    fireEvent.change(hex, { target: { value: bg } });
    fireEvent.blur(hex);

    const failed = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.contrast-row[data-check="text-bg"]');
      expect(element?.classList.contains('is-fail')).toBe(true);
      return element!;
    });
    expect(failed.querySelector('.contrast-state')?.classList.contains('is-fail')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Corregir texto' }));

    await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.contrast-row[data-check="text-bg"]');
      expect(element?.classList.contains('is-pass')).toBe(true);
    });
    expect(container.querySelectorAll('.contrast-row.is-fail').length).toBe(0);
  });
});

describe('ColorStudioCard · archivo de tema', () => {
  it('exporta un JSON con la paleta de 34 tokens y avisa por el estado', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { container } = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Exportar tema' }));

    const status = container.querySelector('.color-studio-status');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toMatch(/export/i);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]![0] as unknown as Blob;
    const file = JSON.parse(await readBlobText(blob)) as {
      kind: string;
      palette: Record<string, string>;
    };
    expect(file.kind).toBe('olyvia-theme');
    expect(Object.keys(file.palette).length).toBe(34);
  });

  it('importa un archivo válido y aplica la paleta completa', async () => {
    const { container } = renderCard();
    const input = container.querySelector<HTMLInputElement>('input.color-studio-file')!;
    const text = serializeThemeFile(THEME_PALETTES.mint, 'Menta de prueba');
    const file = new File([text], 'tema.json', { type: 'application/json' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(rootVariable('--color-accent')).toBe(THEME_PALETTES.mint.accent),
    );
    expect(rootVariable('--color-bg')).toBe(THEME_PALETTES.mint.bg);

    const status = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.color-studio-status');
      expect(element?.getAttribute('role')).toBe('status');
      return element!;
    });
    expect(status.textContent).toMatch(/import/i);
  });

  it('rechaza un archivo inválido sin cambiar la paleta', async () => {
    const { container } = renderCard();
    const input = container.querySelector<HTMLInputElement>('input.color-studio-file')!;
    const accentBefore = rootVariable('--color-accent');
    const file = new File(['{"kind":"otro","version":9}'], 'malo.json', {
      type: 'application/json',
    });

    fireEvent.change(input, { target: { files: [file] } });

    const status = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.color-studio-status');
      expect(element).toBeTruthy();
      return element!;
    });
    expect(status.getAttribute('role')).toBe('status');
    expect(status.className).toMatch(/notice-warning/);
    expect(rootVariable('--color-accent')).toBe(accentBefore);
  });

  it('restablece los colores con confirmación de dos pasos', async () => {
    const { container } = renderCard();
    const input = container.querySelector<HTMLInputElement>('input.color-studio-file')!;

    // Primero se aplica un tema distinto para comprobar que se restablece.
    fireEvent.change(input, {
      target: { files: [new File([serializeThemeFile(THEME_PALETTES.mint)], 'tema.json')] },
    });
    await waitFor(() =>
      expect(rootVariable('--color-accent')).toBe(THEME_PALETTES.mint.accent),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Restablecer colores' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar restablecer colores' }));

    await waitFor(() =>
      expect(rootVariable('--color-accent')).toBe(THEME_PALETTES.olyvia.accent),
    );
    expect(container.querySelector('.color-studio-status')?.textContent).toMatch(/restablec/i);
  });
});
