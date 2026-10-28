import { useEffect, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import {
  MAX_ASSET_BIN_LENGTH,
  MAX_ASSET_TAG_LENGTH,
  MAX_ASSET_TAGS,
} from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import { useThumbnail } from '../../hooks/useThumbnail';
import { useFileDrop } from '../../hooks/useFileDrop';
import { assetBins, filterAssets, type AssetKindFilter } from '../../state/asset-organization';
import {
  BUILTIN_SMART_BINS,
  createSmartBin,
  filterBySmartBin,
  loadCustomSmartBins,
  removeCustomSmartBin,
  saveCustomSmartBins,
  smartBinCount,
  type SmartBin,
} from '../../state/smart-bins';
import {
  addAsset,
  addClipFromAsset,
  framesToSeconds,
  fpsOf,
  markAssetReady,
  relinkAsset,
  removeAsset,
  setAssetProxy,
  toggleAssetFavorite,
  updateAssetLabel,
  updateAssetMetadata,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { buildStoryboard } from '../../state/storyboard';

interface AssetsPanelProps {
  readonly onNavigate: (id: ViewId) => void;
}

function kindLabel(kind: Asset['kind']): string {
  switch (kind) {
    case 'video':
      return 'Video';
    case 'image':
      return 'Imagen';
    case 'audio':
      return 'Audio';
    case 'font':
      return 'Fuente';
    case 'text':
      return 'Texto';
  }
}

function statusLabel(status: Asset['status']): string {
  return { ready: 'listo', unverified: 'sin verificar', missing: 'faltante', failed: 'fallido' }[
    status
  ];
}

function mediaSummary(asset: Asset): string {
  if (asset.kind === 'video' && asset.media) {
    return `${asset.media.width}×${asset.media.height} · ${asset.media.durationFrames} frames`;
  }
  if (asset.kind === 'image' && asset.media) {
    return `${asset.media.width}×${asset.media.height}`;
  }
  if (asset.kind === 'audio' && asset.media) {
    return `${asset.media.sampleRate} Hz · ${asset.media.channels} canales · ${asset.media.durationFrames} frames`;
  }
  return 'sin medición';
}

function AssetCard({
  asset,
  root,
  onUse,
}: {
  readonly asset: Asset;
  readonly root: string;
  readonly onUse: (asset: Asset, narration: boolean) => void;
}) {
  const store = useProjectStore();
  const project = store.state.project;
  const thumbnail = useThumbnail(store.service, asset, root);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(asset.label);
  const [metaOpen, setMetaOpen] = useState(false);
  const [binDraft, setBinDraft] = useState(asset.bin ?? '');
  const [tagsDraft, setTagsDraft] = useState((asset.tags ?? []).join(', '));
  const [relinkBusy, setRelinkBusy] = useState(false);
  const inUse = project?.timeline.clips.some(
    (clip) => clip.source.type === 'asset' && clip.source.assetId === asset.id,
  );
  const selected = store.state.selection.kind === 'asset' && store.state.selection.id === asset.id;
  const canMount = asset.status === 'ready' && (asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'audio');
  const relinkable = asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'audio';

  async function reconectar(): Promise<void> {
    if (!project || relinkBusy || !relinkable) return;
    const title = `Reconectar ${asset.label}`;
    setRelinkBusy(true);
    try {
      const path =
        asset.kind === 'video'
          ? await store.service.chooseVideoFile(title)
          : asset.kind === 'image'
            ? await store.service.chooseImageFile(title)
            : await store.service.chooseAudioFile(title);
      if (!path) return;
      const outcome = await store.service.importMediaPaths({
        paths: [path],
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        confirmRights: true,
      });
      const imported = outcome.assets[0];
      if (!imported) {
        store.setNotice(outcome.warnings[0] ?? 'no se pudo leer el archivo elegido');
        return;
      }
      store.update((current) => relinkAsset(current, asset.id, imported), {
        notice: `Material reconectado: ${asset.label}. Los clips mantienen su lugar.`,
      });
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudo reconectar el material',
      );
    } finally {
      setRelinkBusy(false);
    }
  }

  return (
    <article
      className={selected ? 'asset-card selected' : 'asset-card'}
      onClick={() => store.setSelection({ kind: 'asset', id: asset.id })}
    >
      <div className="asset-thumb">
        {thumbnail ? (
          <img src={thumbnail} alt="" />
        ) : (
          <span className={`asset-kind kind-${asset.kind}`}>{kindLabel(asset.kind)}</span>
        )}
        <span className={`asset-status status-${asset.status}`}>{statusLabel(asset.status)}</span>
        <button
          type="button"
          className={asset.favorite ? 'asset-fav active' : 'asset-fav'}
          aria-pressed={asset.favorite ?? false}
          aria-label={
            asset.favorite
              ? `Quitar ${asset.label} de favoritos`
              : `Marcar ${asset.label} como favorito`
          }
          title={asset.favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          onClick={(event) => {
            event.stopPropagation();
            store.update((current) => toggleAssetFavorite(current, asset.id));
          }}
        >
          <Icon name="star" size={13} />
        </button>
      </div>
      <div className="asset-body">
        {editing ? (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!project) return;
              const ok = store.update((current) => updateAssetLabel(current, asset.id, label));
              if (ok) setEditing(false);
            }}
          >
            <input
              value={label}
              autoFocus
              onChange={(event) => setLabel(event.target.value)}
              onBlur={() => setEditing(false)}
              aria-label="Nombre del material"
            />
          </form>
        ) : (
          <button
            type="button"
            className="asset-title"
            onClick={() => {
              setLabel(asset.label);
              setEditing(true);
            }}
            title="Editar nombre"
          >
            {asset.label}
          </button>
        )}
        <p className="asset-meta">
          {kindLabel(asset.kind)} · {mediaSummary(asset)}
        </p>
        <p className="asset-meta">
          Licencia: {asset.rights.license.id} · {asset.rights.license.commercialUse} ·{' '}
          {asset.integrity ? `${Math.round(asset.integrity.bytes / 1024)} KB` : 'sin hash'}
        </p>
        <p className="asset-meta">
          Bin: {asset.bin ?? 'Sin bin'}{' '}
          {asset.tags?.length ? `· ${asset.tags.join(' · ')}` : '· sin etiquetas'}
        </p>
        {relinkable ? (
          <div className="actions compact" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="small ghost"
              disabled={relinkBusy}
              title="Elegí otro archivo para este material; conserva nombre, licencia y clips"
              onClick={() => void reconectar()}
            >
              {relinkBusy ? 'Reconectando…' : 'Reconectar archivo…'}
            </button>
          </div>
        ) : null}
        {asset.status !== 'ready' ? (
          <div className="rights-actions" onClick={(event) => event.stopPropagation()}>
            <span>Sin derechos confirmados</span>
            <button
              type="button"
              className="small"
              onClick={() => {
                if (!project) return;
                store.update((current) => markAssetReady(current, asset.id, 'allowed'), {
                  notice: `Derechos declarados para ${asset.label}.`,
                });
              }}
            >
              Uso permitido
            </button>
            <button
              type="button"
              className="small"
              onClick={() => {
                if (!project) return;
                store.update((current) => markAssetReady(current, asset.id, 'requires-attribution'), {
                  notice: `Derechos declarados con atribución para ${asset.label}.`,
                });
              }}
            >
              Requiere atribución
            </button>
          </div>
        ) : (
          <div className="actions compact" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="small" disabled={!canMount} onClick={() => onUse(asset, false)}>
              Montar
            </button>
            {asset.kind === 'audio' ? (
              <button type="button" className="small" onClick={() => onUse(asset, true)}>
                Como narración
              </button>
            ) : null}
            <button
              type="button"
              className="small ghost"
              onClick={() => {
                setBinDraft(asset.bin ?? '');
                setTagsDraft((asset.tags ?? []).join(', '));
                setMetaOpen((value) => !value);
              }}
            >
              Metadatos
            </button>
            <button
              type="button"
              className="small danger-ghost"
              disabled={Boolean(inUse)}
              title={inUse ? 'Está en uso en la timeline' : 'Quitar de la biblioteca'}
              onClick={() => {
                if (!project) return;
                store.update((current) => removeAsset(current, asset.id));
              }}
            >
              Quitar
            </button>
          </div>
        )}
        {metaOpen ? (
          <form
            className="asset-meta-form"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              if (!project) return;
              const ok = store.update((current) =>
                updateAssetMetadata(current, asset.id, {
                  bin: binDraft,
                  tags: tagsDraft.split(','),
                }),
              );
              if (ok) setMetaOpen(false);
            }}
          >
            <label className="field">
              <span>Bin</span>
              <input
                value={binDraft}
                maxLength={MAX_ASSET_BIN_LENGTH}
                placeholder="Sin bin"
                onChange={(event) => setBinDraft(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Etiquetas (separadas por coma)</span>
              <input
                value={tagsDraft}
                maxLength={MAX_ASSET_TAGS * (MAX_ASSET_TAG_LENGTH + 2)}
                placeholder="b-roll, entrevista…"
                onChange={(event) => setTagsDraft(event.target.value)}
              />
            </label>
            <div className="actions compact">
              <button type="submit" className="small primary">
                Guardar
              </button>
              <button
                type="button"
                className="small ghost"
                onClick={() => setMetaOpen(false)}
              >
                Cancelar
              </button>
            </div>
            <p className="fine-print">
              Hasta {MAX_ASSET_TAGS} etiquetas de {MAX_ASSET_TAG_LENGTH} caracteres.
            </p>
          </form>
        ) : null}
        {inUse ? <p className="fine-print">En uso en la timeline.</p> : null}
      </div>
    </article>
  );
}

