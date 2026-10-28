import { useRef } from 'react';
import { CURRENT_APP_VERSION } from '../../app/version';
import { Icon } from '../../components/Icon';
import { useDialogFocus } from '../../hooks/useDialogFocus';

export interface AppUpdaterModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export function AppUpdaterModal({ isOpen, onClose }: AppUpdaterModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useDialogFocus({
    containerRef: dialogRef,
    active: isOpen,
    onClose,
  });

  if (!isOpen) return null;

  return (
    <div
      className="updater-backdrop"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="updater-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="updater-dialog">
        <header className="updater-header">
          <div className="updater-title-group">
            <span className="updater-icon-badge">
              <Icon name="refresh" size={16} />
            </span>
            <div>
              <h2 id="updater-title" className="updater-title">
                Actualizaciones de Olyvia
              </h2>
              <span className="updater-version-tag">
                Versión instalada: v{CURRENT_APP_VERSION}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="updater-close-btn"
            aria-label="Cerrar actualizaciones"
            onClick={onClose}
          >
            <Icon name="close" size={14} />
          </button>
        </header>

        <div className="updater-body">
          <div className="updater-state-box">
            <span className="updater-state-icon-info">
              <Icon name="info" size={20} />
            </span>
            <div className="updater-state-text">
              <strong>Sin canal de actualizaciones configurado</strong>
              <span>
                Este build no consulta ningún servidor de versiones y no anuncia
                actualizaciones que no existan.
              </span>
            </div>
          </div>

          <div className="updater-download-meta">
            <span>Firma: local autofirmada, sin sello de tiempo</span>
            <span>Endpoint de releases: sin definir</span>
          </div>
        </div>

        <footer className="updater-footer">
          <button
            type="button"
            className="updater-btn updater-btn--secondary"
            onClick={onClose}
          >
            Aceptar
          </button>
        </footer>
      </div>
    </div>
  );
}
