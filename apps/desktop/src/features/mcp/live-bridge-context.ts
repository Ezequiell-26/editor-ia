/**
 * Contexto mutable mínimo para el puente en vivo. El host se monta una sola
 * vez por encima de Start/Shell; la vista activa y la navegación se actualizan
 * cuando Shell entra en escena. Evita escuchar el mismo evento dos veces.
 */
import type { ViewId } from '../../app/navigation';

export interface LiveBridgeContext {
  readonly view: string;
  readonly navigate: (view: ViewId) => void;
  /** Sale de la pantalla de inicio y muestra el editor. */
  readonly enterEditor?: () => void;
}

let context: LiveBridgeContext = {
  view: 'home',
  navigate: () => undefined,
};

export function setLiveBridgeContext(next: Partial<LiveBridgeContext>): void {
  context = { ...context, ...next };
}

export function liveBridgeContext(): LiveBridgeContext {
  return context;
}
