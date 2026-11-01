// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedMotion } from './library-api';
import { MotionLibraryPanel } from './MotionLibraryPanel';

vi.mock('../LottiePreview', () => ({
  LottiePreview: () => <div data-testid="lottie-preview" />,
}));

vi.mock('../../../state/project-store', () => ({
  useProjectStore: () => ({
    state: { project: null },
    service: { openExternalUrl: vi.fn(async () => {}) },
    mutate: vi.fn(() => false),
  }),
}));

const state = vi.hoisted(() => ({
  entries: [] as CachedMotion[],
  downloads: [] as string[],
}));

vi.mock('./library-api', () => ({
  motionListCached: vi.fn(async () => state.entries),
  motionCacheStats: vi.fn(async () => ({
    dir: 'C:/AppData/Olyvia/motions/cache',
    count: state.entries.length,
    bytes: state.entries.reduce((sum, entry) => sum + entry.bytes, 0),
  })),
  motionDownload: vi.fn(
    async (request: { id: string; bytes: number; sha256: string }) => {
      state.downloads.push(request.id);
      const entry: CachedMotion = {
        id: request.id,
        bytes: request.bytes,
        sha256: request.sha256,
        modifiedMs: 1,
      };
      state.entries = [entry];
      return entry;
    },
  ),
  motionReadCached: vi.fn(async () =>
    JSON.stringify({
      v: '5.7.4',
      fr: 30,
      ip: 0,
      op: 30,
      w: 32,
      h: 32,
      layers: [{ ty: 4 }],
    }),
  ),
  motionRemoveCached: vi.fn(async () => true),
}));

beforeEach(() => {
  state.entries = [];
  state.downloads = [];
});

afterEach(() => {
  cleanup();
});

describe('biblioteca de iconos animados', () => {
  it('previsualiza un icono offline y exige proyecto para usarlo', async () => {
    render(<MotionLibraryPanel onNavigate={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Check en círculo/ }));
    expect(await screen.findByTestId('lottie-preview', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(/\d+ iconos/)).toBeTruthy();
    expect(state.downloads).toHaveLength(0);
    const use = screen.getByRole('button', { name: /Usar en video/i }) as HTMLButtonElement;
    expect(use.disabled).toBe(true);
  });

  it('descarga un icono remoto, lo verifica y lo deja en caché', async () => {
    render(<MotionLibraryPanel onNavigate={() => {}} />);
    await screen.findByText(/\d+ iconos/);

    fireEvent.change(screen.getByLabelText(/Buscar iconos animados/i), {
      target: { value: 'sonrisa' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Sonrisa/ }));

    expect(await screen.findByText(/Descargá el icono/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Descargar$/ }));

    expect(
      await screen.findByText(/descargado y verificado con SHA-256/i, {}, { timeout: 5000 }),
    ).toBeTruthy();
    expect(state.downloads).toEqual(['ua-smile']);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Quitar de la caché/i })).toBeTruthy(),
    );
    expect(screen.getByTestId('lottie-preview')).toBeTruthy();
  });
});
