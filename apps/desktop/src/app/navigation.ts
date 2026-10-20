export type ViewId =
  | 'projects'
  | 'director'
  | 'production'
  | 'factory'
  | 'editor'
  | 'script'
  | 'assets'
  | 'convert'
  | 'learn'
  | 'mcp'
  | 'settings';

export interface NavView {
  readonly id: ViewId;
  readonly label: string;
  readonly hint: string;
}

export const NAV_VIEWS: readonly NavView[] = [
  { id: 'projects', label: 'Proyectos', hint: 'Crear, abrir y retomar proyectos' },
  { id: 'director', label: 'Director', hint: 'Analizar un video y montar cortes, audio y subtítulos' },
  { id: 'production', label: 'Producción', hint: 'Voz, montaje automático, revisión y export' },
  { id: 'factory', label: 'Fábrica', hint: 'Generar N variantes de video desde un brief' },
  { id: 'editor', label: 'Editor', hint: 'Timeline, vista previa e inspector' },
  { id: 'script', label: 'Guion', hint: 'Asistente IA, escenas y narración' },
  { id: 'assets', label: 'Medios', hint: 'Importar, licencias y biblioteca' },
  { id: 'convert', label: 'Convertir', hint: 'Convertir imagen, video y audio a formatos comunes' },
  { id: 'learn', label: 'Aprender', hint: 'Tutorial completo paso a paso y atajos' },
  { id: 'mcp', label: 'MCP', hint: 'Conectar servidores MCP locales y ejecutar sus herramientas' },
  { id: 'settings', label: 'Ajustes', hint: 'Apariencia, proveedor, herramientas y voces' },
];
