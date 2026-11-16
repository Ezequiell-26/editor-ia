import type { ViewId } from '../../../app/navigation';

/**
 * Contrato entre los controles visibles de la réplica y las operaciones
 * reales del editor. Cada etiqueta de `model.ts` debe resolver acá: el test
 * `editor-actions.test.ts` falla si aparece un control sin acción.
 *
 * La réplica conserva su geometría y su tipografía medidas; este módulo sólo
 * sustituye los «botones decorativos» por operaciones sobre el store real,
 * navegación o diálogos existentes.
 */

export type EditorAction =
  | 'toggle-play'
  | 'step-back'
  | 'step-forward'
  | 'undo'
  | 'redo'
  | 'split'
  | 'delete'
  | 'duplicate'
  | 'marker'
  | 'add-track'
  | 'snap'
  | 'deselect'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-fit'
  | 'capture-frame'
  | 'navigate-text'
  | 'navigate-settings'
  | 'navigate-tracking'
  | 'navigate-record'
  | 'navigate-lab'
  | 'navigate-auto-edit'
  | 'navigate-projects'
  | 'navigate-vfx'
  | 'navigate-captions'
  | 'navigate-motion'
  | 'navigate-color'
  | 'navigate-assets'
  | 'open-shortcuts'
  | 'open-tour'
  | 'open-history'
  | 'open-assistant'
  | 'generate-captions';

/** Herramientas de la barra del timeline y sus equivalentes reales. */
export const TOOL_ACTIONS: Readonly<Record<string, EditorAction>> = Object.freeze({
  'Nova faixa': 'add-track',
  'Reproduzir': 'toggle-play',
  'Imã': 'snap',
  'Desfazer': 'undo',
  'Refazer': 'redo',
  'Dividir': 'split',
  'Excluir': 'delete',
  'Copiar': 'duplicate',
  'Marcador': 'marker',
  'Mover': 'deselect',
  'Encaixar': 'zoom-fit',
  'Texto': 'navigate-text',
  'Ajustes': 'navigate-settings',
  'Rastreamento': 'navigate-tracking',
  'Mais zoom': 'zoom-in',
  'Menos zoom': 'zoom-out',
  'Quadro anterior': 'step-back',
  'Quadro seguinte': 'step-forward',
  'Capturar quadro': 'capture-frame',
});

/** Menús, barra superior, tarjetas y paneles. */
export const MENU_ACTIONS: Readonly<Record<string, EditorAction>> = Object.freeze({
  'Arquivo': 'navigate-projects',
  'Versão': 'open-history',
  'Atualização': 'navigate-settings',
  'Configurações': 'navigate-settings',
  'Ajuda': 'open-tour',
  'Projetos': 'navigate-projects',
  'Layout': 'navigate-settings',
  'Histórico': 'open-history',
  'Edição automática': 'navigate-auto-edit',
  'Atalhos': 'open-shortcuts',
  'Gravar tela / webcam': 'navigate-record',
  'Gravar Mídias': 'navigate-record',
  'Mão Mágica': 'navigate-lab',
  'Pedir ao assistente': 'open-assistant',
  'Gerar legendas': 'generate-captions',
  'Legendas automáticas': 'generate-captions',
  'Desenho com mãozinha': 'navigate-lab',
  'Cor de cinema': 'navigate-color',
  'Transições e efeitos': 'navigate-vfx',
  'Aplicar câmera neste trecho': 'navigate-motion',
});

export function resolveAction(label: string): EditorAction | null {
  return TOOL_ACTIONS[label] ?? MENU_ACTIONS[label] ?? null;
}

/** Acciones que se resuelven cambiando de vista (contrato `ViewId`). */
export const ACTION_VIEWS: Readonly<Partial<Record<EditorAction, ViewId>>> = Object.freeze({
  'navigate-text': 'text-edit',
  'navigate-settings': 'settings',
  'navigate-tracking': 'vfx',
  'navigate-record': 'record',
  'navigate-lab': 'lab',
  'navigate-auto-edit': 'auto-edit',
  'navigate-projects': 'projects',
  'navigate-vfx': 'vfx',
  'navigate-captions': 'localization',
  'navigate-motion': 'motion',
  'navigate-color': 'vfx',
  'navigate-assets': 'assets',
  'capture-frame': 'thumbnails',
  'generate-captions': 'localization',
});

export const ZOOM_STEP = 0.25;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const ZOOM_DEFAULT = 1;

export function clampZoom(value: number): number {
  if (Number.isNaN(value)) return ZOOM_DEFAULT;
  if (value === Number.POSITIVE_INFINITY) return ZOOM_MAX;
  if (value === Number.NEGATIVE_INFINITY) return ZOOM_MIN;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

const HARNESS_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * El selector de escenas y los parámetros `?scene=` / `?inspector=` son un
 * arnés de medición: nunca deben aparecer en la app empaquetada, que corre en
 * `tauri.localhost` y siempre arranca con el estado real del proyecto.
 */
export function isHarnessHost(hostname: string): boolean {
  return HARNESS_HOSTS.has(hostname);
}
