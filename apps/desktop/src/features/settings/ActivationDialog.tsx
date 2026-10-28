import { useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useLicense } from '../../state/LicenseProvider';

export function ActivationDialog({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const { status, chooseAndActivate, startTrial } = useLicense();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useDialogFocus({ containerRef: dialogRef, active: open, onClose });

  if (!open) return null;
  const trialAvailable = !status.isPro && status.trialEndsAtUnix == null;

  async function trial(): Promise<void> {
    setBusy('trial');
    setError(null);
    try {
      await startTrial();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo iniciar la prueba');
    } finally {
      setBusy(null);
    }
  }

  async function file(): Promise<void> {
    setBusy('file');
    setError(null);
    try {
      const next = await chooseAndActivate();
      if (next) onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo activar la licencia');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="license-backdrop"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="license-dialog-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="license-dialog">
        <header>
          <div>
            <p className="eyebrow">Olyvia Pro</p>
            <h2 id="license-dialog-title">Activá funciones avanzadas</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>
        <p className="muted">
          Pro habilita 4K/8K, HEVC/AV1/HDR, automatización, Director IA y Fábrica. Free conserva
          el editor y tus proyectos.
        </p>
        {trialAvailable ? (
          <button
            type="button"
            className="primary"
            disabled={busy !== null}
            onClick={() => void trial()}
          >
            {busy === 'trial' ? 'Iniciando…' : 'Probar 14 días gratis'}
          </button>
        ) : (
          <p className="fine-print">
            {status.isPro
              ? 'Este equipo ya tiene Pro activo.'
              : 'La prueba de 14 días ya se usó en este equipo.'}
          </p>
        )}
        <button type="button" className="ghost" disabled={busy !== null} onClick={() => void file()}>
          {busy === 'file' ? 'Leyendo…' : 'Cargar archivo de licencia…'}
        </button>
        <p className="fine-print">
          La activación por clave de Lemon Squeezy/Gumroad se habilitará cuando el build tenga
          configurado el producto y el endpoint de licencias. Mientras tanto, usá la prueba o un
          archivo firmado.
        </p>
        {error ? (
          <p className="license-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
