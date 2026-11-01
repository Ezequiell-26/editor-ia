// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { createFakeService } from '../../test/fake-service';

vi.mock('./LottiePreview', () => ({
  LottiePreview: () => <div data-testid="lottie-preview" />,
}));

vi.mock('./lottie', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lottie')>();
  return {
    ...actual,
    createLottieRasterizer: vi.fn(async () => ({
      frameCount: 0,
      renderFrame: async () => 'iVBORw0KGgo=',
      dispose: () => {},
    })),
  };
});

const SAMPLE = {
  v: '5.7.4',
  fr: 30,
  ip: 0,
  op: 60,
  w: 200,
  h: 200,
  layers: [{ ty: 4, nm: 'box' }],
};

function lottieFile(name = 'logo.json'): File {
  return new File([JSON.stringify(SAMPLE)], name, { type: 'application/json' });
}

function lottieArchiveFile(): File {
  const animation = {
    ...SAMPLE,
    w: 32,
    h: 32,
    assets: [{ id: 'image_0', w: 1, h: 1, u: 'images/', p: 'img.png', e: 0 }],
    layers: [
      {
        ty: 4,
        refId: 'image_0',
        nm: 'img',
        shapes: [{ ty: 'fl', c: { a: 0, k: [0, 0, 0, 1], sid: 'fill' } }],
      },
    ],
  };
  const bytes = zipSync({
    'manifest.json': strToU8(
      JSON.stringify({
        version: '2',
        animations: [{ id: 'anim_1' }],
        themes: [{ id: 'theme_1', name: 'Tema' }],
        stateMachines: [{ id: 'sm_1', name: 'Máquina' }],
      }),
    ),
    'animations/anim_1.json': strToU8(JSON.stringify(animation)),
    'images/img.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    't/theme_1.json': strToU8(
      JSON.stringify({ rules: [{ id: 'fill', type: 'Color', value: [1, 0, 0] }] }),
    ),
    's/sm_1.json': strToU8(
      JSON.stringify({
        initial: 'idle',
        inputs: [{ type: 'Boolean', name: 'isActive', value: false }],
        states: [
          {
            name: 'idle',
            type: 'PlaybackState',
            animation: 'anim_1',
            transitions: [
              {
                type: 'Transition',
                toState: 'active',
                guards: [
                  {
                    type: 'Boolean',
                    inputName: 'isActive',
                    conditionType: 'Equal',
                    compareTo: true,
                  },
                ],
              },
            ],
          },
          {
            name: 'active',
            type: 'PlaybackState',
            animation: 'anim_1',
            segment: [0, 20],
            entryActions: [{ type: 'SetTheme', value: 'theme_1' }],
            transitions: [
              {
                type: 'Transition',
                toState: 'idle',
                guards: [
                  {
                    type: 'Boolean',
                    inputName: 'isActive',
                    conditionType: 'Equal',
                    compareTo: false,
                  },
                ],
              },
            ],
          },
        ],
      }),
    ),
  });
  return new File([bytes], 'pack.lottie', { type: 'application/zip' });
}

async function nav(label: string): Promise<void> {
  const navigation = screen.getByRole('navigation', { name: /vistas/i });
  // Igual que en App.test: la vista activa puede cambiar mientras el proyecto
  // termina de cargar y cerrar el menú avanzado; se reintenta.
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
    try {
      const button = await within(navigation).findByRole('button', { name: label }, { timeout: 800 });
      fireEvent.click(button);
      return;
    } catch {
      // La vista puede haber cambiado y cerrado el menú: reintentar.
    }
  }
  throw new Error(`No se encontró la vista ${label} en el sidebar`);
}

async function createProject(): Promise<void> {
  await nav('Proyectos');
  const input = within(screen.getByRole('main')).getByRole('textbox', { name: /nombre/i });
  fireEvent.change(input, { target: { value: 'Lottie QA' } });
  fireEvent.click(screen.getByRole('button', { name: /Crear y elegir ubicación/i }));
  await waitFor(
    () => expect(screen.getByRole('main').textContent).toMatch(/Timeline vacía|Timeline 01/),
    { timeout: 10_000 },
  );
}

