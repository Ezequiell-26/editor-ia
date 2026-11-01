// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../App';
import { createFakeService } from '../../../test/fake-service';

vi.mock('../LottiePreview', () => ({
  LottiePreview: () => <div data-testid="lottie-preview" />,
}));

vi.mock('../lottie', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lottie')>();
  return {
    ...actual,
    createLottieRasterizer: vi.fn(async () => ({
      frameCount: 30,
      renderFrame: async () => 'iVBORw0KGgo=',
      dispose: () => {},
    })),
  };
});

vi.mock('./library-api', () => ({
  motionListCached: vi.fn(async () => []),
  motionCacheStats: vi.fn(async () => ({ dir: 'C:/cache', count: 0, bytes: 0 })),
  motionDownload: vi.fn(),
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

function nav(label: string): void {
  const navigation = screen.getByRole('navigation', { name: /vistas/i });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const direct = within(navigation).queryByRole('button', { name: label });
    if (direct) {
      fireEvent.click(direct);
      return;
    }
    const close = within(navigation).queryByRole('button', {
      name: /Cerrar herramientas avanzadas/i,
    });
    if (close) fireEvent.click(close);
    const more = within(navigation).queryByRole('button', { name: /Más herramientas/i });
    if (more) fireEvent.click(more);
    const advanced = within(navigation).queryByRole('button', { name: label });
    if (advanced) {
      fireEvent.click(advanced);
      return;
    }
  }
  throw new Error(`No se encontró la vista ${label} en el sidebar`);
}

async function createProject(): Promise<void> {
  nav('Proyectos');
  const input = within(screen.getByRole('main')).getByRole('textbox', { name: /nombre/i });
  fireEvent.change(input, { target: { value: 'Motion Library QA' } });
  fireEvent.click(screen.getByRole('button', { name: /Crear y elegir ubicación/i }));
  await waitFor(
    () => expect(screen.getByRole('main').textContent).toMatch(/Timeline vacía|Timeline 01/),
    { timeout: 10_000 },
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('biblioteca Motion dentro de la app', () => {
  it('convierte un icono offline a 512 px y lo agrega a Medios', async () => {
    const service = createFakeService();
    render(<App service={service} />);
    await createProject();
    nav('Motion');

    fireEvent.click(
      await screen.findByRole('button', { name: /^Check en círculo/ }, { timeout: 10_000 }),
    );
    const use = (await screen.findByRole('button', {
      name: /Usar en video/i,
    })) as HTMLButtonElement;
    expect(use.disabled).toBe(false);
    fireEvent.click(use);

    await waitFor(() => expect(service.alphaSequences).toHaveLength(1), { timeout: 10_000 });
    expect(service.alphaSequences[0]).toMatchObject({
      width: 512,
      height: 512,
      label: 'Check en círculo',
    });
  }, 20_000);
});
