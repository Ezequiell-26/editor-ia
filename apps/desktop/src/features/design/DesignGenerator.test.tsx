// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { DesignGenerator } from './DesignGenerator';
import type { DesignSystemEntry } from './open-design';
import { renderDesignToVideo } from './video';
import { DESIGN_SELECTION_KEY } from './design-selection';
import { writeClipboard } from './clipboard';

const system: DesignSystemEntry = {
  id: 'aurora',
  name: 'Aurora',
  category: 'SaaS',
  description: 'Interfaz luminosa.',
  colors: { bg: '#ffffff', surface: '#f6f8fc', fg: '#111827', accent: '#ff385c' },
  canvas: {
    bg: '#ffffff',
    surface: '#f6f8fc',
    fg: '#111827',
    accent: '#ff385c',
    accentOn: '#ffffff',
  },
  fonts: { display: 'Inter', body: 'Inter', mono: null },
  craft: { applies: [], suggested: [] },
  previewPages: [],
  hasComponents: false,
  files: { design: 'DESIGN.md', tokens: 'tokens.css', designTokens: null, components: null },
};

vi.mock('./clipboard', () => ({
  writeClipboard: vi.fn(async () => true),
}));

vi.mock('./video', () => ({
  renderDesignToVideo: vi.fn(async () => ({
    blob: new Blob([], { type: 'video/mp4' }),
    url: 'blob:olyvia-video',
    base64: 'AAAA',
    width: 1080,
    height: 1080,
    durationSeconds: 3,
    fps: 15,
    scenes: 1,
  })),
}));

vi.mock('./pdf', () => ({
  renderDeckToPdf: vi.fn(async () => ({
    base64: 'JVBERi0=',
    bytes: 4096,
    pages: 4,
    width: 1280,
    height: 720,
  })),
}));

vi.mock('./rasterize', () => ({
  renderDesignToPng: vi.fn(async () => ({
    dataUrl: 'data:image/png;base64,AAAA',
    base64: 'AAAA',
    width: 1080,
    height: 1080,
  })),
}));

vi.mock('./open-design', async () => {
  const actual = await vi.importActual<typeof import('./open-design')>('./open-design');
  return {
    ...actual,
    loadDesignSystemTokens: vi.fn(async () => ':root { --accent: #ff385c; }'),
    loadCraftDoc: vi.fn(async () => '# Regla'),
  };
});

