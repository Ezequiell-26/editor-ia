import { useEffect, useRef, type RefObject } from 'react';

/**
 * Selector de elementos enfocables dentro del diálogo. No consulta geometría
 * (en jsdom no hay layout y al montar el panel puede no tenerla todavía): se
 * apoya sólo en atributos.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface UseDialogFocusOptions<T extends HTMLElement> {
  /** Contenedor con role="dialog" dentro del que queda atrapado el foco. */
  readonly containerRef: RefObject<T | null>;
  /** Se llama cuando el usuario cierra con Escape. */
  readonly onClose: () => void;
  /**
   * false mientras el diálogo no esté en pantalla aunque el componente siga
   * montado (p. ej. ExportDialog devuelve null al cerrar). Por defecto true.
   */
  readonly active?: boolean;
}

/**
 * Trampa de foco para diálogos modales (auditoría de accesibilidad 2026-10-24,
 * hallazgos H1/H2): ningún modal capturaba el foco y sólo SettingsWindow lo
 * restauraba.
 *
 * - Al activarse guarda el disparador (document.activeElement) y enfoca el
 *   primer enfocable del panel, o el propio panel si no tiene ninguno.
 * - Atrapa Tab: desde el último cicla al primero y con Shift desde el primero
 *   salta al último; si el foco se escapó del diálogo, lo recupera en el borde
 *   de entrada correspondiente.
 * - Escape llama a `onClose`, salvo que otro overlay ya haya consumido el
 *   evento (`defaultPrevented`) o que el foco esté fuera del panel (ese
 *   overlay maneja su propio Escape).
 * - Al desactivarse o desmontarse devuelve el foco al disparador, salvo que
 *   otro overlay lo haya tomado ya: devolvérselo le robaría el foco a un
 *   componente más nuevo.
 *
 * Es tolerante al doble montaje de StrictMode: el cleanup restaura el foco al
 * disparador antes de que el segundo montaje vuelva a guardarlo.
 */
export function useDialogFocus<T extends HTMLElement>({
  containerRef,
  onClose,
  active = true,
}: UseDialogFocusOptions<T>): void {
  // Último onClose recibido: el efecto no debe reiniciarse (ni volver a
  // guardar el disparador) sólo porque el llamador recrea el callback en cada
  // render, como hacen App o EditorWorkspace con sus arrows inline.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const panel = containerRef.current;
    if (!panel) return;

    const focusables = (): HTMLElement[] =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    const trigger = document.activeElement as HTMLElement | null;
    const initial = focusables()[0];
    if (initial) {
      initial.focus();
    } else {
      // Sin enfocables el foco recae en el propio panel para que Tab y Escape
      // sigan operando y el foco no quede perdido en el fondo.
      panel.tabIndex = -1;
      panel.focus();
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      const container = containerRef.current;
      if (!container) return;

      if (event.key === 'Tab') {
        const items = focusables();
        const current = document.activeElement;
        if (!container.contains(current)) {
          // El foco escapó del diálogo (o nunca entró): se recupera en el
          // borde por el que se entraría según la dirección del Tab.
          event.preventDefault();
          (event.shiftKey ? items[items.length - 1] : items[0])?.focus();
          return;
        }
        if (items.length === 0) {
          // Único destino posible: el propio panel.
          event.preventDefault();
          container.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey) {
          if (current === first || current === container) {
            event.preventDefault();
            last?.focus();
          }
          return;
        }
        if (current === last || current === container) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }

      if (event.key === 'Escape') {
        // Otro control ya consumió el Escape (captura de atajos): no repetir.
        if (event.defaultPrevented) return;
        // Si el foco vive en otro overlay (la paleta sobre la ventana), ese
        // overlay maneja su propio Escape.
        const target = event.target;
        if (target instanceof Node && target !== document.body && !container.contains(target)) {
          return;
        }
        onCloseRef.current();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const current = document.activeElement;
      const focusInside = current instanceof Node && panel.contains(current);
      if (trigger && (focusInside || current === document.body)) {
        trigger.focus();
      }
    };
  }, [active, containerRef]);
}
