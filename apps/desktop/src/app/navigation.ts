export type ViewId =
  | 'home'
  | 'projects'
  | 'director'
  | 'auto-edit'
  | 'youtube'
  | 'production'
  | 'factory'
  | 'creator'
  | 'editor'
  | 'text-edit'
  | 'multicam'
  | 'mixer'
  | 'vfx'
  | 'script'
  | 'assets'
  | 'download'
  | 'compliance'
  | 'convert'
  | 'compare'
  | 'compress'
  | 'denoise'
  | 'thumbnails'
  | 'localization'
  | 'ai-hub'
  | 'motion'
  | 'visuals'
  | 'background'
  | 'upscale'
  | 'lab'
  | 'learn'
  | 'mcp'
  | 'settings';

/**
 * Grupos del rail. `ruta` es el orden real de trabajo (proyecto → guion →
 * medios → voz → edición); el resto son herramientas y ayuda, que se usan
 * cuando hacen falta y no forman parte del recorrido.
 */
export type NavGroup = 'inicio' | 'ruta' | 'herramientas' | 'ayuda';

export interface NavView {
  readonly id: ViewId;
  readonly label: string;
  readonly hint: string;
  readonly group: NavGroup;
}

export const NAV_VIEWS: readonly NavView[] = [
  { id: 'home', label: 'Inicio', hint: 'Estado del estudio, acceso rápido y resumen de proyectos', group: 'inicio' },
  { id: 'projects', label: 'Proyectos', hint: 'Paso 1 · Crear nuevo proyecto, abrir existentes o importar', group: 'ruta' },
  { id: 'script', label: 'Guion', hint: 'Paso 2 · Redacción de escenas, narración y asistente IA', group: 'ruta' },
  { id: 'assets', label: 'Medios', hint: 'Paso 3 · Biblioteca multimedia, fotos, videos y licencias', group: 'ruta' },
  { id: 'production', label: 'Producción', hint: 'Paso 4 · Voz por escena, montaje automático y revisión', group: 'ruta' },
  { id: 'editor', label: 'Editor', hint: 'Paso 5 · Editor multicapa, timeline, vista previa e inspector', group: 'ruta' },
  { id: 'text-edit', label: 'Texto', hint: 'Edición por texto · Transcribí el video y cortá desde las frases', group: 'herramientas' },
  { id: 'multicam', label: 'Multicámara', hint: 'Multicámara · Sincronizá cámaras y cambiá de ángulo en vivo', group: 'herramientas' },
  { id: 'mixer', label: 'Mezcla', hint: 'Mezclador · Ganancia por pista, solo, mute y master', group: 'herramientas' },
  { id: 'vfx', label: 'VFX', hint: 'VFX · Nodos, rotoscopía poligonal y seguimiento facial', group: 'herramientas' },
  { id: 'download', label: 'Descargar', hint: 'Descargador web · Bajar videos, fotos y audio hasta 8K', group: 'herramientas' },
  { id: 'director', label: 'Director', hint: 'Director IA · Análisis automático de video, cortes y ritmo', group: 'herramientas' },
  { id: 'auto-edit', label: 'Automático', hint: 'Editor automático · Analiza el video y crea variantes editables sin LLM', group: 'herramientas' },
  { id: 'youtube', label: 'YouTube', hint: 'Analizador de canales · Mejor video, miniaturas, títulos y comentarios', group: 'herramientas' },
  { id: 'factory', label: 'Fábrica', hint: 'Fábrica de videos · Generación en lote de variantes desde un brief', group: 'herramientas' },
  { id: 'creator', label: 'Creador', hint: 'Creador · Hooks de 3 s, exportación 9:16/16:9/1:1, CTA con QR y B-roll', group: 'herramientas' },
  { id: 'compliance', label: 'Cumplimiento', hint: 'Auditoría de reglas de monetización por red social (TikTok/YT/IG)', group: 'herramientas' },
  { id: 'convert', label: 'Convertir', hint: 'Convertidor · Transcodificación de video, imagen y audio local', group: 'herramientas' },
  { id: 'compare', label: 'Comparar', hint: 'Comparador A/B · Línea divisoria interactiva antes y después', group: 'herramientas' },
  { id: 'compress', label: 'Comprimir', hint: 'Compresor inteligente · Reducir tamaño de video sin perder nitidez', group: 'herramientas' },
  { id: 'denoise', label: 'Denoise', hint: 'Reducción de ruido · Limpieza de ruido visual y sonoro en tiempo real', group: 'herramientas' },
  { id: 'thumbnails', label: 'Miniaturas', hint: 'Creador de miniaturas · Diseñar carátulas para YouTube y redes', group: 'herramientas' },
  { id: 'localization', label: 'Localización', hint: 'Subtítulos y traducción · Traducir a 8 idiomas con exportación SRT/VTT', group: 'herramientas' },
  { id: 'ai-hub', label: 'AI Hub', hint: 'Hub de IA · Prompts, briefs creativos y modelos locales con tokens', group: 'herramientas' },
  { id: 'motion', label: 'Motion', hint: 'Motion graphics · Títulos, lower-thirds y cierres con render local', group: 'herramientas' },
  { id: 'visuals', label: 'Efectos', hint: 'Efectos y transiciones · Aplicar presets, ajustes y auditoría visual', group: 'herramientas' },
  { id: 'background', label: 'Fondo', hint: 'Quitar fondo · Recorte de silueta automático con IA local', group: 'herramientas' },
  { id: 'upscale', label: 'Upscale', hint: 'Mejora 4K · Super-resolución con IA Real-ESRGAN local', group: 'herramientas' },
  { id: 'lab', label: 'Laboratorio', hint: 'Conversión, compresión, ruido, upscale, comparación y fondo en un solo lugar', group: 'herramientas' },
  { id: 'mcp', label: 'MCP', hint: 'Servidores MCP · Conectar agentes, Flow y herramientas externas', group: 'herramientas' },
  { id: 'learn', label: 'Aprender', hint: 'Centro de aprendizaje · Tutorial paso a paso y atajos de teclado', group: 'ayuda' },
  { id: 'settings', label: 'Ajustes', hint: 'Ajustes del estudio · Apariencia, atajos, preferencias y respaldo', group: 'ayuda' },
];

