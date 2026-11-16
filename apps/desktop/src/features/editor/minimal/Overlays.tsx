import { useRef, type ReactNode } from 'react';
import { useDialogFocus } from '../../../hooks/useDialogFocus';

/**
 * Capas que sólo existen DESPUÉS de una interacción. No forman parte de la
 * geometría medida de la réplica, por lo que no alteran las capturas estáticas
 * ni los snapshots pixel-perfect.
 */

export interface ConsentDialogProps {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Consentimiento de derechos previo a la importación (mismo criterio que Medios). */
export function ConsentDialog({ onConfirm, onCancel }: ConsentDialogProps): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Trampa de foco, Tab circular, Escape y restauración del disparador:
  // reutiliza el contrato accesible del resto de la app.
  useDialogFocus({ containerRef: dialogRef, onClose: onCancel });

  return (
    <div className="me-overlay">
      <div
        className="me-consent"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="me-consent-title"
      >
        <p className="me-consent-eyebrow">Antes de importar</p>
        <h2 id="me-consent-title">Derechos de uso</h2>
        <p>
          Confirmá que tenés derechos para usar y exportar los archivos que vas a
          agregar al proyecto. Olyvia declara esa licencia en el documento del
          proyecto.
        </p>
        <div className="me-consent-actions">
          <button type="button" className="me-consent-cancel" onClick={onCancel}>Cancelar</button>
          <button type="button" className="me-consent-confirm" onClick={onConfirm}>
            Confirmar y elegir archivos
          </button>
        </div>
      </div>
    </div>
  );
}

export interface ActionToastProps {
  readonly message: string;
  readonly onDismiss: () => void;
}

export function ActionToast({ message, onDismiss }: ActionToastProps): ReactNode {
  return (
    <div className="me-toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" aria-label="Cerrar aviso" onClick={onDismiss}>×</button>
    </div>
  );
}
