import { Suspense, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { Icon } from './Icon';

interface SettingsWindowProps {
  readonly onClose: () => void;
  /** Contenido ya cargado por el llamador (mantiene el chunk diferido). */
  readonly children: ReactNode;
}

/**
 * Ventana de Configuración.
 *
 * Es una ventana flotante dentro del WebView, no un segundo proceso: abrir otra
 * ventana nativa costaría un WebView2 completo (~80 MB de RAM) para mostrar los
 * mismos controles. Acá se arrastra por la barra, se cierra con Esc o con la X y
 * el foco vuelve a donde estaba.
 */
export function SettingsWindow({ onClose, children }: SettingsWindowProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Trampa de foco (auditoría de accesibilidad, H1/H2): guarda el disparador,
  // enfoca el primer control del panel (el botón cerrar), atrapa Tab y cierra
  // con Escape con las mismas guardas que tenía el efecto propio
  // (defaultPrevented y foco en otro overlay). Al desmontar devuelve el foco.
  useDialogFocus({ containerRef: panelRef, onClose });

  function startDrag(event: React.PointerEvent<HTMLElement>): void {
    if (event.button !== 0) return;
    // No arrastrar si el puntero salió del encabezado hacia un control.
    if ((event.target as HTMLElement).closest('button')) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent<HTMLElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    const nextX = drag.originX + (event.clientX - drag.startX);
    const nextY = drag.originY + (event.clientY - drag.startY);
    // Se limita el desplazamiento para que la barra de título nunca se pierda.
    setOffset({
      x: Math.max(-window.innerWidth / 2 + 120, Math.min(window.innerWidth / 2 - 120, nextX)),
      y: Math.max(-window.innerHeight / 2 + 60, Math.min(window.innerHeight / 2 - 80, nextY)),
    });
  }

  function endDrag(): void {
    dragRef.current = null;
  }

  return createPortal(
    <div
      className="settings-window-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="settings-window"
        role="dialog"
        aria-modal="true"
        aria-label="Configuración"
        style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }}
      >
        <header
          className="settings-window-bar"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="settings-window-title">
            <Icon name="settings" size={13} />
            <span>Configuración</span>
            <em>se guarda en este equipo</em>
          </span>
          <button
            type="button"
            className="icon-button settings-window-close"
            aria-label="Cerrar configuración"
            title="Cerrar (Esc)"
            onClick={onClose}
          >
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="settings-window-body">
          <Suspense fallback={null}>{children}</Suspense>
        </div>
      </div>
    </div>,
    document.body,
  );
}