async function openMotion(): Promise<HTMLElement> {
  await nav('Motion');
  return screen.findByRole('heading', { name: /^Lottie \(\.json/ }, { timeout: 10_000 });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('panel Lottie', () => {
  it('rechaza un archivo que no es un Lottie y no muestra la salida', async () => {
    render(<App service={createFakeService()} />);
    await createProject();
    await openMotion();
    const input = screen.getByLabelText('Archivo Lottie');
    fireEvent.change(input, {
      target: {
        files: [new File(['{ "v": 1 }'], 'roto.json', { type: 'application/json' })],
      },
    });
    expect(await screen.findByText(/no declara capas/i, {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByTestId('lottie-preview')).toBeNull();
  }, 20_000);

  it('muestra el plan de salida y exige derechos antes de convertir', async () => {
    render(<App service={createFakeService()} />);
    await createProject();
    await openMotion();
    fireEvent.change(screen.getByLabelText('Archivo Lottie'), {
      target: { files: [lottieFile()] },
    });
    expect(await screen.findByTestId('lottie-preview', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText(/Original: 200×200 px/)).toBeTruthy();
    expect(screen.getByText(/60 frames/)).toBeTruthy();
    const convert = screen.getByRole('button', { name: /Convertir en video con alfa/i });
    expect((convert as HTMLButtonElement).disabled).toBe(true);
  }, 20_000);

  it('convierte, sube lotes y agrega el asset con alfa a Medios', async () => {
    const service = createFakeService();
    render(<App service={service} />);
    await createProject();
    await openMotion();
    fireEvent.change(screen.getByLabelText('Archivo Lottie'), {
      target: { files: [lottieFile()] },
    });
    expect(await screen.findByTestId('lottie-preview', {}, { timeout: 8000 })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Frames por segundo de salida/i), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Tengo derechos/i }));
    fireEvent.click(screen.getByRole('button', { name: /Convertir en video con alfa/i }));
    expect(
      await screen.findByText(/Lottie en Medios: logo/i, {}, { timeout: 10_000 }),
    ).toBeTruthy();
    expect(service.alphaSequences).toHaveLength(1);
    const sequence = service.alphaSequences[0]!;
    expect(sequence.width).toBe(200);
    expect(sequence.height).toBe(200);
    expect(sequence.frameCount).toBe(2);
    expect(sequence.fpsNum).toBe(1);
    expect(sequence.label).toBe('logo');
    expect(service.alphaFrameBatches.reduce((sum, batch) => sum + batch.count, 0)).toBe(2);
    await waitFor(() =>
      expect(screen.getByRole('main').textContent).toMatch(/Medios/i),
    );
  }, 20_000);

  it('lee un pack .lottie con imagen embebida, aplica theme y ejecuta la state machine', async () => {
    render(<App service={createFakeService()} />);
    await createProject();
    await openMotion();
    fireEvent.change(screen.getByLabelText('Archivo Lottie'), {
      target: { files: [lottieArchiveFile()] },
    });
    expect(await screen.findByTestId('lottie-preview', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText(/Original: 32×32 px/)).toBeTruthy();
    expect(screen.getByText(/Pack \.lottie/)).toBeTruthy();
    expect(screen.getByText(/1 imagen embebida/)).toBeTruthy();
    expect(screen.getByText(/Estado: idle/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Tema del pack'), {
      target: { value: 'theme_1' },
    });
    expect(screen.getByText(/Tema aplicado: 1 regla/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Input isActive'));
    expect(await screen.findByText(/Estado: active/)).toBeTruthy();
    expect(screen.getByText(/Segmento del estado: frames 0–20/)).toBeTruthy();
    expect(screen.getByText(/20 frames/)).toBeTruthy();
  }, 20_000);
});
