// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { DESIGN_SELECTION_KEY } from './design-selection';
import { DesignLibraryView } from './DesignLibraryView';

const fixture = vi.hoisted(() => ({
  catalog: {
    schemaVersion: 'olyvia-open-design/v1',
    source: {
      repo: 'https://github.com/nexu-io/open-design',
      commit: 'abc123',
      license: 'Apache-2.0',
      syncedAt: '2026-10-29T00:00:00.000Z',
    },
    counts: {
      designSystems: 2,
      craft: 1,
      promptTemplates: 2,
      excludedPromptTemplates: 2,
      templates: 1,
      excludedTemplates: 0,
      skills: 1,
      excludedSkills: 0,
      hyperframes: 1,
      excludedHyperframes: 10,
    },
    designSystems: [
      {
        id: 'aurora',
        name: 'Aurora',
        category: 'SaaS',
        description: 'Interfaz luminosa para productos de datos.',
        colors: {
          bg: '#ffffff',
          surface: '#f6f8fc',
          fg: '#111827',
          muted: '#6b7280',
          border: '#d1d5db',
          accent: '#ff385c',
          'accent-on': '#ffffff',
        },
        canvas: {
          bg: '#ffffff',
          surface: '#f6f8fc',
          fg: '#111827',
          accent: '#ff385c',
          accentOn: '#ffffff',
        },
        fonts: { display: 'Inter', body: 'Inter', mono: null },
        craft: { applies: [], suggested: ['color', 'accessibility-baseline'] },
        previewPages: [
          { path: 'preview/colors.html', role: 'colors', title: 'Colors' },
        ],
        hasComponents: true,
        files: {
          design: 'DESIGN.md',
          tokens: 'tokens.css',
          designTokens: 'design-tokens.json',
          components: 'components.html',
        },
      },
      {
        id: 'brasa',
        name: 'Brasa',
        category: 'Editorial',
        description: 'Tipografía cálida para publicaciones.',
        colors: { bg: '#111111', fg: '#f5f0e6', accent: '#e07a3f' },
        canvas: {
          bg: '#111111',
          surface: '#1a1a1a',
          fg: '#f5f0e6',
          accent: '#e07a3f',
          accentOn: '#111111',
        },
        fonts: { display: 'Fraunces', body: 'Source Serif', mono: null },
        craft: { applies: [], suggested: ['typography'] },
        previewPages: [],
        hasComponents: false,
        files: {
          design: 'DESIGN.md',
          tokens: 'tokens.css',
          designTokens: null,
          components: null,
        },
      },
    ],
    craft: [
      {
        id: 'color',
        title: 'Color craft rules',
        summary: 'Paleta, contraste y disciplina de acento.',
        file: 'color.md',
        bytes: 128,
      },
    ],
    skills: [
      {
        id: 'brand-extract',
        name: 'Brand extract',
        description: 'Extrae paleta, tipografía y tono desde una marca.',
        mode: 'design',
        platform: null,
        scenario: 'design',
        category: null,
        tags: ['brand', 'tokens'],
        upstream: null,
        license: 'MIT',
        licenseFile: null,
        hasExample: false,
        previewable: false,
        generatorReady: true,
        files: {
          skill: 'skills/brand-extract/SKILL.md',
          example: null,
          license: null,
        },
      },
    ],
    templates: [
      {
        id: 'dashboard',
        name: 'Dashboard',
        description: 'Panel de administración con KPIs, navegación lateral y gráficos.',
        mode: 'prototype',
        platform: 'desktop',
        scenario: 'operations',
        category: null,
        tags: ['dashboard', 'admin'],
        upstream: null,
        license: 'Open Design (Apache-2.0)',
        licenseFile: null,
        hasExample: true,
        previewable: false,
        files: {
          skill: 'templates/dashboard/SKILL.md',
          example: 'templates/dashboard/example.html',
          license: null,
        },
      },
    ],
    hyperframes: [
      {
        id: 'frame-bold-poster',
        title: 'Bold Poster',
        summary: 'Póster editorial en movimiento.',
        category: 'Presentation',
        tags: ['poster'],
        aspect: '16:9',
        width: 1920,
        height: 1080,
        fps: 60,
        durationSec: 15,
        license: 'Apache-2.0',
        author: 'nexu-io',
        sourceUrl: null,
        preview: 'hyperframes/frame-bold-poster/preview.png',
        html: 'hyperframes/frame-bold-poster/source/index.html',
      },
    ],
    promptTemplates: [
      {
        id: 'retrato',
        surface: 'image',
        title: 'Retrato monocromo',
        summary: 'Retrato de estudio con luz dividida.',
        category: 'Profile / Avatar',
        tags: ['portrait', 'cinematic'],
        model: 'gpt-image-2',
        aspect: '1:1',
        license: 'CC-BY-4.0',
        author: 'K',
        sourceUrl: 'https://example.com/original',
        file: 'prompt-templates/image/retrato.json',
        preview: null,
      },
      {
        id: 'video-cinematic',
        surface: 'video',
        title: 'Cinematic product reveal',
        summary: 'Plano de producto con cámara lenta.',
        category: 'Cinematic',
        tags: ['product', 'cinematic'],
        model: 'seedance-2.0',
        aspect: '16:9',
        license: 'Apache-2.0',
        author: 'Open Design',
        sourceUrl: null,
        file: 'prompt-templates/video/video-cinematic.json',
        preview: null,
      },
    ],
  },
}));

