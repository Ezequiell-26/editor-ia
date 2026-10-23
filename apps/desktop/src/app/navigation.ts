export type ViewId =
  | 'home'
  | 'projects'
  | 'director'
  | 'production'
  | 'factory'
  | 'editor'
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
  | 'visuals'
  | 'background'
  | 'upscale'
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
  { id: 'production', label: 'Producción', hint: 'Paso 4 · Locución con voces IA, montaje de audio y exportación', group: 'ruta' },
  { id: 'editor', label: 'Editor', hint: 'Paso 5 · Editor multicapa, timeline, vista previa e inspector', group: 'ruta' },
  { id: 'download', label: 'Descargar', hint: 'Descargador web · Bajar videos, fotos y audio hasta 8K', group: 'herramientas' },
  { id: 'director', label: 'Director', hint: 'Director IA · Análisis automático de video, cortes y ritmo', group: 'herramientas' },
  { id: 'factory', label: 'Fábrica', hint: 'Fábrica de videos · Generación en lote de variantes desde un brief', group: 'herramientas' },
  { id: 'compliance', label: 'Cumplimiento', hint: 'Auditoría de reglas de monetización por red social (TikTok/YT/IG)', group: 'herramientas' },
  { id: 'convert', label: 'Convertir', hint: 'Convertidor · Transcodificación de video, imagen y audio local', group: 'herramientas' },
  { id: 'compare', label: 'Comparar', hint: 'Comparador A/B · Línea divisoria interactiva antes y después', group: 'herramientas' },
  { id: 'compress', label: 'Comprimir', hint: 'Compresor inteligente · Reducir tamaño de video sin perder nitidez', group: 'herramientas' },
  { id: 'denoise', label: 'Denoise', hint: 'Reducción de ruido · Limpieza de ruido visual y sonoro en tiempo real', group: 'herramientas' },
  { id: 'thumbnails', label: 'Miniaturas', hint: 'Creador de miniaturas · Diseñar carátulas para YouTube y redes', group: 'herramientas' },
  { id: 'localization', label: 'Localización', hint: 'Subtítulos y traducción · Traducir a 8 idiomas con exportación SRT/VTT', group: 'herramientas' },
  { id: 'ai-hub', label: 'AI Hub', hint: 'Hub de IA · Prompts, briefs creativos y modelos locales con tokens', group: 'herramientas' },
  { id: 'visuals', label: 'Efectos', hint: 'Efectos y transiciones · Aplicar presets, ajustes y auditoría visual', group: 'herramientas' },
  { id: 'background', label: 'Fondo', hint: 'Quitar fondo · Recorte de silueta automático con IA local', group: 'herramientas' },
  { id: 'upscale', label: 'Upscale', hint: 'Mejora 4K · Super-resolución con IA Real-ESRGAN local', group: 'herramientas' },
  { id: 'mcp', label: 'MCP', hint: 'Servidores MCP · Conectar agentes, Flow y herramientas externas', group: 'herramientas' },
  { id: 'learn', label: 'Aprender', hint: 'Centro de aprendizaje · Tutorial paso a paso y atajos de teclado', group: 'ayuda' },
  { id: 'settings', label: 'Ajustes', hint: 'Ajustes del estudio · Apariencia, atajos, preferencias y respaldo', group: 'ayuda' },
];

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
  'visuals',
  'background',
  'upscale',
  'factory',
  'director',
]);
