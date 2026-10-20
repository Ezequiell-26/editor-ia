import { useMemo, useState } from 'react';
import { basename } from '../../lib/format';
import { useProjectStore } from '../../state/project-store';
import { auditPublication, buildPublicationManifest } from '../../state/publication';

export function PublicationReadiness() {
  const store = useProjectStore();
  const project = store.state.project;
  const [busy, setBusy] = useState(false);
  const audit = useMemo(() => (project ? auditPublication(project) : null), [project]);

  if (!project || !audit) return null;
  const snapshot = project;

  const rows = [
    {
      label: 'Materiales listos',
      ok: audit.checks.allAssetsReady,
      detail: `${project.assets.length} asset(s) en la biblioteca`,
    },
    {
      label: 'Licencias declaradas',
      ok: audit.checks.missingLicenses === 0,
      detail:
        audit.checks.missingLicenses === 0
          ? 'sin licencias desconocidas'
          : `${audit.checks.missingLicenses} con licencia desconocida`,
    },
    {
      label: 'Duplicados por hash',
      ok: audit.checks.duplicateGroups === 0,
      detail:
        audit.checks.duplicateGroups === 0
          ? 'sin archivos repetidos'
          : `${audit.checks.duplicateGroups} grupo(s) repetido(s)`,
    },
    {
      label: 'Subtítulos',
      ok: audit.checks.captionCount > 0 || audit.checks.scenes === 0,
      detail: `${audit.checks.captionCount} cue(s) para ${audit.checks.scenes} escena(s)`,
    },
    {
      label: 'Perfiles de exportación',
      ok: audit.checks.renderProfiles > 0,
      detail: `${audit.checks.renderProfiles} perfil(es)`,
    },
    {
      label: 'Variantes por plataforma',
      ok: audit.checks.platformVariants > 0,
      detail: `${audit.checks.platformVariants} variante(s) declarada(s)`,
    },
  ];

  async function saveManifest(): Promise<void> {
    setBusy(true);
    try {
      const path = await store.service.savePublicationManifest(
        buildPublicationManifest(snapshot),
      );
      if (path) {
        store.setNotice(`Manifiesto guardado: ${basename(path)}`);
      }
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudo guardar el manifiesto',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card" id="prod-publication">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Publicación</p>
          <h3>Originalidad y derechos</h3>
        </div>
        <span className="count-pill">{audit.score}/100</span>
      </div>
      <div className="production-result">
        <div>
          <strong>{audit.checks.aiGeneratedAssets}</strong>
          <span>material(es) generados por IA</span>
        </div>
        <div>
          <strong>{audit.checks.duplicateGroups}</strong>
          <span>grupo(s) duplicados</span>
        </div>
        <div>
          <strong>{audit.checks.platformVariants}</strong>
          <span>variante(s) de entrega</span>
        </div>
      </div>
      <ul className="publication-checks">
        {rows.map((row) => (
          <li key={row.label} className={row.ok ? 'ok' : 'warn'}>
            <span aria-hidden="true">{row.ok ? '✓' : '!'}</span>
            <div>
              <strong>{row.label}</strong>
              <small>{row.detail}</small>
            </div>
          </li>
        ))}
      </ul>
      {audit.issues.length > 0 ? (
        <div className="notice notice-warning" role="status">
          {audit.issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </div>
      ) : null}
      <div className="actions">
        <button type="button" className="primary" onClick={() => void saveManifest()} disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar manifiesto de publicación'}
        </button>
      </div>
      <p className="fine-print">
        El manifiesto incluye hashes, licencias, procedencia y variantes. No publica en redes ni
        sube nada: es un registro local para auditoría, créditos y monetización. Verificá los
        términos de cada voz, banco de imágenes y plataforma antes de publicar.
      </p>
    </article>
  );
}