vi.mock('./open-design', async () => {
  const actual = await vi.importActual<typeof import('./open-design')>('./open-design');
  return {
    ...actual,
    loadOpenDesignCatalog: vi.fn(async () => fixture.catalog),
    loadDesignSystemDoc: vi.fn(async () => '# Guía\n\nContenido de la guía.'),
    loadDesignSystemTokens: vi.fn(async () => ':root { --accent: #ff385c; }'),
    loadCraftDoc: vi.fn(async () => '# Color craft rules\n\nContraste mínimo 4.5:1.'),
    loadDesignTemplateDoc: vi.fn(async () => '# Dashboard\n\nKPIs, navegación y gráficos.'),
    loadSkillDoc: vi.fn(async () => '# Brand extract\n\nPaleta, tipografía y tono.'),
    loadPromptTemplate: vi.fn(async (entry: { id: string; title: string }) => ({
      id: entry.id,
      title: entry.title,
      prompt:
        entry.id === 'video-cinematic'
          ? 'Un plano cinematográfico de producto con cámara lenta y luz lateral.'
          : 'Un retrato monocromo con luz dividida.',
    })),
  };
});

function renderView() {
  const project = createEmptyProject('Diseño', '2026-10-29T00:00:00.000Z');
  const service = createFakeService();
  const onNavigate = vi.fn();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'diseno.editoria.json',
          path: 'C:\\tester\\diseno.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <DesignLibraryView onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { onNavigate };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('biblioteca de Diseño', () => {
  it('lista los sistemas reales del catálogo y muestra la guía', async () => {
    renderView();
    expect(await screen.findByRole('heading', { name: 'Aurora' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Sistemas 2/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Prompts 2/i })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: /Buscar en la biblioteca/i }), {
      target: { value: 'brasa' },
    });
    expect(await screen.findByRole('heading', { name: 'Brasa' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Aurora' })).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: /Buscar en la biblioteca/i }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Leer DESIGN.md/i }));
    expect(await screen.findByRole('heading', { name: 'Guía' })).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: /Crear diseño/i })[0]!);
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('usa una plantilla como receta del generador', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: /Plantillas 1/i }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByText(/no se previsualiza offline/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Usar en generador/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/Receta: Dashboard/);
  });

  it('lista skills y permite usarlas como receta aunque la búsqueda filtre sistemas', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: /Skills 1/i }));
    expect(await screen.findByRole('heading', { name: 'Brand extract' })).toBeTruthy();
    // Buscar una skill puede dejar la lista de sistemas vacía; el generador
    // debe seguir usando un sistema real del catálogo.
    fireEvent.change(screen.getByRole('searchbox', { name: /Buscar en la biblioteca/i }), {
      target: { value: 'brand' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Usar en generador/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/Receta: Brand extract/);
  });

  it('abre y cierra el extractor de paleta', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: /Extraer paleta/i }));
    expect(
      await screen.findByRole('dialog', { name: /Extraer paleta de una imagen/i }),
    ).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /Extraer paleta de una imagen/i }),
      ).toBeNull(),
    );
  });

  it('extrae paleta y tipografías desde una URL', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: /Extraer paleta/i }));
    const dialog = await screen.findByRole('dialog', { name: /Extraer paleta de una imagen/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'URL' }));
    fireEvent.change(within(dialog).getByLabelText('URL pública'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Extraer de la URL/i }));
    expect(await screen.findByText('Estudio de prueba')).toBeTruthy();
    expect(screen.getByText('Fraunces')).toBeTruthy();
    expect(screen.getByLabelText('Paleta extraída').children).toHaveLength(4);
  });

  it('aplica la paleta y navega a miniaturas', async () => {
    const { onNavigate } = renderView();
    fireEvent.click(await screen.findByRole('button', { name: /Usar en miniaturas/i }));
    expect(onNavigate).toHaveBeenCalledWith('thumbnails');
    const stored = JSON.parse(window.localStorage.getItem(DESIGN_SELECTION_KEY) ?? '{}');
    expect(stored).toMatchObject({ id: 'aurora', accent: '#ff385c' });
  });

  it('abre HyperFrames y muestra la composición real', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: /HyperFrames 1/i }));
    expect(
      await screen.findByRole('heading', {
        name: /Composiciones reales, renderizables o en preview oficial/i,
      }),
    ).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Bold Poster' })).toBeTruthy();
    expect(screen.getByText(/previews MP4/i)).toBeTruthy();
  });

  it('abre la generación de imágenes y recibe el prompt de una plantilla', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: /Imagen IA/i }));
    expect(
      await screen.findByRole('heading', { name: /Generá la imagen, no la simules/i }),
    ).toBeTruthy();
    expect(screen.getAllByText(/una imagen cada 45 segundos/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: /Prompts 2/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Generar imagen/i }));
    expect(
      (screen.getByLabelText('Prompt') as HTMLTextAreaElement).value,
    ).toBe('Un retrato monocromo con luz dividida.');
  });

  it('muestra las reglas de craft y los prompts con su licencia', async () => {
    const { onNavigate } = renderView();
    fireEvent.click(await screen.findByRole('tab', { name: /Craft/i }));
    expect(await screen.findByText(/Contraste mínimo 4\.5:1/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Prompts/i }));
    expect(
      await screen.findByText('Un retrato monocromo con luz dividida.'),
    ).toBeTruthy();
    expect(screen.getByText('CC-BY-4.0')).toBeTruthy();
    expect(screen.getByText(/Autor: K/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Video' }));
    fireEvent.click(
      await screen.findByRole('button', { name: /Cinematic product reveal/i }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Cinematic product reveal' }),
    ).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Usar en Guion/i }));
    expect(window.localStorage.getItem('editoria.aihub.brief')).toBe(
      'Un plano cinematográfico de producto con cámara lenta y luz lateral.',
    );
    expect(onNavigate).toHaveBeenCalledWith('script');
  });
});