export function AssetsPanel({ onNavigate }: AssetsPanelProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [licenseMode, setLicenseMode] = useState<'allowed' | 'requires-attribution'>('allowed');
  const [photoMotion, setPhotoMotion] = useState<'auto' | 'none'>('auto');
  const [transitionFrames, setTransitionFrames] = useState(8);
  const [imageSeconds, setImageSeconds] = useState(5);
  const [busy, setBusy] = useState(false);
  const [proxyBusy, setProxyBusy] = useState(false);
  const [proxyDone, setProxyDone] = useState(0);
  const [proxyTotal, setProxyTotal] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [assetQuery, setAssetQuery] = useState('');
  const [assetFilter, setAssetFilter] = useState<AssetKindFilter>('all');
  const [assetBin, setAssetBin] = useState('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [smartBins, setSmartBins] = useState<SmartBin[]>([]);
  const [activeBinId, setActiveBinId] = useState<string | null>(null);

  const pendingProxies = (project?.assets ?? []).filter(
    (asset) =>
      asset.kind === 'video' &&
      asset.status === 'ready' &&
      !(('proxy' in asset) && (asset as { proxy?: unknown }).proxy),
  );

  async function createProxies(): Promise<void> {
    if (!project || pendingProxies.length === 0) return;
    setProxyBusy(true);
    setProxyTotal(pendingProxies.length);
    setProxyDone(0);
    setWarnings([]);
    const createdProxies: { assetId: string; proxy: Awaited<ReturnType<typeof store.service.createVideoProxy>> }[] = [];
    const applyCreated = (): void => {
      if (createdProxies.length === 0) return;
      store.update((current) =>
        createdProxies.reduce(
          (project, item) => setAssetProxy(project, item.assetId, item.proxy),
          current,
        ),
      );
    };
    try {
      for (let index = 0; index < pendingProxies.length; index += 1) {
        const asset = pendingProxies[index]!;
        const created = await store.service.createVideoProxy({ path: asset.source.path });
        if (!created.path) {
          throw new Error(`el proxy de ${asset.label} no devolvió una ruta`);
        }
        createdProxies.push({ assetId: asset.id, proxy: created });
        setProxyDone(index + 1);
      }
      applyCreated();
      store.setNotice(
        `Proxies listos: ${pendingProxies.length}. La preview los usa; el render final sigue usando el original.`,
      );
    } catch (failure) {
      applyCreated();
      setWarnings([
        failure instanceof Error
          ? failure.message
          : 'no se pudieron crear todos los proxies',
      ]);
    } finally {
      setProxyBusy(false);
    }
  }

  async function importDropped(paths: readonly string[]): Promise<void> {
    const current = store.state.project;
    if (!current) return;
    if (!rightsConfirmed) {
      setWarnings([
        'Confirmá que tenés derechos para usar y exportar los archivos antes de importar.',
      ]);
      return;
    }
    setBusy(true);
    setWarnings([]);
    try {
      const outcome = await store.service.importMediaPaths({
        paths: [...paths],
        fpsNum: current.video.frameRate.num,
        fpsDen: current.video.frameRate.den,
        confirmRights: true,
      });
      if (outcome.assets.length > 0) {
        store.mutate(
          (current) => {
            let next = current;
            for (const asset of outcome.assets) {
              next = addAsset(next, asset);
              next = markAssetReady(next, asset.id, licenseMode);
            }
            return { project: next };
          },
          { history: false },
        );
        store.setNotice(`${outcome.assets.length} archivo(s) importados al soltarlos.`);
      }
      if (outcome.warnings.length > 0) {
        setWarnings(outcome.warnings);
      }
    } catch (cause) {
      setWarnings([
        cause instanceof Error ? cause.message : 'no se pudieron importar los archivos soltados',
      ]);
    } finally {
      setBusy(false);
    }
  }

  const fileDrop = useFileDrop((paths) => importDropped(paths));

  if (!project) {
    return (
      <section className="view">
        <p className="empty-state">No hay un proyecto abierto. Creá o abrí uno para importar medios.</p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => onNavigate('projects')}>
            Ir a Proyectos
          </button>
        </div>
      </section>
    );
  }

  const root = store.state.opened?.root ?? '';
  const fps = fpsOf(project);
  const bins = assetBins(project.assets);
  // Un smart bin activo reemplaza los filtros manuales: la regla ya trae el
  // tipo, el estado y los favoritos. La búsqueda de texto sigue aplicando.
  const activeBin = [...BUILTIN_SMART_BINS, ...smartBins].find((bin) => bin.id === activeBinId) ?? null;
  const visibleAssets = filterAssets(filterBySmartBin(project.assets, activeBin), {
    query: assetQuery,
    kind: activeBin ? 'all' : assetFilter,
    bin: activeBin ? null : assetBin === 'all' ? null : assetBin,
    favoritesOnly: activeBin ? false : favoritesOnly,
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    setSmartBins(loadCustomSmartBins(window.localStorage));
  }, []);

  function saveCurrentAsSmartBin(): void {
    const name =
      assetQuery.trim() ||
      (favoritesOnly ? 'Favoritos' : '') ||
      (assetFilter !== 'all' ? assetFilter : '') ||
      'Regla';
    const created = createSmartBin({
      name,
      kind: assetFilter === 'all' ? 'all' : assetFilter,
      favoritesOnly,
      bin: assetBin === 'all' ? '' : assetBin,
      query: assetQuery.trim(),
    });
    setSmartBins((current) => [...current, created]);
    if (typeof window !== 'undefined' && window.localStorage) {
      saveCustomSmartBins(window.localStorage, [...smartBins, created]);
    }
    setActiveBinId(created.id);
    setAssetFilter('all');
    setAssetBin('all');
    setFavoritesOnly(false);
    setAssetQuery('');
  }

  function dropSmartBin(id: string): void {
    const next = removeCustomSmartBin(smartBins, id);
    setSmartBins(next);
    if (typeof window !== 'undefined' && window.localStorage) {
      saveCustomSmartBins(window.localStorage, next);
    }
    if (activeBinId === id) setActiveBinId(null);
  }

  async function importMedia(): Promise<void> {
    if (!rightsConfirmed) {
      setWarnings(['Confirmá que tenés derechos para usar y exportar los archivos antes de importar.']);
      return;
    }
    setBusy(true);
    setWarnings([]);
    try {
      const outcome = await store.service.importAssets(project?.video.frameRate.num ?? 30, project?.video.frameRate.den ?? 1);
      if (!outcome) {
        return;
      }
      if (outcome.assets.length > 0) {
        const ok = store.mutate(
          (current) => {
            let next = current;
            for (const asset of outcome.assets) {
              next = addAsset(next, asset);
              next = markAssetReady(next, asset.id, licenseMode);
            }
            return { project: next };
          },
          { notice: `${outcome.assets.length} medio(s) importados a la carpeta del proyecto.` },
        );
        if (ok) {
          setWarnings(outcome.warnings);
        }
      } else {
        setWarnings(outcome.warnings.length ? outcome.warnings : ['No se seleccionó ningún archivo.']);
      }
    } catch (error) {
      setWarnings([error instanceof Error ? error.message : 'la importación falló']);
    } finally {
      setBusy(false);
    }
  }

  function useAsset(asset: Asset, narration: boolean): void {
    const result = store.mutate((current) =>
      addClipFromAsset(current, asset, {
        atFrame: store.state.playheadFrame,
        narration,
      }),
    );
    if (result) {
      store.setSelection({ kind: 'clip', id: result.clipId });
      store.setNotice(`${asset.label} montado en la timeline.`);
      onNavigate('editor');
    }
  }

  async function autoStoryboard(): Promise<void> {
    if (!rightsConfirmed) {
      setWarnings([
        'Confirmá que tenés derechos para usar y exportar los archivos antes de montar el storyboard.',
      ]);
      return;
    }
    setBusy(true);
    setWarnings([]);
    try {
      const outcome = await store.service.importAssets(
        project?.video.frameRate.num ?? 30,
        project?.video.frameRate.den ?? 1,
      );
      if (!outcome) return;
      if (outcome.assets.length === 0) {
        setWarnings(
          outcome.warnings.length ? outcome.warnings : ['No se seleccionó ningún archivo.'],
        );
        return;
      }
      const images = outcome.assets.filter((asset) => asset.kind === 'image');
      if (images.length === 0) {
        setWarnings([
          'Elegí al menos una imagen. Para el audio, seleccioná también el WAV o MP3 de la narración.',
          ...outcome.warnings,
        ]);
        return;
      }
      const audioCandidates = outcome.assets.filter((asset) => asset.kind === 'audio');
      const audio = audioCandidates[0] ?? null;

      const result = store.mutate((current) => {
        let next = current;
        for (const asset of outcome.assets) {
          next = addAsset(next, asset);
          next = markAssetReady(next, asset.id, licenseMode);
        }
        const readyImages = images
          .map((image) => next.assets.find((asset) => asset.id === image.id))
          .filter((asset): asset is Asset => Boolean(asset));
        const readyAudio = audio
          ? next.assets.find((asset) => asset.id === audio.id) ?? null
          : null;
        const storyboard = buildStoryboard(next, {
          images: readyImages,
          audio: readyAudio,
          photoMotion,
          transitionFrames,
          defaultImageSeconds: imageSeconds,
        });
        return {
          project: storyboard.project,
          storyboard,
          imageCount: readyImages.length,
        };
      });

      if (!result) {
        setWarnings(['No se pudo montar el storyboard; revisá el mensaje de error.']);
        return;
      }

      const distributionLabel = {
        audio: 'sincronizado a la narración',
        scenes: 'según las duraciones del guion',
        default: '5 segundos por imagen',
      }[result.storyboard.distribution];
      const extra: string[] = [];
      if (audioCandidates.length > 1) {
        extra.push(
          `Se usó "${audio?.label ?? 'el primer audio'}" como narración; los demás audios quedaron en la biblioteca.`,
        );
      }
      const videos = outcome.assets.filter((asset) => asset.kind === 'video').length;
      if (videos > 0) {
        extra.push(
          `${videos} video(s) se importaron pero no se montaron en el storyboard automático.`,
        );
      }
      setWarnings([...outcome.warnings, ...extra]);
      const firstClip = result.storyboard.imageClipIds[0];
      if (firstClip) store.setSelection({ kind: 'clip', id: firstClip });
      store.setNotice(
        `Storyboard: ${result.imageCount} imagen(es), ${result.storyboard.audioClipId ? 'narración montada' : 'sin audio'}, ${result.storyboard.totalFrames} frames (${distributionLabel}).`,
      );
      onNavigate('editor');
    } catch (error) {
      setWarnings([
        error instanceof Error ? error.message : 'el storyboard automático falló',
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="view assets-view" data-dropping={fileDrop.hovering ? 'true' : undefined}>
      {fileDrop.hovering ? (
        <div className="drop-overlay" role="status">
          <Icon name="plus" size={22} />
          <strong>Soltá para importar</strong>
          <span>Los archivos se agregan al proyecto con sus derechos confirmados</span>
        </div>
      ) : null}
      {fileDrop.lastIgnored.length > 0 && !fileDrop.hovering ? (
        <p className="fine-print">
          Se ignoraron {fileDrop.lastIgnored.length} archivo(s) de formato no soportado.
        </p>
      ) : null}
      <ViewToolbar
        label="Medios"
        actions={
          <>
            <button
              type="button"
              className="ghost icon-text"
              onClick={() => void createProxies()}
              disabled={proxyBusy || pendingProxies.length === 0 || !store.service.available}
              title="Crea versiones ligeras para la preview de todos los videos que aún no tienen proxy"
            >
              <Icon name="film" size={14} />
              <span>
                {proxyBusy
                  ? `Proxies ${proxyDone}/${proxyTotal}…`
                  : `Proxies (${pendingProxies.length})`}
              </span>
            </button>
            <button
              type="button"
              className="ghost icon-text"
              onClick={() => void autoStoryboard()}
              disabled={busy || !store.service.available}
              title="Seleccioná imágenes y una narración; se montan en orden por nombre"
            >
              <Icon name="sparkles" size={14} />
              <span>Auto-montar lote…</span>
            </button>
            <button
              type="button"
              className="primary icon-text"
              onClick={() => void importMedia()}
              disabled={busy || !store.service.available}
            >
              <Icon name="plus" size={14} />
              <span>{busy ? 'Importando…' : 'Importar medios…'}</span>
            </button>
          </>
        }
      >
        <span className="view-count">{project.assets.length} medios</span>
        {bins.length > 0 ? <span className="view-count">{bins.length} carpetas</span> : null}
      </ViewToolbar>

      <div className="import-bar">
        <label className="check">
          <input
            type="checkbox"
            checked={rightsConfirmed}
            onChange={(event) => setRightsConfirmed(event.target.checked)}
          />
          <span>Confirmo que tengo derechos para usar y exportar estos archivos.</span>
        </label>
        <label className="field inline">
          <span>Licencia declarada</span>
          <select
            value={licenseMode}
            onChange={(event) => setLicenseMode(event.target.value as 'allowed' | 'requires-attribution')}
          >
            <option value="allowed">Uso comercial permitido</option>
            <option value="requires-attribution">Requiere atribución</option>
          </select>
        </label>
        <label className="field inline">
          <span>Movimiento automático</span>
          <select
            value={photoMotion}
            onChange={(event) => setPhotoMotion(event.target.value as 'auto' | 'none')}
          >
            <option value="auto">Ken Burns alternado</option>
            <option value="none">Sin movimiento</option>
          </select>
        </label>
        <label className="field inline">
          <span>Segundos por imagen (sin audio)</span>
          <input
            type="number"
            min={1}
            max={30}
            step={1}
            value={imageSeconds}
            onChange={(event) =>
              setImageSeconds(Math.max(1, Math.min(30, Math.round(Number(event.target.value) || 5))))
            }
          />
        </label>
        <label className="field inline">
          <span>Transición (frames)</span>
          <input
            type="number"
            min={0}
            max={30}
            step={1}
            value={transitionFrames}
            onChange={(event) =>
              setTransitionFrames(
                Math.max(0, Math.min(30, Math.round(Number(event.target.value) || 0))),
              )
            }
          />
        </label>
      </div>
      <p className="fine-print">
        El formato de proyecto rechaza materiales “ready” con licencia desconocida. El render
        también se detiene si un clip usa un material sin derechos declarados.
      </p>

      {warnings.length > 0 ? (
        <div className="notice notice-warning" role="status">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      <div className="smart-bins" role="group" aria-label="Smart Bins">
        <span className="smart-bins-label">Smart Bins</span>
        {[...BUILTIN_SMART_BINS, ...smartBins].map((bin) => (
          <span key={bin.id} className="smart-bin-chip">
            <button
              type="button"
              className={activeBinId === bin.id ? 'smart-bin active' : 'smart-bin'}
              aria-pressed={activeBinId === bin.id}
              onClick={() => {
                setActiveBinId((current) => (current === bin.id ? null : bin.id));
                if (activeBinId !== bin.id) {
                  setAssetFilter('all');
                  setAssetBin('all');
                  setFavoritesOnly(false);
                }
              }}
            >
              {bin.name}
              <em>{smartBinCount(project.assets, bin)}</em>
            </button>
            {bin.builtin ? null : (
              <button
                type="button"
                className="smart-bin-remove"
                aria-label={`Quitar smart bin ${bin.name}`}
                title="Quitar esta regla"
                onClick={() => dropSmartBin(bin.id)}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <button
          type="button"
          className="small"
          onClick={saveCurrentAsSmartBin}
          title="Guardá los filtros de abajo como una regla reutilizable"
        >
          Guardar filtro como regla
        </button>
      </div>

      <div className="library-toolbar">
        <label className="library-search">
          <Icon name="search" size={14} />
          <input
            type="search"
            value={assetQuery}
            placeholder="Buscar por nombre, etiqueta, bin o ruta…"
            aria-label="Buscar en la biblioteca de medios"
            onChange={(event) => setAssetQuery(event.target.value)}
          />
        </label>        <label className="field inline library-filter">
          <span>Tipo</span>
          <select
            value={assetFilter}
            aria-label="Filtrar biblioteca por tipo"
            onChange={(event) =>
              setAssetFilter(event.target.value as AssetKindFilter)
            }
          >
            <option value="all">Todos</option>
            <option value="video">Video</option>
            <option value="image">Imagen</option>
            <option value="audio">Audio</option>
          </select>
        </label>
        {bins.length > 0 ? (
          <label className="field inline library-filter">
            <span>Bin</span>
            <select
              value={assetBin}
              aria-label="Filtrar biblioteca por bin"
              onChange={(event) => setAssetBin(event.target.value)}
            >
              <option value="all">Todos</option>
              {bins.map((bin) => (
                <option key={bin} value={bin}>
                  {bin}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className={favoritesOnly ? 'library-fav active' : 'library-fav'}
          aria-pressed={favoritesOnly}
          title="Mostrar solo favoritos"
          onClick={() => setFavoritesOnly((value) => !value)}
        >
          <Icon name="star" size={13} />
          <span>Solo favoritos</span>
        </button>
        <span className="library-count">
          {visibleAssets.length} de {project.assets.length} medios
        </span>
      </div>

      {visibleAssets.length === 0 ? (
        <p className="empty-state">
          {project.assets.length === 0
            ? 'No hay assets todavía. Importá un video, una imagen o un audio; cada archivo llega con hash, medición y licencia declarada por vos.'
            : 'Ningún medio coincide con la búsqueda o el filtro.'}
        </p>
      ) : (
        <div className="asset-grid">
          {visibleAssets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} root={root} onUse={useAsset} />
          ))}
        </div>
      )}

      <div className="assets-foot">
        <p className="fine-print">
          Duración del proyecto: {framesToSeconds(store.durationFrames, fps).toFixed(1)} s ·{' '}
          {project.timeline.clips.length} clips en la timeline.
        </p>
        <button type="button" className="ghost" onClick={() => onNavigate('editor')}>
          Volver al editor
        </button>
      </div>
    </section>
  );
}
