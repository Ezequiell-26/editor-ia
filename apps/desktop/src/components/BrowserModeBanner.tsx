import { NATIVE_UNAVAILABLE_REASON } from '../services/project-service';

export interface BrowserModeBannerProps {
  /** Motivo medido del backend; si falta, se usa el motivo nativo canónico. */
  readonly reason?: string | null;
  /** Abre la ventana de Ajustes. Sin handler, el aviso no ofrece el botón. */
  readonly onOpenSettings?: () => void;
}

/**
 * Aviso persistente del modo navegador.
 *
 * La app no tiene un fake de escritorio a propósito: sin runtime nativo el
 * servicio devuelve `available: false` y cada método rechaza con
 * `NATIVE_UNAVAILABLE_REASON`, así nadie pierde un proyecto que creyó guardado.
 * Este aviso va en el flujo del shell/launcher (no flotando sobre el contenido):
 * una línea de estado + un desplegable con el detalle, para ser honesto sin
 * tapar la interfaz. Los estilos viven en `styles/premium/shell.css`.
 */
export function BrowserModeBanner({ reason, onOpenSettings }: BrowserModeBannerProps) {
  const detail = reason?.trim() ? reason.trim() : NATIVE_UNAVAILABLE_REASON;
  return (
    <aside
      className="browser-mode-banner"
      role="note"
      aria-label="Modo navegador sin acceso al sistema"
    >
      <span className="browser-mode-banner-label">Modo navegador</span>
      <p className="browser-mode-banner-line">
        <strong>Estás viendo Olyvia en el navegador.</strong> {detail}
      </p>
      <details className="browser-mode-banner-details">
        <summary>Qué podés probar acá</summary>
        <p>
          <strong>Qué sí podés probar:</strong> recorrer las vistas, la paleta de comandos y
          los atajos, y revisar la interfaz sin tocar tus archivos.{' '}
          <strong>Qué necesita la app de escritorio:</strong> crear y guardar proyectos,
          importar medios, exportar con FFmpeg, IA de texto, transcripción y modelos locales.
          En la app instalada, Ajustes → Capacidades muestra qué mide tu equipo.
        </p>
      </details>
      {onOpenSettings ? (
        <button type="button" className="ghost small browser-mode-banner-action" onClick={onOpenSettings}>
          Abrir Ajustes
        </button>
      ) : null}
    </aside>
  );
}
