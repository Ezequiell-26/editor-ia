export type ViewId = 'projects' | 'editor' | 'script' | 'assets' | 'settings';

export interface NavView {
  readonly id: ViewId;
  readonly label: string;
  readonly hint: string;
}

export const NAV_VIEWS: readonly NavView[] = [
  { id: 'projects', label: 'Proyectos', hint: 'Crear, abrir y retomar proyectos' },
  { id: 'editor', label: 'Editor', hint: 'Timeline, vista previa e inspector' },
  { id: 'script', label: 'Guion', hint: 'Asistente IA, escenas y narración' },
  { id: 'assets', label: 'Medios', hint: 'Importar, licencias y biblioteca' },
  { id: 'settings', label: 'Ajustes', hint: 'Proveedor, herramientas y voces' },
];
