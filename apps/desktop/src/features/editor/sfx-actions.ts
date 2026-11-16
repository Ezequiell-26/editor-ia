import type { SfxItem } from '../../services/contracts';
import type { ProjectStoreValue } from '../../state/project-store-types';
import { addAsset, addClipFromAsset, fpsOf } from '../../state/project-actions';

/**
 * Monta un efecto de sonido de la biblioteca en la timeline (paridad del
 * «uso» de `sons.js` de AlaukCut): reusa el asset si el WAV ya está
 * importado (`provider: 'sfx'`, dedupe por nombre de archivo) o lo importa
 * una vez al proyecto, y lo inserta como clip de audio en `atFrame`.
 * Lo comparten `SfxLibrary` (playhead) y el menú contextual del clip
 * (inicio del clip).
 */
export async function addSfxToTimeline(
  store: ProjectStoreValue,
  item: SfxItem,
  atFrame: number,
): Promise<void> {
  const project = store.state.project;
  if (!project) return;
  // Si el WAV ya está importado se reusa el asset; si no, se copia al
  // proyecto una sola vez (import_media_paths es idempotente por path).
  const existing = project.assets.find(
    (asset) =>
      asset.kind === 'audio' &&
      asset.rights.provenance.provider === 'sfx' &&
      asset.source.path.endsWith(`/${item.file}`),
  );
  let asset = existing;
  if (!asset) {
    const outcome = await store.service.importMediaPaths({
      paths: [item.path],
      fpsNum: project.video.frameRate.num,
      fpsDen: project.video.frameRate.den,
      confirmRights: true,
      provider: 'sfx',
    });
    asset = outcome.assets[0];
    if (!asset) {
      store.setNotice(outcome.warnings[0] ?? `no se pudo importar ${item.label}`);
      return;
    }
    store.update((current) => addAsset(current, asset!));
  }
  const mounted = store.mutate((current) =>
    addClipFromAsset(current, asset!, {
      atFrame,
      durationFrames: Math.max(
        1,
        Math.round(item.durationSeconds * fpsOf(project)),
      ),
    }),
  );
  if (mounted) {
    store.setSelection({ kind: 'clip', id: mounted.clipId });
    store.setNotice(`${item.label} montado en la timeline.`);
  }
}
