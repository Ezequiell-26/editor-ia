import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { useLicense } from '../../state/LicenseProvider';
import { ActivationDialog } from './ActivationDialog';

function formatExpiry(unix: number | null): string {
  if (unix == null) return 'licencia perpetua';
  return new Date(unix * 1000).toLocaleDateString('es-AR');
}

/**
 * Estado y activación del plan. La licencia se verifica en Rust con una firma
 * Ed25519; esta tarjeta sólo muestra el resultado y dispara los comandos.
 */
export function LicenseCard() {
  const { status, loading, deactivate, refresh } = useLicense();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function drop(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const next = await deactivate();
      if (next.error) setError(next.error);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo desactivar la licencia');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card license-card" aria-busy={loading || busy}>
      <div className="license-card-head">
        <div>
          <p className="eyebrow">Plan actual</p>
          <h3>
            <span className={`license-badge${status.isPro ? ' pro' : ''}`}>
              <Icon name={status.isPro ? 'star' : 'shield'} size={13} />
              {status.isPro
                ? status.source === 'trial'
                  ? 'Olyvia Pro · Prueba'
                  : 'Olyvia Pro'
                : 'Olyvia Free'}
            </span>
          </h3>
        </div>
        <button type="button" className="small ghost" onClick={() => void refresh()}>
          Actualizar
        </button>
      </div>

      {status.isPro ? (
        <div className="license-meta">
          <span>
            {status.source === 'trial'
              ? `Prueba: ${status.trialDaysLeft ?? 0} día(s) restantes`
              : status.email ?? 'Licencia activada'}
          </span>
          <span>
            {status.source === 'trial'
              ? 'Se puede activar una licencia cuando termine'
              : `${status.licenseId ?? 'sin identificador'} · ${formatExpiry(status.expiresAtUnix)}`}
          </span>
        </div>
      ) : (
        <p className="muted">
          Free: hasta 2 descargas simultáneas y cola de 25, video hasta 1080p en MP4/H.264 y
          exportación 1080p sin marca de agua. El editor y tus proyectos no se bloquean.
        </p>
      )}

      {!status.isPro ? (
        <ul className="license-limits">
          <li>Pro: hasta 512 descargas, 4K/8K, HEVC, AV1 y HDR.</li>
          <li>Pro: programación, carpetas vigiladas, RSS y SponsorBlock automático.</li>
          <li>Pro: Director IA y Fábrica de Variantes.</li>
        </ul>
      ) : null}

      {status.error || error ? (
        <p className="license-error" role="alert">
          {error ?? status.error}
        </p>
      ) : null}

      <div className="actions">
        {status.isPro ? (
          <button type="button" className="ghost" disabled={busy} onClick={() => void drop()}>
            {busy ? 'Quitando…' : 'Desactivar en este equipo'}
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => setDialogOpen(true)}
          >
            Activar Olyvia Pro…
          </button>
        )}
      </div>
      <p className="fine-print">
        La licencia se verifica localmente con firma digital y se guarda cifrada para este equipo.
        No se envía tu proyecto ni tu material.
      </p>
      <ActivationDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </article>
  );
}