const MAIN_IDS = new Set<ViewId>([
  'home',
  'projects',
  'script',
  'assets',
  'production',
  'editor',
  'download',
  'creator',
  'lab',
  'learn',
  'settings',
]);

/**
 * Superficies del rail, en el orden en que se trabaja: Inicio, la ruta de cinco
 * pasos (Proyecto → Guion → Medios → Producción → Editor), las herramientas que
 * se usan cuando hacen falta (Descargar, Creador, Laboratorio) y la ayuda. Cada
 * intención tiene una sola puerta; lo demás vive dentro de un hub, de un modo
 * del editor o detrás de «Más».
 */
export const MAIN_NAV_VIEWS: readonly NavView[] = [
  { id: 'home', label: 'Inicio', hint: 'Estado del estudio y acceso rápido', group: 'inicio' },
  { id: 'projects', label: 'Proyectos', hint: 'Paso 1 · Crear, abrir o importar un proyecto', group: 'ruta' },
  { id: 'script', label: 'Guion', hint: 'Paso 2 · Escenas, narración y asistente de guion', group: 'ruta' },
  { id: 'assets', label: 'Medios', hint: 'Paso 3 · Fotos, videos, audio y licencias', group: 'ruta' },
  { id: 'production', label: 'Producción', hint: 'Paso 4 · Voz por escena, montaje automático y revisión', group: 'ruta' },
  { id: 'editor', label: 'Editor', hint: 'Paso 5 · Timeline, vista previa, inspector y exportación', group: 'ruta' },
  { id: 'download', label: 'Descargar', hint: 'Bajar videos y material · incluye YouTube y cumplimiento', group: 'herramientas' },
  { id: 'creator', label: 'Creador', hint: 'Hooks, variantes, miniaturas y localización', group: 'herramientas' },
  { id: 'lab', label: 'Laboratorio', hint: 'Convertir, comprimir, quitar ruido, agrandar, comparar y quitar fondo', group: 'herramientas' },
  { id: 'learn', label: 'Aprender', hint: 'Tutorial y atajos', group: 'ayuda' },
  { id: 'settings', label: 'Ajustes', hint: 'Apariencia, IA, integraciones y datos', group: 'ayuda' },
];

/** Herramientas avanzadas visibles tras «Más»; hubs, IA y MCP van aparte. */
const HUB_COVERED = new Set<ViewId>([
  'youtube',
  'compliance',
  'factory',
  'thumbnails',
  'localization',
  'convert',
  'compress',
  'denoise',
  'upscale',
  'compare',
  'background',
]);

export const SECONDARY_NAV_VIEWS: readonly NavView[] = NAV_VIEWS.filter(
  (view) =>
    !MAIN_IDS.has(view.id) &&
    !HUB_COVERED.has(view.id) &&
    view.id !== 'ai-hub' &&
    view.id !== 'mcp',
);

/** Vistas donde la ruta no aporta contexto. */
export const PIPELINE_HIDDEN_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>([
  'home',
  'learn',
  'settings',
  'mcp',
  'compliance',
  'convert',
  'compare',
  'compress',
  'denoise',
  'thumbnails',
  'localization',
  'ai-hub',
  'motion',
  'mixer',
  'vfx',
  'visuals',
  'background',
  'upscale',
  'lab',
  'factory',
  'creator',
  'director',
  'auto-edit',
  'youtube',
]);
