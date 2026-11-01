import { describe, expect, it, vi } from 'vitest';
import {
  designSystemCategories,
  designSystemPreviewUrl,
  designTemplateModes,
  filterCraft,
  filterDesignSystems,
  filterDesignTemplates,
  filterPromptTemplates,
  loadCraftDoc,
  loadDesignSystemDoc,
  loadOpenDesignCatalog,
  loadPromptTemplate,
  openDesignUrl,
  type DesignSystemEntry,
  type OpenDesignCatalog,
} from './open-design';

function system(id: string, name: string, category: string, accent = '#1f5eff'): DesignSystemEntry {
  return {
    id,
    name,
    category,
    description: `${name} para productos digitales`,
    colors: { bg: '#ffffff', fg: '#111111', accent },
    canvas: { bg: '#ffffff', surface: '#ffffff', fg: '#111111', accent, accentOn: '#ffffff' },
    fonts: { display: 'Inter', body: 'Inter', mono: null },
    craft: { applies: [], suggested: ['color'] },
    previewPages: [{ path: 'preview/colors.html', role: 'colors', title: 'Colors' }],
    hasComponents: false,
    files: { design: 'DESIGN.md', tokens: 'tokens.css', designTokens: null, components: null },
  };
}

const catalog: OpenDesignCatalog = {
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
    promptTemplates: 1,
    excludedPromptTemplates: 2,
    templates: 0,
    excludedTemplates: 0,
  },
  designSystems: [system('aurora', 'Aurora', 'SaaS'), system('brasa', 'Brasa', 'Editorial')],
  skills: [],
  templates: [
    {
      id: 'dashboard',
      name: 'Dashboard',
      description: 'Panel con KPIs y navegación lateral.',
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
    {
      id: 'pitch-deck',
      name: 'Pitch deck',
      description: 'Presentación de 16:9 para inversores.',
      mode: 'deck',
      platform: 'desktop',
      scenario: 'marketing',
      category: null,
      tags: ['deck', 'slides'],
      upstream: null,
      license: 'MIT',
      licenseFile: 'LICENSE',
      hasExample: true,
      previewable: true,
      files: {
        skill: 'templates/pitch-deck/SKILL.md',
        example: 'templates/pitch-deck/example.html',
        license: 'templates/pitch-deck/LICENSE',
      },
    },
  ],
  craft: [
    {
      id: 'color',
      title: 'Color craft rules',
      summary: 'Reglas de paleta y contraste.',
      file: 'color.md',
      bytes: 100,
    },
  ],
  promptTemplates: [
    {
      id: 'retrato',
      surface: 'image',
      title: 'Retrato monocromo',
      summary: 'Retrato de estudio.',
      category: 'Profile / Avatar',
      tags: ['portrait'],
      model: 'gpt-image-2',
      aspect: '1:1',
      license: 'CC-BY-4.0',
      author: 'K',
      sourceUrl: 'https://example.com',
      file: 'prompt-templates/image/retrato.json',
      preview: null,
    },
  ],
};

function response(body: string, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  } as Response;
}

describe('catálogo Open Design', () => {
  it('arma URLs dentro de public/open-design', () => {
    expect(openDesignUrl('catalog.json')).toBe('/open-design/catalog.json');
    expect(openDesignUrl('/craft/color.md')).toBe('/open-design/craft/color.md');
    expect(
      designSystemPreviewUrl(system('aurora', 'Aurora', 'SaaS'), 'preview/colors.html'),
    ).toBe('/open-design/design-systems/aurora/preview/colors.html');
  });

  it('valida y devuelve el catálogo con un fetcher explícito', async () => {
    const fetcher = vi.fn(async () => response(JSON.stringify(catalog)));
    const loaded = await loadOpenDesignCatalog(fetcher as unknown as typeof fetch);
    expect(loaded.designSystems).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledWith('/open-design/catalog.json');
  });

  it('rechaza un catálogo con formato desconocido', async () => {
    const fetcher = async () => response(JSON.stringify({ schemaVersion: 'otro' }));
    await expect(loadOpenDesignCatalog(fetcher as unknown as typeof fetch)).rejects.toThrow(
      /formato esperado/i,
    );
  });

  it('propaga el error HTTP de un recurso', async () => {
    const fetcher = async () => response('', { ok: false, status: 404 });
    await expect(
      loadDesignSystemDoc(system('aurora', 'Aurora', 'SaaS'), fetcher as unknown as typeof fetch),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('lee craft y prompts por su ruta relativa', async () => {
    const fetcher = vi.fn(async (url: string) =>
      response(
        url.endsWith('.json')
          ? JSON.stringify({ id: 'retrato', title: 'Retrato', prompt: 'Un retrato' })
          : '# Color\n\nRegla',
      ),
    );
    await expect(
      loadCraftDoc(catalog.craft[0]!, fetcher as unknown as typeof fetch),
    ).resolves.toContain('# Color');
    await expect(
      loadPromptTemplate(catalog.promptTemplates[0]!, fetcher as unknown as typeof fetch),
    ).resolves.toMatchObject({ prompt: 'Un retrato' });
    expect(fetcher).toHaveBeenCalledWith('/open-design/craft/color.md');
    expect(fetcher).toHaveBeenCalledWith('/open-design/prompt-templates/image/retrato.json');
  });
});

describe('filtros de la biblioteca', () => {
  it('busca sin acentos ni mayúsculas y respeta la categoría', () => {
    expect(filterDesignSystems(catalog.designSystems, 'brasa', 'Todos')).toHaveLength(1);
    expect(filterDesignSystems(catalog.designSystems, '', 'SaaS').map((entry) => entry.id)).toEqual([
      'aurora',
    ]);
    expect(filterDesignSystems(catalog.designSystems, 'editorial', 'Todos')).toHaveLength(1);
  });

  it('ordena las categorías por cantidad y nombre', () => {
    expect(designSystemCategories(catalog.designSystems)).toEqual(['Editorial', 'SaaS']);
  });

  it('filtra plantillas por texto y tipo, y ordena sus modos', () => {
    expect(filterDesignTemplates(catalog.templates, 'dashboard', 'Todos')).toHaveLength(1);
    expect(filterDesignTemplates(catalog.templates, '', 'deck').map((entry) => entry.id)).toEqual([
      'pitch-deck',
    ]);
    expect(filterDesignTemplates(catalog.templates, 'inversores', 'Todos')).toHaveLength(1);
    expect(designTemplateModes(catalog.templates)).toEqual(['deck', 'prototype']);
  });

  it('filtra reglas y prompts por texto', () => {
    expect(filterCraft(catalog.craft, 'contraste')).toHaveLength(1);
    expect(filterCraft(catalog.craft, 'tipografía')).toHaveLength(0);
    expect(filterPromptTemplates(catalog.promptTemplates, 'retrato', 'all')).toHaveLength(1);
    expect(filterPromptTemplates(catalog.promptTemplates, 'retrato', 'video')).toHaveLength(0);
    expect(filterPromptTemplates(catalog.promptTemplates, 'gpt-image', 'image')).toHaveLength(1);
  });
});
