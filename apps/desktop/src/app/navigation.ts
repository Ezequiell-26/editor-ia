export type ViewId = 'projects' | 'editor' | 'assets' | 'settings';

export interface NavView {
  readonly id: ViewId;
  readonly label: string;
  readonly summary: string;
}

export const NAV_VIEWS: readonly NavView[] = [
  {
    id: 'projects',
    label: 'Projects',
    summary: 'Proyectos guardados en este dispositivo.',
  },
  {
    id: 'editor',
    label: 'Editor',
    summary: 'Timeline, preview e inspector del proyecto abierto.',
  },
  {
    id: 'assets',
    label: 'Assets',
    summary: 'Medios declarados por el proyecto y sus derechos.',
  },
  {
    id: 'settings',
    label: 'Settings',
    summary: 'Preferencias de la app, proveedores y herramientas externas.',
  },
];
