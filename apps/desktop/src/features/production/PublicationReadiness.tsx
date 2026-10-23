import { useMemo, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { basename } from '../../lib/format';
import { useProjectStore } from '../../state/project-store';
import {
  auditPublication,
  buildPublicationManifest,
  buildPublicationMetadata,
} from '../../state/publication';

export function PublicationReadiness({
  onNavigate,
}: {
  readonly onNavigate?: (id: ViewId) => void;
}) {
  const store = useProjectStore();
  const project = store.state.project;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [edlBusy, setEdlBusy] = useState(false);
  const [edlPath, setEdlPath] = useState<string | null>(null);
  const [otioPath, setOtioPath] = useState<string | null>(null);
  const [fcpxmlPath, setFcpxmlPath] = useState<string | null>(null);
  const [interchangeWarnings, setInterchangeWarnings] = useState<readonly string[]>([]);
  const audit = useMemo(() => (project ? auditPublication(project) : null), [project]);
  const metadata = useMemo(
    () => (project ? buildPublicationMetadata(project) : null),
    [project],
  );

  if (!project || !audit) return null;
  const snapshot = project;

  async function copyMetadata(): Promise<void> {
    if (!metadata) return;
    const text = `${metadata.title}\n\n${metadata.description}\n\n${metadata.hashtags.join(' ')}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      store.setNotice('Metadatos copiados al portapapeles.');
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      store.setNotice('No se pudo copiar; seleccioná el texto a mano.');
    }
  }

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

  async function exportEdl(): Promise<void> {
    setEdlBusy(true);
    try {
      const dir = await store.service.chooseDownloadDirectory();
      if (!dir) return;
      const result = await store.service.exportEdl({ project: snapshot, outputDir: dir });
      setEdlPath(result.path);
      setInterchangeWarnings(result.warnings);
      store.setNotice(
        `EDL exportado: ${result.events} evento(s), ${result.warnings.length} aviso(s).`,
      );
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudo exportar el EDL',
      );
    } finally {
      setEdlBusy(false);
    }
  }

  async function exportOtio(): Promise<void> {
    setEdlBusy(true);
    try {
      const dir = await store.service.chooseDownloadDirectory();
      if (!dir) return;
      const result = await store.service.exportOtio({ project: snapshot, outputDir: dir });
      setOtioPath(result.path);
      setInterchangeWarnings(result.warnings);
      store.setNotice(`OTIO exportado: ${result.tracks} pista(s), ${result.clips} clip(s).`);
    } catch (error) {
      store.setNotice(error instanceof Error ? error.message : 'no se pudo exportar el OTIO');
    } finally {
      setEdlBusy(false);
    }
  }

  async function exportFcpxml(): Promise<void> {
    setEdlBusy(true);
    try {
      const dir = await store.service.chooseDownloadDirectory();
      if (!dir) return;
      const result = await store.service.exportFcpxml({ project: snapshot, outputDir: dir });
      setFcpxmlPath(result.path);
      setInterchangeWarnings(result.warnings);
      store.setNotice(`FCPXML exportado: ${result.clips} clip(s), ${result.warnings.length} aviso(s).`);
    } catch (error) {
      store.setNotice(error instanceof Error ? error.message : 'no se pudo exportar FCPXML');
    } finally {
      setEdlBusy(false);
    }
  }

  async function exportInterchangeBundle(): Promise<void> {
    setEdlBusy(true);
    try {
      const dir = await store.service.chooseDownloadDirectory();
      if (!dir) return;
      const [edl, otio, fcpxml] = await Promise.all([
        store.service.exportEdl({ project: snapshot, outputDir: dir }),
        store.service.exportOtio({ project: snapshot, outputDir: dir }),
        store.service.exportFcpxml({ project: snapshot, outputDir: dir }),
      ]);
      setEdlPath(edl.path);
      setOtioPath(otio.path);
      setFcpxmlPath(fcpxml.path);
      setInterchangeWarnings([...new Set([...edl.warnings, ...otio.warnings, ...fcpxml.warnings])]);
      store.setNotice(
        `Intercambio listo: EDL ${edl.events} eventos, OTIO ${otio.clips} clips, FCPXML ${fcpxml.clips} clips.`,
      );
    } catch (error) {
      store.setNotice(error instanceof Error ? error.message : 'no se pudo exportar el intercambio');
    } finally {
      setEdlBusy(false);
    }
  }

  return (
    <article className="card" id="prod-publication">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Publicación</p>
          <h3>Originalidad y derechos</h3>
        </div>
        <div className="actions compact">
          {onNavigate ? (
            <button
              type="button"
              className="icon-button"
              aria-label="Abrir cumplimiento"
              title="Reglas de monetización y riesgos por red"
              onClick={() => onNavigate('compliance')}
            >
              <Icon name="shield" size={15} />
            </button>
          ) : null}
          <span className="count-pill">{audit.score}/100</span>
        </div>
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
      {metadata ? (
        <div className="publication-meta">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">Metadatos sugeridos</p>
              <h3>{metadata.title}</h3>
            </div>
            <button type="button" className="small ghost" onClick={() => void copyMetadata()}>
              {copied ? 'Copiado' : 'Copiar texto'}
            </button>
          </div>
          <p>{metadata.description}</p>
          <div className="publication-hashtags">
            {metadata.hashtags.map((hashtag) => (
              <code key={hashtag}>{hashtag}</code>
            ))}
          </div>
          <ul className="publication-platforms">
            {metadata.platforms.map((platform) => (
              <li key={platform.id} className={platform.fits ? 'ok' : 'warn'}>
                <strong>{platform.label}</strong>
                <span>{platform.reason}</span>
              </li>
            ))}
          </ul>
          {metadata.chapters.length > 0 ? (
            <details>
              <summary>Capítulos ({metadata.chapters.length})</summary>
              <ul className="publication-chapters">
                {metadata.chapters.map((chapter) => (
                  <li key={`${chapter.startSeconds}-${chapter.title}`}>
                    <code>{chapter.startSeconds}s</code> {chapter.title}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      <div className="actions">
        <button type="button" className="primary" onClick={() => void saveManifest()} disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar manifiesto de publicación'}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void exportInterchangeBundle()}
          disabled={edlBusy}
          title="Escribe EDL, OTIO y FCPXML en una sola carpeta"
        >
          {edlBusy ? 'Exportando…' : 'Paquete EDL+OTIO+FCPXML'}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => void exportEdl()}
          disabled={edlBusy}
          title="CMX 3600 para llevar la timeline a Resolve o Premiere"
        >
          {edlBusy ? 'Exportando…' : 'Exportar EDL'}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => void exportOtio()}
          disabled={edlBusy}
          title="OpenTimelineIO JSON para Resolve/Premiere y otras apps"
        >
          Exportar OTIO
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => void exportFcpxml()}
          disabled={edlBusy}
          title="FCPXML 1.11 para Final Cut Pro / Resolve"
        >
          Exportar FCPXML
        </button>
      </div>
      {edlPath ? <p className="compress-path">{edlPath}</p> : null}
      {otioPath ? <p className="compress-path">{otioPath}</p> : null}
      {fcpxmlPath ? <p className="compress-path">{fcpxmlPath}</p> : null}
      {interchangeWarnings.length > 0 ? (
        <ul className="fine-print">
          {interchangeWarnings.slice(0, 6).map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <p className="fine-print">
        El manifiesto incluye hashes, licencias, procedencia y variantes. No publica en redes ni
        sube nada: es un registro local para auditoría, créditos y monetización. Verificá los
        términos de cada voz, banco de imágenes y plataforma antes de publicar.
      </p>
    </article>
  );
}
