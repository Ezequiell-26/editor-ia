// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function nav(label: string): void {
  const navigation = screen.getByRole('navigation', { name: /vistas/i });
  let button = within(navigation).queryByRole('button', { name: label });
  if (!button) {
    fireEvent.click(within(navigation).getByRole('button', { name: /Más herramientas/i }));
    button = within(navigation).getByRole('button', { name: label });
  }
  fireEvent.click(button);
}

async function createProject(): Promise<void> {
  nav('Proyectos');
  const input = within(screen.getByRole('main')).getByRole('textbox', { name: /nombre/i });
  fireEvent.change(input, { target: { value: 'Lottie QA' } });
  fireEvent.click(screen.getByRole('button', { name: /Crear y elegir ubicación/i }));
  await waitFor(
    () => expect(screen.getByRole('main').textContent).toMatch(/Timeline vacía|Timeline 01/),
    { timeout: 10_000 },
  );
}

async function openMotion(): Promise<HTMLElement> {
  nav('Motion');
  return screen.findByRole('heading', { name: /^Lottie \(\.json\)$/ }, { timeout: 10_000 });
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
  });

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
  });

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
  });
});
