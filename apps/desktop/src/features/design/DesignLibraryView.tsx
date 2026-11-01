import { useEffect, useMemo, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import type { DesignFormat } from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import { writeClipboard } from './clipboard';
import { applyDesignSystem } from './design-selection';
import { DesignGenerator } from './DesignGenerator';
import { DesignImageGenerator } from './DesignImageGenerator';
import { HyperframeView } from './HyperframeView';
import { PaletteExtractor } from './PaletteExtractor';
import { parseMarkdown, type MarkdownBlock } from './markdown';
import {
  designCategoryLabel,
  designSystemCategories,
  designSystemComponentsUrl,
  designSystemPreviewUrl,
  designTemplateExampleUrl,
  designTemplateModes,
  filterCraft,
  filterDesignSystems,
  filterDesignTemplates,
  filterPromptTemplates,
  filterSkills,
  loadCraftDoc,
  loadDesignSystemDoc,
  loadDesignSystemTokens,
  loadDesignTemplateDoc,
  loadOpenDesignCatalog,
  loadPromptTemplate,
  loadSkillDoc,
  openDesignUrl,
  skillExampleUrl,
  skillModes,
  templateModeLabel,
  type DesignSkillEntry,
  type DesignSystemEntry,
  type DesignTemplateEntry,
  type OpenDesignCatalog,
  type PromptTemplateDetail,
} from './open-design';
import './design.css';

type DesignTab =
  | 'systems'
  | 'craft'
  | 'prompts'
  | 'templates'
  | 'skills'
  | 'images'
  | 'hyperframes';

function MarkdownBlockView({ block }: { readonly block: MarkdownBlock }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = block.level <= 2 ? 'h2' : 'h3';
      return <Tag>{block.text}</Tag>;
    }
    case 'paragraph':
      return <p>{block.text}</p>;
    case 'list':
      return block.ordered ? (
        <ol>
          {block.items.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul>
          {block.items.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ul>
      );
    case 'quote':
      return <blockquote>{block.text}</blockquote>;
    case 'code':
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
    case 'table':
      return (
        <div className="design-table-wrap">
          <table>
            <thead>
              <tr>
                {block.headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr />;
    default:
      return null;
  }
}

function DesignDoc({ source }: { readonly source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="design-doc">
      {blocks.map((block, index) => (
        <MarkdownBlockView key={index} block={block} />
      ))}
    </div>
  );
}

function systemSwatches(entry: DesignSystemEntry): readonly { key: string; value: string }[] {
  const preferred = ['bg', 'surface', 'fg', 'muted', 'border', 'accent', 'accent-on', 'success', 'warn', 'danger'];
  return preferred
    .filter((key) => entry.colors[key])
    .map((key) => ({ key, value: entry.colors[key]! }));
}

export function DesignLibraryView({
  onNavigate,
}: {
  readonly onNavigate: (id: ViewId) => void;
}) {
  const store = useProjectStore();
  const [catalog, setCatalog] = useState<OpenDesignCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [tab, setTab] = useState<DesignTab>('systems');
  const [imagePrompt, setImagePrompt] = useState<{ text: string; key: number } | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todos');
  const [promptSurface, setPromptSurface] = useState<'all' | 'image' | 'video'>('all');
  const [systemId, setSystemId] = useState<string | null>(null);
  const [craftId, setCraftId] = useState<string | null>(null);
  const [promptId, setPromptId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateMode, setTemplateMode] = useState('Todos');
  const [templateDocOpen, setTemplateDocOpen] = useState(false);
  const [templateDoc, setTemplateDoc] = useState<{ id: string; text: string } | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templatePreview, setTemplatePreview] = useState(false);
  const [skillId, setSkillId] = useState<string | null>(null);
  const [skillMode, setSkillMode] = useState('Todos');
  const [skillDocOpen, setSkillDocOpen] = useState(false);
  const [skillDoc, setSkillDoc] = useState<{ id: string; text: string } | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillPreview, setSkillPreview] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [doc, setDoc] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [componentsOpen, setComponentsOpen] = useState(false);
  const [craftDoc, setCraftDoc] = useState<{ id: string; text: string } | null>(null);
  const [craftError, setCraftError] = useState<string | null>(null);
  const [promptDetail, setPromptDetail] = useState<{
    id: string;
    data: PromptTemplateDetail;
  } | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generatorRecipe, setGeneratorRecipe] = useState<{
    title: string;
    text: string;
  } | null>(null);
  const [generatorFormat, setGeneratorFormat] = useState<DesignFormat>('page');
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setCatalogError(null);
    loadOpenDesignCatalog()
      .then((data) => {
        if (!active) return;
        setCatalog(data);
        setSystemId((current) => current ?? data.designSystems[0]?.id ?? null);
        setCraftId((current) => current ?? data.craft[0]?.id ?? null);
        setPromptId((current) => current ?? data.promptTemplates[0]?.id ?? null);
        setTemplateId((current) => current ?? data.templates[0]?.id ?? null);
        setSkillId((current) => current ?? data.skills[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setCatalogError(error instanceof Error ? error.message : 'No se pudo abrir la biblioteca.');
      });
    return () => {
      active = false;
    };
  }, [reloads]);

  const systems = useMemo(
    () => (catalog ? filterDesignSystems(catalog.designSystems, query, category) : []),
    [catalog, query, category],
  );
  const crafts = useMemo(
    () => (catalog ? filterCraft(catalog.craft, query) : []),
    [catalog, query],
  );
  const prompts = useMemo(
    () => (catalog ? filterPromptTemplates(catalog.promptTemplates, query, promptSurface) : []),
    [catalog, query, promptSurface],
  );
  const templates = useMemo(
    () => (catalog ? filterDesignTemplates(catalog.templates, query, templateMode) : []),
    [catalog, query, templateMode],
  );
  const selectedSystem =
    systems.find((entry) => entry.id === systemId) ?? systems[0] ?? null;
  // El generador no debe depender del filtro de búsqueda: buscar una skill o
  // una plantilla puede dejar la lista de sistemas vacía sin que el catálogo
  // deje de tener sistemas utilizables.
  const generatorSystem =
    catalog?.designSystems.find((entry) => entry.id === systemId) ??
    catalog?.designSystems[0] ??
    null;
  const selectedCraft = crafts.find((entry) => entry.id === craftId) ?? crafts[0] ?? null;
  const selectedPrompt = prompts.find((entry) => entry.id === promptId) ?? prompts[0] ?? null;
  const skills = useMemo(
    () => (catalog ? filterSkills(catalog.skills, query, skillMode) : []),
    [catalog, query, skillMode],
  );
  const selectedTemplate =
    templates.find((entry) => entry.id === templateId) ?? templates[0] ?? null;
  const selectedSkill = skills.find((entry) => entry.id === skillId) ?? skills[0] ?? null;
  const categories = useMemo(
    () => (catalog ? designSystemCategories(catalog.designSystems) : []),
    [catalog],
  );
  const templateModes = useMemo(
    () => (catalog ? designTemplateModes(catalog.templates) : []),
    [catalog],
  );
  const skillModeOptions = useMemo(
    () => (catalog ? skillModes(catalog.skills) : []),
    [catalog],
  );

  // Al cambiar de sistema se cierra la vista previa y se descarta la guía.
  useEffect(() => {
    setDocOpen(false);
    setDoc(null);
    setDocError(null);
    setPreviewPath(null);
    setComponentsOpen(false);
  }, [selectedSystem?.id]);

  useEffect(() => {
    if (tab !== 'systems' || !selectedSystem || !docOpen) return;
    let active = true;
    setDoc(null);
    setDocError(null);
    loadDesignSystemDoc(selectedSystem)
      .then((text) => {
        if (active) setDoc(text);
      })
      .catch((error: unknown) => {
        if (active) setDocError(error instanceof Error ? error.message : 'No se pudo abrir la guía.');
      });
    return () => {
      active = false;
    };
  }, [tab, selectedSystem, docOpen]);

  useEffect(() => {
    if (tab !== 'craft' || !selectedCraft) return;
    let active = true;
    setCraftError(null);
    setCraftDoc(null);
    loadCraftDoc(selectedCraft)
      .then((text) => {
        if (active) setCraftDoc({ id: selectedCraft.id, text });
      })
      .catch((error: unknown) => {
        if (active) setCraftError(error instanceof Error ? error.message : 'No se pudo abrir la regla.');
      });
    return () => {
      active = false;
    };
  }, [tab, selectedCraft]);

  useEffect(() => {
    setTemplateDocOpen(false);
    setTemplateDoc(null);
    setTemplateError(null);
    setTemplatePreview(false);
  }, [selectedTemplate?.id]);

  useEffect(() => {
    if (tab !== 'templates' || !selectedTemplate || !templateDocOpen) return;
    let active = true;
    setTemplateError(null);
    setTemplateDoc(null);
    loadDesignTemplateDoc(selectedTemplate)
      .then((text) => {
        if (active) setTemplateDoc({ id: selectedTemplate.id, text });
      })
      .catch((error: unknown) => {
        if (active) {
          setTemplateError(error instanceof Error ? error.message : 'No se pudo abrir la receta.');
        }
      });
    return () => {
      active = false;
    };
  }, [tab, selectedTemplate, templateDocOpen]);

  useEffect(() => {
    setSkillDocOpen(false);
    setSkillDoc(null);
    setSkillError(null);
    setSkillPreview(false);
  }, [selectedSkill?.id]);

  useEffect(() => {
    if (tab !== 'skills' || !selectedSkill || !skillDocOpen) return;
    let active = true;
    setSkillError(null);
    setSkillDoc(null);
    loadSkillDoc(selectedSkill)
      .then((text) => {
        if (active) setSkillDoc({ id: selectedSkill.id, text });
      })
      .catch((error: unknown) => {
        if (active) {
          setSkillError(error instanceof Error ? error.message : 'No se pudo abrir la skill.');
        }
      });
    return () => {
      active = false;
    };
  }, [tab, selectedSkill, skillDocOpen]);

  useEffect(() => {
    if (tab !== 'prompts' || !selectedPrompt) return;
    let active = true;
    setPromptError(null);
    setPromptDetail(null);
    loadPromptTemplate(selectedPrompt)
      .then((data) => {
        if (active) setPromptDetail({ id: selectedPrompt.id, data });
      })
      .catch((error: unknown) => {
        if (active) setPromptError(error instanceof Error ? error.message : 'No se pudo abrir la plantilla.');
      });
    return () => {
      active = false;
    };
  }, [tab, selectedPrompt]);

  function changeTab(next: DesignTab): void {
    setTab(next);
    setQuery('');
    setCategory('Todos');
  }

  async function copy(text: string, label: string): Promise<void> {
    const copied = await writeClipboard(text);
    store.setNotice(copied ? `${label} copiado.` : `No se pudo copiar ${label.toLowerCase()}.`);
  }

  function openGenerator(format: DesignFormat = 'page'): void {
    setGeneratorFormat(format);
    setGeneratorOpen(true);
  }

  async function useTemplateInGenerator(entry: DesignTemplateEntry): Promise<void> {
    try {
      const text = await loadDesignTemplateDoc(entry);
      setGeneratorRecipe({ title: entry.name, text });
      openGenerator(entry.mode === 'deck' ? 'deck' : entry.mode === 'image' ? 'card' : 'page');
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'No se pudo abrir la receta.');
    }
  }

  async function useSkillInGenerator(entry: DesignSkillEntry): Promise<void> {
    try {
      const text = await loadSkillDoc(entry);
      setGeneratorRecipe({ title: entry.name, text });
      openGenerator(entry.mode === 'deck' ? 'deck' : entry.mode === 'image' ? 'card' : 'page');
    } catch (error) {
      setSkillError(error instanceof Error ? error.message : 'No se pudo abrir la skill.');
    }
  }

  async function copySkill(entry: DesignSkillEntry): Promise<void> {
    try {
      const text = skillDoc?.id === entry.id ? skillDoc.text : await loadSkillDoc(entry);
      await copy(text, `skill ${entry.name}`);
    } catch (error) {
      setSkillError(error instanceof Error ? error.message : 'No se pudo leer la skill.');
    }
  }

  async function copyTemplate(entry: DesignTemplateEntry): Promise<void> {
    try {
      const text = templateDoc?.id === entry.id ? templateDoc.text : await loadDesignTemplateDoc(entry);
      await copy(text, `receta ${entry.name}`);
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'No se pudo leer la receta.');
    }
  }

  async function copyTokens(entry: DesignSystemEntry): Promise<void> {
    try {
      const css = await loadDesignSystemTokens(entry);
      await copy(css, `tokens.css de ${entry.name}`);
    } catch (error) {
      setDocError(error instanceof Error ? error.message : 'No se pudieron leer los tokens.');
    }
  }

  function useInThumbnails(entry: DesignSystemEntry): void {
    const selection = applyDesignSystem(entry);
    if (!selection) {
      setDocError('Este sistema no declara un acento sólido que la miniatura pueda usar.');
      return;
    }
    store.setNotice(`Paleta ${entry.name} aplicada a Miniaturas.`);
    onNavigate('thumbnails');
  }

  const counts = catalog?.counts;

  return (
    <div className="view design-view">
      <header className="design-hero">
        <div className="design-hero-copy">
          <span className="design-kicker">
            <Icon name="palette" size={13} />
            Open Design · Apache-2.0
          </span>
          <h1>Diseño</h1>
          <p>
            152 sistemas, 11 reglas de craft, 189 prompts —incluidas 108 plantillas de
            imagen y video—, 154 plantillas, 131 skills, 13 HyperFrames renderizables y
            9 previews de composiciones con runtime de Open Design. Todo vive dentro
            de Olyvia y funciona sin conexión.
          </p>
          <div className="design-hero-actions">
            <button
              type="button"
              className="primary icon-text"
              onClick={() => openGenerator()}
              disabled={!generatorSystem}
            >
              <Icon name="sparkles" size={14} />
              <span>Crear diseño</span>
            </button>
            <button
              type="button"
              className="ghost icon-text"
              onClick={() => setPaletteOpen(true)}
            >
              <Icon name="palette" size={14} />
              <span>Extraer paleta</span>
            </button>
            <span>Brief → HTML autocontenido con el proveedor de Ajustes → IA.</span>
          </div>
        </div>
        <dl className="design-stats" aria-label="Contenido de la biblioteca">
          <div>
            <dt>Sistemas</dt>
            <dd>{counts?.designSystems ?? '—'}</dd>
          </div>
          <div>
            <dt>Reglas</dt>
            <dd>{counts?.craft ?? '—'}</dd>
          </div>
          <div>
            <dt>Prompts</dt>
            <dd>{counts?.promptTemplates ?? '—'}</dd>
          </div>
          <div>
            <dt>Plantillas</dt>
            <dd>{counts?.templates ?? '—'}</dd>
          </div>
          <div>
            <dt>Skills</dt>
            <dd>{counts?.skills ?? '—'}</dd>
          </div>
        </dl>
      </header>

      <div className="design-tabs" role="tablist" aria-label="Biblioteca de diseño">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'systems'}
          className={tab === 'systems' ? 'active' : ''}
          onClick={() => changeTab('systems')}
        >
          Sistemas <span>{counts?.designSystems ?? 0}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'craft'}
          className={tab === 'craft' ? 'active' : ''}
          onClick={() => changeTab('craft')}
        >
          Craft <span>{counts?.craft ?? 0}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'prompts'}
          className={tab === 'prompts' ? 'active' : ''}
          onClick={() => changeTab('prompts')}
        >
          Prompts <span>{counts?.promptTemplates ?? 0}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'templates'}
          className={tab === 'templates' ? 'active' : ''}
          onClick={() => changeTab('templates')}
        >
          Plantillas <span>{counts?.templates ?? 0}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'skills'}
          className={tab === 'skills' ? 'active' : ''}
          onClick={() => changeTab('skills')}
        >
          Skills <span>{counts?.skills ?? 0}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'images'}
          className={tab === 'images' ? 'active' : ''}
          onClick={() => changeTab('images')}
        >
          Imagen IA <span>Nuevo</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'hyperframes'}
          className={tab === 'hyperframes' ? 'active' : ''}
          onClick={() => changeTab('hyperframes')}
        >
          HyperFrames <span>{counts?.hyperframes ?? 0}</span>
        </button>
      </div>

      {tab !== 'images' && tab !== 'hyperframes' ? (
      <div className="design-toolbar">
        <label className="design-search">
          <Icon name="search" size={14} />
          <input
            type="search"
            value={query}
            placeholder={
              tab === 'systems'
                ? 'Buscar por marca, categoría o estilo…'
                : tab === 'craft'
                  ? 'Buscar una regla de craft…'
                  : tab === 'templates'
                    ? 'Buscar una plantilla por tipo, público o etiqueta…'
                    : tab === 'skills'
                      ? 'Buscar una skill por nombre, modo o etiqueta…'
                      : 'Buscar por título, modelo o etiqueta…'
            }
            aria-label="Buscar en la biblioteca de diseño"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button type="button" className="design-clear" aria-label="Limpiar búsqueda" onClick={() => setQuery('')}>
              <Icon name="close" size={12} />
            </button>
          ) : null}
        </label>
        {tab === 'systems' ? (
          <div className="design-categories" role="group" aria-label="Filtrar por categoría">
            {['Todos', ...categories].map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={category === item}
                className={category === item ? 'active' : ''}
                onClick={() => setCategory(item)}
              >
                {item === 'Todos' ? item : designCategoryLabel(item)}
              </button>
            ))}
          </div>
        ) : tab === 'prompts' ? (
          <div className="design-categories" role="group" aria-label="Filtrar por formato">
            {[
              { id: 'all' as const, label: 'Todas' },
              { id: 'image' as const, label: 'Imagen' },
              { id: 'video' as const, label: 'Video' },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={promptSurface === option.id}
                className={promptSurface === option.id ? 'active' : ''}
                onClick={() => setPromptSurface(option.id)}
              >
                {option.label}
              </button>
            ))}
            <span className="design-result-count">{prompts.length} plantillas</span>
          </div>
        ) : tab === 'templates' ? (
          <div className="design-categories" role="group" aria-label="Filtrar por tipo de plantilla">
            {['Todos', ...templateModes].map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={templateMode === mode}
                className={templateMode === mode ? 'active' : ''}
                onClick={() => setTemplateMode(mode)}
              >
                {mode === 'Todos' ? mode : templateModeLabel(mode)}
              </button>
            ))}
            <span className="design-result-count">{templates.length} recetas</span>
          </div>
        ) : tab === 'skills' ? (
          <div className="design-categories" role="group" aria-label="Filtrar por modo de skill">
            {['Todos', ...skillModeOptions].map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={skillMode === mode}
                className={skillMode === mode ? 'active' : ''}
                onClick={() => setSkillMode(mode)}
              >
                {mode === 'Todos' ? mode : templateModeLabel(mode)}
              </button>
            ))}
            <span className="design-result-count">{skills.length} skills</span>
          </div>
        ) : (
          <span className="design-result-count">{crafts.length} reglas</span>
        )}
      </div>
      ) : null}

      {tab === 'images' ? (
        <DesignImageGenerator initialPrompt={imagePrompt} onNavigate={onNavigate} />
      ) : null}

      {tab === 'hyperframes' ? (
        <HyperframeView
          entries={catalog?.hyperframes ?? []}
          previews={catalog?.hyperframePreviews ?? []}
          onNavigate={onNavigate}
        />
      ) : null}

      {catalogError ? (
        <div className="design-state" role="alert">
          <strong>La biblioteca no está disponible.</strong>
          <p>{catalogError}</p>
          <button type="button" className="ghost icon-text" onClick={() => setReloads((value) => value + 1)}>
            <Icon name="refresh" size={14} />
            <span>Reintentar</span>
          </button>
        </div>
      ) : null}

      {!catalog && !catalogError ? (
        <div className="design-state" role="status">
          <span className="design-spinner" aria-hidden="true" />
          <p>Cargando sistemas, reglas y prompts…</p>
        </div>
      ) : null}

      {catalog && tab !== 'images' && tab !== 'hyperframes' ? (
        <div className="design-body">
          <div className="design-list-column">
            {tab === 'systems' ? (
              <ul className="design-list" aria-label="Sistemas de diseño">
                {systems.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-current={selectedSystem?.id === entry.id ? 'true' : undefined}
                      className={selectedSystem?.id === entry.id ? 'active' : ''}
                      onClick={() => setSystemId(entry.id)}
                    >
                      <span className="design-list-swatches" aria-hidden="true">
                        {['bg', 'surface', 'accent', 'fg'].map((key) =>
                          entry.colors[key] ? (
                            <i key={key} style={{ background: entry.colors[key] }} />
                          ) : null,
                        )}
                      </span>
                      <span className="design-list-copy">
                        <strong>{entry.name}</strong>
                        <small>{designCategoryLabel(entry.category)}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {tab === 'craft' ? (
              <ul className="design-list" aria-label="Reglas de craft">
                {crafts.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-current={selectedCraft?.id === entry.id ? 'true' : undefined}
                      className={selectedCraft?.id === entry.id ? 'active' : ''}
                      onClick={() => setCraftId(entry.id)}
                    >
                      <span className="design-list-icon" aria-hidden="true">
                        <Icon name="learn" size={15} />
                      </span>
                      <span className="design-list-copy">
                        <strong>{entry.title}</strong>
                        <small>{entry.summary || 'Regla de oficio'}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {tab === 'prompts' ? (
              <ul className="design-list" aria-label="Plantillas de prompt">
                {prompts.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-current={selectedPrompt?.id === entry.id ? 'true' : undefined}
                      className={selectedPrompt?.id === entry.id ? 'active' : ''}
                      onClick={() => setPromptId(entry.id)}
                    >
                      <span className="design-list-badge" aria-hidden="true">
                        {entry.surface === 'image' ? 'IMG' : 'VID'}
                      </span>
                      <span className="design-list-copy">
                        <strong>{entry.title}</strong>
                        <small>{entry.category}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {tab === 'templates' ? (
              <ul className="design-list" aria-label="Plantillas de diseño">
                {templates.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-current={selectedTemplate?.id === entry.id ? 'true' : undefined}
                      className={selectedTemplate?.id === entry.id ? 'active' : ''}
                      onClick={() => setTemplateId(entry.id)}
                    >
                      <span className="design-list-badge" aria-hidden="true">
                        {templateModeLabel(entry.mode).slice(0, 3).toUpperCase()}
                      </span>
                      <span className="design-list-copy">
                        <strong>{entry.name}</strong>
                        <small>
                          {templateModeLabel(entry.mode)}
                          {entry.scenario ? ` · ${entry.scenario}` : ''}
                          {entry.previewable ? '' : ' · sin preview offline'}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {tab === 'skills' ? (
              <ul className="design-list" aria-label="Skills de Open Design">
                {skills.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-current={selectedSkill?.id === entry.id ? 'true' : undefined}
                      className={selectedSkill?.id === entry.id ? 'active' : ''}
                      onClick={() => setSkillId(entry.id)}
                    >
                      <span className="design-list-badge" aria-hidden="true">
                        {templateModeLabel(entry.mode).slice(0, 3).toUpperCase()}
                      </span>
                      <span className="design-list-copy">
                        <strong>{entry.name}</strong>
                        <small>
                          {templateModeLabel(entry.mode)}
                          {entry.generatorReady ? ' · receta' : ' · referencia'}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {tab === 'systems' && systems.length === 0 ? (
              <p className="design-empty">Ningún sistema coincide con «{query}».</p>
            ) : null}
            {tab === 'craft' && crafts.length === 0 ? (
              <p className="design-empty">Ninguna regla coincide con «{query}».</p>
            ) : null}
            {tab === 'prompts' && prompts.length === 0 ? (
              <p className="design-empty">Ninguna plantilla coincide con «{query}».</p>
            ) : null}
            {tab === 'templates' && templates.length === 0 ? (
              <p className="design-empty">Ninguna receta coincide con «{query}».</p>
            ) : null}
            {tab === 'skills' && skills.length === 0 ? (
              <p className="design-empty">Ninguna skill coincide con «{query}».</p>
            ) : null}
          </div>

          <section className="design-detail" aria-live="polite">
            {tab === 'systems' && selectedSystem ? (
              <>
                <div className="design-detail-head">
                  <div>
                    <span className="design-detail-kicker">
                      {designCategoryLabel(selectedSystem.category)}
                    </span>
                    <h2>{selectedSystem.name}</h2>
                    <p>{selectedSystem.description}</p>
                  </div>
                  <div className="design-detail-actions">
                    <button
                      type="button"
                      className="primary icon-text"
                      onClick={() => openGenerator()}
                    >
                      <Icon name="sparkles" size={14} />
                      <span>Crear diseño</span>
                    </button>
                    <button
                      type="button"
                      className="ghost icon-text"
                      onClick={() => useInThumbnails(selectedSystem)}
                      disabled={!selectedSystem.canvas.accent}
                      title={
                        selectedSystem.canvas.accent
                          ? 'Aplicar este acento a la miniatura'
                          : 'El sistema no declara un acento sólido'
                      }
                    >
                      <Icon name="thumbnails" size={14} />
                      <span>Usar en miniaturas</span>
                    </button>
                    <button
                      type="button"
                      className="ghost icon-text"
                      onClick={() => void copyTokens(selectedSystem)}
                    >
                      <Icon name="copy" size={14} />
                      <span>Copiar tokens</span>
                    </button>
                    <button
                      type="button"
                      className={docOpen ? 'ghost active icon-text' : 'ghost icon-text'}
                      aria-expanded={docOpen}
                      onClick={() => setDocOpen((open) => !open)}
                    >
                      <Icon name="text" size={14} />
                      <span>{docOpen ? 'Ocultar guía' : 'Leer DESIGN.md'}</span>
                    </button>
                  </div>
                </div>

                <div className="design-palette" aria-label={`Paleta de ${selectedSystem.name}`}>
                  {systemSwatches(selectedSystem).map((swatch) => (
                    <div key={swatch.key} className="design-swatch">
                      <span style={{ background: swatch.value }} aria-hidden="true" />
                      <code>{swatch.key}</code>
                      <small>{swatch.value}</small>
                    </div>
                  ))}
                </div>

                <div className="design-meta-grid">
                  <div>
                    <span>Tipografía</span>
                    <strong>{selectedSystem.fonts.display ?? selectedSystem.fonts.body ?? 'Del sistema'}</strong>
                    <small>{selectedSystem.fonts.body ?? 'Sin fuente de cuerpo declarada'}</small>
                  </div>
                  <div>
                    <span>Craft sugerido</span>
                    {selectedSystem.craft.suggested.length > 0 ? (
                      <div className="design-craft-links">
                        {selectedSystem.craft.suggested.map((id) => {
                          const entry = catalog.craft.find((rule) => rule.id === id);
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => {
                                setTab('craft');
                                setQuery('');
                                setCraftId(id);
                              }}
                            >
                              {entry?.title ?? id}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <strong>Ninguno</strong>
                    )}
                    <small>
                      {selectedSystem.previewPages.length > 0
                        ? `${selectedSystem.previewPages.length} vistas previas incluidas`
                        : 'Sin vistas previas'}
                    </small>
                  </div>
                </div>

                <div className="design-preview-actions">
                  {selectedSystem.previewPages.map((page) => (
                    <button
                      key={page.path}
                      type="button"
                      className={previewPath === page.path ? 'active' : ''}
                      aria-pressed={previewPath === page.path}
                      onClick={() => {
                        setPreviewPath(previewPath === page.path ? null : page.path);
                        setComponentsOpen(false);
                      }}
                    >
                      <Icon name="eye" size={13} />
                      {page.title}
                    </button>
                  ))}
                  {selectedSystem.hasComponents ? (
                    <button
                      type="button"
                      className={componentsOpen ? 'active' : ''}
                      aria-pressed={componentsOpen}
                      onClick={() => {
                        setComponentsOpen((open) => !open);
                        setPreviewPath(null);
                      }}
                    >
                      <Icon name="layers" size={13} />
                      Componentes
                    </button>
                  ) : null}
                </div>

                {previewPath ? (
                  <div className="design-preview">
                    <iframe
                      title={`Vista previa ${previewPath} de ${selectedSystem.name}`}
                      sandbox=""
                      src={designSystemPreviewUrl(selectedSystem, previewPath)}
                    />
                  </div>
                ) : null}

                {componentsOpen ? (
                  <div className="design-preview design-preview-components">
                    <p className="design-preview-note">
                      Demo interactiva aislada del paquete. Los scripts corren en un sandbox sin
                      acceso a Olyvia.
                    </p>
                    <iframe
                      title={`Componentes de ${selectedSystem.name}`}
                      sandbox="allow-scripts"
                      src={designSystemComponentsUrl(selectedSystem)}
                    />
                  </div>
                ) : null}

                {docError ? (
                  <p className="design-inline-error" role="alert">
                    {docError}
                  </p>
                ) : null}

                {docOpen ? (
                  doc ? (
                    <div className="design-doc-panel">
                      <DesignDoc source={doc} />
                    </div>
                  ) : (
                    <p className="design-empty" role="status">
                      Cargando la guía del sistema…
                    </p>
                  )
                ) : null}

                <footer className="design-source">
                  Paquete Open Design · {selectedSystem.files.design ? 'DESIGN.md incluido' : 'tokens incluidos'} ·{' '}
                  <a
                    href={`${catalog.source.repo}/tree/main/design-systems/${selectedSystem.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ver fuente <Icon name="external" size={11} />
                  </a>
                </footer>
              </>
            ) : null}

            {tab === 'craft' && selectedCraft ? (
              <>
                <div className="design-detail-head">
                  <div>
                    <span className="design-detail-kicker">Regla de craft</span>
                    <h2>{selectedCraft.title}</h2>
                    <p>{selectedCraft.summary}</p>
                  </div>
                  <div className="design-detail-actions">
                    <button
                      type="button"
                      className="primary icon-text"
                      disabled={!craftDoc}
                      onClick={() => craftDoc && void copy(craftDoc.text, selectedCraft.title)}
                    >
                      <Icon name="copy" size={14} />
                      <span>Copiar regla</span>
                    </button>
                  </div>
                </div>
                {craftError ? (
                  <p className="design-inline-error" role="alert">
                    {craftError}
                  </p>
                ) : null}
                {craftDoc && craftDoc.id === selectedCraft.id ? (
                  <div className="design-doc-panel">
                    <DesignDoc source={craftDoc.text} />
                  </div>
                ) : (
                  <p className="design-empty" role="status">
                    Cargando la regla…
                  </p>
                )}
                <footer className="design-source">
                  Reglas universales de Open Design · algunas adaptadas de refero_skill (MIT).
                </footer>
              </>
            ) : null}

            {tab === 'prompts' && selectedPrompt ? (
              <>
                <div className="design-detail-head">
                  <div>
                    <span className="design-detail-kicker">
                      {selectedPrompt.surface === 'image' ? 'Imagen' : 'Video'} ·{' '}
                      {selectedPrompt.category}
                    </span>
                    <h2>{selectedPrompt.title}</h2>
                    <p>{selectedPrompt.summary}</p>
                  </div>
                  <div className="design-detail-actions">
                    <button
                      type="button"
                      className="primary icon-text"
                      disabled={!promptDetail || promptDetail.id !== selectedPrompt.id}
                      onClick={() =>
                        promptDetail && void copy(promptDetail.data.prompt, 'Prompt')
                      }
                    >
                      <Icon name="copy" size={14} />
                      <span>Copiar prompt</span>
                    </button>
                    {selectedPrompt.surface === 'image' ? (
                      <button
                        type="button"
                        className="ghost icon-text"
                        disabled={!promptDetail || promptDetail.id !== selectedPrompt.id}
                        onClick={() => {
                          if (!promptDetail || promptDetail.id !== selectedPrompt.id) return;
                          setImagePrompt({ text: promptDetail.data.prompt, key: Date.now() });
                          setTab('images');
                        }}
                      >
                        <Icon name="sparkles" size={14} />
                        <span>Generar imagen</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ghost icon-text"
                        disabled={!promptDetail || promptDetail.id !== selectedPrompt.id}
                        onClick={() => {
                          if (!promptDetail || promptDetail.id !== selectedPrompt.id) return;
                          try {
                            window.localStorage.setItem(
                              'editoria.aihub.brief',
                              promptDetail.data.prompt.slice(0, 4_000),
                            );
                          } catch {
                            store.setNotice('No se pudo guardar el brief para Guion.');
                            return;
                          }
                          store.setNotice('Prompt enviado a Guion como brief.');
                          onNavigate('script');
                        }}
                      >
                        <Icon name="script" size={14} />
                        <span>Usar en Guion</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="design-chips">
                  <span>{selectedPrompt.model ?? 'modelo libre'}</span>
                  <span>{selectedPrompt.aspect ?? 'libre'}</span>
                  <span>{selectedPrompt.license}</span>
                  {selectedPrompt.tags.slice(0, 6).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                {promptError ? (
                  <p className="design-inline-error" role="alert">
                    {promptError}
                  </p>
                ) : null}
                {promptDetail && promptDetail.id === selectedPrompt.id ? (
                  <div className="design-prompt">
                    <pre>{promptDetail.data.prompt}</pre>
                  </div>
                ) : (
                  <p className="design-empty" role="status">
                    Cargando el prompt…
                  </p>
                )}
                {selectedPrompt.preview ? (
                  <img
                    className="design-prompt-preview"
                    src={openDesignUrl(selectedPrompt.preview)}
                    alt={`Referencia visual de ${selectedPrompt.title}`}
                    loading="lazy"
                  />
                ) : null}
                <footer className="design-source">
                  {selectedPrompt.author ? (
                    <>
                      Autor: {selectedPrompt.author} · {selectedPrompt.license}
                      {selectedPrompt.sourceUrl ? (
                        <>
                          {' '}·{' '}
                          <a href={selectedPrompt.sourceUrl} target="_blank" rel="noreferrer">
                            ver original <Icon name="external" size={11} />
                          </a>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>Licencia {selectedPrompt.license} · fuente en catalog.json</>
                  )}
                </footer>
              </>
            ) : null}

            {tab === 'templates' && selectedTemplate ? (
              <>
                <div className="design-detail-head">
                  <div>
                    <span className="design-detail-kicker">
                      Plantilla · {templateModeLabel(selectedTemplate.mode)}
                    </span>
                    <h2>{selectedTemplate.name}</h2>
                    <p>{selectedTemplate.description}</p>
                  </div>
                  <div className="design-detail-actions">
                    <button
                      type="button"
                      className="primary icon-text"
                      onClick={() => void useTemplateInGenerator(selectedTemplate)}
                    >
                      <Icon name="sparkles" size={14} />
                      <span>Usar en generador</span>
                    </button>
                    <button
                      type="button"
                      className="ghost icon-text"
                      aria-expanded={templateDocOpen}
                      onClick={() => setTemplateDocOpen((open) => !open)}
                    >
                      <Icon name="text" size={14} />
                      <span>{templateDocOpen ? 'Ocultar receta' : 'Leer receta'}</span>
                    </button>
                    <button
                      type="button"
                      className="ghost icon-text"
                      onClick={() => void copyTemplate(selectedTemplate)}
                    >
                      <Icon name="copy" size={14} />
                      <span>Copiar receta</span>
                    </button>
                    {selectedTemplate.previewable && selectedTemplate.files.example ? (
                      <button
                        type="button"
                        className={templatePreview ? 'ghost active icon-text' : 'ghost icon-text'}
                        aria-pressed={templatePreview}
                        onClick={() => setTemplatePreview((open) => !open)}
                      >
                        <Icon name="eye" size={14} />
                        <span>{templatePreview ? 'Ocultar ejemplo' : 'Ver ejemplo'}</span>
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="design-chips">
                  <span>{templateModeLabel(selectedTemplate.mode)}</span>
                  {selectedTemplate.platform ? <span>{selectedTemplate.platform}</span> : null}
                  {selectedTemplate.scenario ? <span>{selectedTemplate.scenario}</span> : null}
                  <span>{selectedTemplate.license}</span>
                  {selectedTemplate.tags.slice(0, 6).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>

                {!selectedTemplate.previewable ? (
                  <p className="design-generator-warning" role="status">
                    El ejemplo de esta plantilla usa scripts o recursos remotos; no se
                    previsualiza offline. La receta y el código de ejemplo sí están disponibles.
                  </p>
                ) : null}

                {templatePreview && selectedTemplate.files.example ? (
                  <div className="design-preview">
                    <iframe
                      title={`Ejemplo de ${selectedTemplate.name}`}
                      sandbox=""
                      src={designTemplateExampleUrl(selectedTemplate) ?? undefined}
                    />
                  </div>
                ) : null}

                {templateError ? (
                  <p className="design-inline-error" role="alert">
                    {templateError}
                  </p>
                ) : null}

                {templateDocOpen ? (
                  templateDoc && templateDoc.id === selectedTemplate.id ? (
                    <div className="design-doc-panel">
                      <DesignDoc source={templateDoc.text} />
                    </div>
                  ) : (
                    <p className="design-empty" role="status">
                      Cargando la receta…
                    </p>
                  )
                ) : null}

                <footer className="design-source">
                  Licencia {selectedTemplate.license}
                  {selectedTemplate.licenseFile ? ' · archivo LICENSE incluido' : ''}
                  {selectedTemplate.upstream ? (
                    <>
                      {' '}·{' '}
                      <a href={selectedTemplate.upstream} target="_blank" rel="noreferrer">
                        fuente original <Icon name="external" size={11} />
                      </a>
                    </>
                  ) : null}
                </footer>
              </>
            ) : null}

            {tab === 'skills' && selectedSkill ? (
              <>
                <div className="design-detail-head">
                  <div>
                    <span className="design-detail-kicker">
                      Skill · {templateModeLabel(selectedSkill.mode)}
                    </span>
                    <h2>{selectedSkill.name}</h2>
                    <p>{selectedSkill.description}</p>
                  </div>
                  <div className="design-detail-actions">
                    {selectedSkill.generatorReady ? (
                      <button
                        type="button"
                        className="primary icon-text"
                        onClick={() => void useSkillInGenerator(selectedSkill)}
                      >
                        <Icon name="sparkles" size={14} />
                        <span>Usar en generador</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ghost icon-text"
                      aria-expanded={skillDocOpen}
                      onClick={() => setSkillDocOpen((open) => !open)}
                    >
                      <Icon name="text" size={14} />
                      <span>{skillDocOpen ? 'Ocultar skill' : 'Leer skill'}</span>
                    </button>
                    <button
                      type="button"
                      className="ghost icon-text"
                      onClick={() => void copySkill(selectedSkill)}
                    >
                      <Icon name="copy" size={14} />
                      <span>Copiar skill</span>
                    </button>
                    {selectedSkill.previewable && selectedSkill.files.example ? (
                      <button
                        type="button"
                        className={skillPreview ? 'ghost active icon-text' : 'ghost icon-text'}
                        aria-pressed={skillPreview}
                        onClick={() => setSkillPreview((open) => !open)}
                      >
                        <Icon name="eye" size={14} />
                        <span>{skillPreview ? 'Ocultar ejemplo' : 'Ver ejemplo'}</span>
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="design-chips">
                  <span>{templateModeLabel(selectedSkill.mode)}</span>
                  {selectedSkill.platform ? <span>{selectedSkill.platform}</span> : null}
                  {selectedSkill.scenario ? <span>{selectedSkill.scenario}</span> : null}
                  {selectedSkill.category ? <span>{selectedSkill.category}</span> : null}
                  <span>{selectedSkill.license}</span>
                  {selectedSkill.tags.slice(0, 6).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>

                {!selectedSkill.generatorReady ? (
                  <p className="design-generator-warning" role="status">
                    Skill de utilidad: queda como referencia y no se envía como receta al
                    generador de diseño.
                  </p>
                ) : null}

                {selectedSkill.hasExample && !selectedSkill.previewable ? (
                  <p className="design-generator-warning" role="status">
                    El ejemplo usa scripts o recursos remotos; no se previsualiza offline.
                  </p>
                ) : null}

                {skillPreview && selectedSkill.files.example ? (
                  <div className="design-preview">
                    <iframe
                      title={`Ejemplo de ${selectedSkill.name}`}
                      sandbox=""
                      src={skillExampleUrl(selectedSkill) ?? undefined}
                    />
                  </div>
                ) : null}

                {skillError ? (
                  <p className="design-inline-error" role="alert">
                    {skillError}
                  </p>
                ) : null}

                {skillDocOpen ? (
                  skillDoc && skillDoc.id === selectedSkill.id ? (
                    <div className="design-doc-panel">
                      <DesignDoc source={skillDoc.text} />
                    </div>
                  ) : (
                    <p className="design-empty" role="status">
                      Cargando la skill…
                    </p>
                  )
                ) : null}

                <footer className="design-source">
                  Licencia {selectedSkill.license}
                  {selectedSkill.licenseFile ? ' · archivo LICENSE incluido' : ''}
                  {selectedSkill.upstream ? (
                    <>
                      {' '}
                      ·{' '}
                      <a href={selectedSkill.upstream} target="_blank" rel="noreferrer">
                        fuente original <Icon name="external" size={11} />
                      </a>
                    </>
                  ) : null}
                </footer>
              </>
            ) : null}

            {!selectedSystem && tab === 'systems' ? (
              <p className="design-empty">Elegí un sistema de la lista.</p>
            ) : null}
          </section>
        </div>
      ) : null}

      <PaletteExtractor
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={onNavigate}
      />

      <DesignGenerator
        system={generatorSystem}
        craft={catalog?.craft ?? []}
        recipe={generatorRecipe}
        initialFormat={generatorFormat}
        open={generatorOpen}
        onClose={() => setGeneratorOpen(false)}
        onNavigate={onNavigate}
      />
    </div>
  );
}