function renderGenerator(
  onClose = vi.fn(),
  recipe: { title: string; text: string } | null = null,
) {
  const project = createEmptyProject('Generador', '2026-10-29T00:00:00.000Z');
  const service = createFakeService();
  const onNavigate = vi.fn();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'generador.editoria.json',
          path: 'C:\\tester\\generador.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <DesignGenerator system={system} craft={[]} recipe={recipe} open onClose={onClose} onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { service, onClose, onNavigate };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('generador de diseños', () => {
  it('exige un brief útil antes de llamar al proveedor', async () => {
    const { service } = renderGenerator();
    const spy = vi.spyOn(service, 'generateDesign');
    fireEvent.click(screen.getByRole('button', { name: /Generar diseño/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/al menos 20 caracteres/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it('genera el HTML, lo previsualiza y lo guarda', async () => {
    const { service } = renderGenerator();
    fireEvent.change(screen.getByRole('textbox', { name: /Brief/i }), {
      target: {
        value:
          'Landing para un estudio de edición que vende piezas cortas a marcas y necesita una llamada a reservar.',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generar diseño/i }));
    const frame = await screen.findByTitle(/Diseño generado con Aurora/i);
    expect(frame.getAttribute('srcdoc')).toContain('Diseño de prueba');
    expect(frame.getAttribute('sandbox')).toBe('');

    const save = vi.spyOn(service, 'saveDesignHtml');
    fireEvent.click(screen.getByRole('button', { name: /Guardar HTML/i }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/C:\\tester\\/),
    );
    expect(save).toHaveBeenCalledWith(
      expect.stringContaining('<!doctype html>'),
      expect.stringContaining('Landing para un estudio'),
    );
  });

  it('propone direcciones y usa una como receta del diseño', async () => {
    const { service } = renderGenerator();
    fireEvent.change(screen.getByRole('textbox', { name: /Brief/i }), {
      target: {
        value:
          'Landing para un estudio de edición que vende piezas cortas a marcas y necesita una llamada a reservar.',
      },
    });
    const directions = vi.spyOn(service, 'generateDesignDirections');
    fireEvent.click(screen.getByRole('button', { name: /Proponer 3 direcciones/i }));
    await screen.findByText('Cobalto editorial');
    expect(directions).toHaveBeenCalledWith({
      brief: expect.stringContaining('Landing para un estudio'),
      approvedCost: false,
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Usar esta dirección/i })[0]!);
    expect(screen.getByText(/Dirección activa:/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /Aplicar paleta/i })[0]!);
    expect(
      JSON.parse(window.localStorage.getItem(DESIGN_SELECTION_KEY) ?? '{}'),
    ).toMatchObject({ id: 'direction-cobalto-editorial', accent: '#d8000f' });
    const generate = vi.spyOn(service, 'generateDesign');
    fireEvent.click(screen.getByRole('button', { name: /^Generar diseño$/i }));
    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({
          recipe: expect.stringContaining('Dirección visual: Cobalto editorial'),
        }),
      ),
    );
  });

  it('construye el brief con las preguntas de descubrimiento', async () => {
    renderGenerator();
    fireEvent.click(screen.getByRole('button', { name: /Construir brief/i }));
    fireEvent.change(screen.getByLabelText('Qué es'), {
      target: { value: 'Landing de un estudio de edición de video' },
    });
    fireEvent.change(screen.getByLabelText('Para quién'), {
      target: { value: 'Equipos de marketing de marcas medianas' },
    });
    fireEvent.change(screen.getByLabelText('Qué debe lograr'), {
      target: { value: 'Mostrar tres ejemplos y reservar una llamada' },
    });
    fireEvent.change(screen.getByLabelText('Tono y restricciones'), {
      target: { value: 'Profesional y sin stock genérico' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Usar este brief/i }));
    expect((screen.getByRole('textbox', { name: /Brief/i }) as HTMLTextAreaElement).value).toBe(
      'Landing de un estudio de edición de video. Público: Equipos de marketing de marcas medianas. Objetivo: Mostrar tres ejemplos y reservar una llamada. Tono y restricciones: Profesional y sin stock genérico.',
    );
    expect(screen.queryByLabelText('Qué es')).toBeNull();
  });

  it('copia un handoff con tokens, brief y formato', async () => {
    const { service } = renderGenerator();
    fireEvent.change(screen.getByRole('textbox', { name: /Brief/i }), {
      target: {
        value:
          'Landing para un estudio de edición que vende piezas cortas a marcas y necesita una llamada a reservar.',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generar diseño/i }));
    await screen.findByTitle(/Diseño generado con Aurora/i);
    vi.spyOn(service, 'saveDesignHtml');
    fireEvent.click(screen.getByRole('button', { name: /Copiar handoff/i }));
    await waitFor(() =>
      expect(writeClipboard).toHaveBeenCalledWith(
        expect.stringMatching(/# Handoff — Aurora[\s\S]*Formato: page[\s\S]*--accent: #ff385c/),
      ),
    );
  });

  it('aplica una instrucción de edición sobre el HTML actual', async () => {
    const { service } = renderGenerator();
    fireEvent.change(screen.getByRole('textbox', { name: /Brief/i }), {
      target: {
        value:
          'Landing para un estudio de edición que vende piezas cortas a marcas y necesita una llamada a reservar.',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generar diseño/i }));
    await screen.findByTitle(/Diseño generado con Aurora/i);
    const regenerate = vi.spyOn(service, 'generateDesign');
    fireEvent.change(screen.getByLabelText(/Ajustar con una instrucción/i), {
      target: { value: 'Cambiá el titular y agregá una sección de precios' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Aplicar cambio/i }));
    await waitFor(() =>
      expect(regenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          recipe: expect.stringMatching(/Instrucción de edición:[\s\S]*Cambiá el titular/),
        }),
      ),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/Ajustar con una instrucción/i) as HTMLInputElement).value,
      ).toBe(''),
    );
    expect(screen.getByTitle(/Diseño generado con Aurora/i)).toBeTruthy();
  });

  it('revisa el diseño con el proveedor y muestra los hallazgos', async () => {
    const { service } = renderGenerator();
    fireEvent.change(screen.getByRole('textbox', { name: /Brief/i }), {
      target: {
        value:
          'Landing para un estudio de edición que vende piezas cortas a marcas y necesita una llamada a reservar.',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generar diseño/i }));
    await screen.findByTitle(/Diseño generado con Aurora/i);
    const critique = vi.spyOn(service, 'critiqueDesign');
    fireEvent.click(screen.getByRole('button', { name: /Criticar diseño/i }));
    const region = await screen.findByRole('region', { name: /Revisión de diseño/i });
    expect(region.textContent).toMatch(/Revisión de prueba/i);
    expect(critique).toHaveBeenCalledWith({
      html: expect.stringContaining('<!doctype html>'),
      brief: expect.stringContaining('Landing para un estudio'),
      approvedCost: false,
    });

    const regenerate = vi.spyOn(service, 'generateDesign');
    fireEvent.click(
      screen.getByRole('button', { name: /Corregir con la crítica/i }),
    );
    await waitFor(() =>
      expect(regenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          recipe: expect.stringContaining('Crítica a corregir'),
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('region', { name: /Revisión/i })).toBeNull());
  });

  it('rasteriza el HTML y guarda el PNG', async () => {
    const { service, onNavigate } = renderGenerator();
    fireEvent.change(screen.getByRole('textbox', { name: /Brief/i }), {
      target: { value: 'Landing para un estudio de edición con tres ejemplos y una llamada final.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generar diseño/i }));
    await screen.findByTitle(/Diseño generado con Aurora/i);
    fireEvent.click(screen.getByRole('button', { name: /Renderizar PNG/i }));
    expect(await screen.findByAltText(/PNG rasterizado de Aurora a 1080×1080/i)).toBeTruthy();
    const save = vi.spyOn(service, 'saveDesignPng');
    fireEvent.click(screen.getByRole('button', { name: /Guardar PNG/i }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/PNG guardado en/),
    );
    expect(save).toHaveBeenCalledWith('AAAA', expect.any(String));

    const stage = vi.spyOn(service, 'stageDesignMedia');
    const importMedia = vi.spyOn(service, 'importMediaPaths');
    fireEvent.click(screen.getByRole('button', { name: /Enviar PNG a Medios/i }));
    await waitFor(() =>
      expect(screen.getByText(/Agregado a Medios como/)).toBeTruthy(),
    );
    expect(stage).toHaveBeenCalledWith('AAAA', 'png');
    expect(importMedia).toHaveBeenCalledWith(
      expect.objectContaining({ paths: ['media/diseno.png'] }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Montar en la timeline/i }));
    expect(onNavigate).toHaveBeenCalledWith('editor');
  });

  it('crea el MP4 y lo guarda', async () => {
    const { service } = renderGenerator();
    fireEvent.change(screen.getByRole('textbox', { name: /Brief/i }), {
      target: { value: 'Tarjeta de taller de edición con fecha, duración y llamada a reservar.' },
    });
    fireEvent.click(screen.getByRole('button', { name: '5 s' }));
    fireEvent.click(screen.getByRole('button', { name: '30 fps' }));
    fireEvent.click(screen.getByRole('button', { name: /Generar diseño/i }));
    await screen.findByTitle(/Diseño generado con Aurora/i);
    fireEvent.click(screen.getByRole('button', { name: /Crear video 5 s/i }));
    expect(vi.mocked(renderDesignToVideo)).toHaveBeenCalledWith(expect.any(String), 'page', {
      durationSeconds: 5,
      fps: 30,
    });
    const video = await screen.findByLabelText(/Video generado de Aurora/i);
    expect(video.getAttribute('src')).toBe('blob:olyvia-video');
    const save = vi.spyOn(service, 'saveDesignVideo');
    fireEvent.click(screen.getByRole('button', { name: /Guardar MP4/i }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/MP4 guardado en/),
    );
    expect(save).toHaveBeenCalledWith('AAAA', expect.any(String));
  });

  it('exporta un deck a PDF y lo guarda', async () => {
    const { service } = renderGenerator();
    fireEvent.click(screen.getByRole('button', { name: /^Deck/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /Brief/i }), {
      target: { value: 'Deck de cuatro diapositivas para presentar un estudio de edición.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generar diseño/i }));
    await screen.findByTitle(/Diseño generado con Aurora/i);
    fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));
    expect(await screen.findByText(/4 página\(s\)/i)).toBeTruthy();
    const save = vi.spyOn(service, 'saveDesignPdf');
    fireEvent.click(screen.getByRole('button', { name: /Guardar PDF/i }));
    await waitFor(() =>
      expect(screen.getByText(/PDF guardado en/)).toBeTruthy(),
    );
    expect(save).toHaveBeenCalledWith('JVBERi0=', expect.any(String));
  });

  it('envía la receta elegida junto con el brief', async () => {
    const { service } = renderGenerator(vi.fn(), {
      title: 'Dashboard',
      text: '# Dashboard\n\nUsá una barra lateral y tres KPIs.',
    });
    const spy = vi.spyOn(service, 'generateDesign');
    expect(screen.getByText(/Receta: Dashboard/)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: /Brief/i }), {
      target: { value: 'Dashboard de ventas para un equipo comercial con tres métricas clave.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generar diseño/i }));
    await screen.findByTitle(/Diseño generado con Aurora/i);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        recipe: expect.stringContaining('barra lateral'),
      }),
    );
  });

  it('se cierra con Escape', async () => {
    const onClose = vi.fn();
    renderGenerator(onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
