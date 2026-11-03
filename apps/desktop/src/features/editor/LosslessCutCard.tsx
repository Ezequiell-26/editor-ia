import { useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import { useProjectStore } from '../../state/project-store';

/**
 * Corte sin recodificar de un medio.
 *
 * Copia los paquetes entre dos segundos: sirve para sacar un pedazo de una
 * grabación larga sin renderizar. El corte cae en el keyframe anterior, así que
 * se muestra la duración real y cuánto se corrió el inicio en vez de fingir
 * precisión.
 */
export function LosslessCutCard({ asset }: { readonly asset: Asset }) {
  const store = useProjectStore();
  const opened = store.state.opened;
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [exact, setExact] = useState(false);
  const [container, setContainer] = useState('mkv');
  const [result, setResult] = useState<string | null>(null);

  if (asset.kind !== 'video' && asset.kind !== 'audio') return null;
  if (!opened) {
    return (
      <section className="card" aria-label="Corte sin recodificar">
        <p className="fine-print">Guardá el proyecto para cortar sin recodificar.</p>
      </section>
    );
  }

  const durationSeconds =
    'media' in asset && asset.media && 'durationFrames' in asset.media
      ? asset.media.durationFrames / Math.max(1, store.state.project?.video.frameRate.num ?? 30)
      : 0;

  async function run(): Promise<void> {
    if (busy) return;
    const from = Number(start);
    const to = end.trim() ? Number(end) : durationSeconds;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      setResult('El fin tiene que ser mayor que el inicio.');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const input = store.service.joinPath(opened!.root, asset.source.path);
      const folder = store.service.joinPath(opened!.root, 'entregas');
      const output = store.service.joinPath(
        folder,
        `${asset.label.replace(/[\\/:*?"<>|]/g, '-')}-corte.mp4`,
      );
      const outcome = await store.service.exportLossless({
        input,
        output,
        startSeconds: from,
        endSeconds: to,
        exact,
      });
      const shift = outcome.startShiftSeconds;
      setResult(
        `Listo: ${outcome.actualSeconds.toFixed(2)} s reales (pediste ${outcome.requestedSeconds.toFixed(
          2,
        )} s${shift > 0.05 ? `, el corte se corrió ${shift.toFixed(2)} s por el keyframe` : ''}).`,
      );
      store.setNotice(`Corte guardado en ${outcome.path}`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'no se pudo cortar');
    } finally {
      setBusy(false);
    }
  }

  /** Cambia el contenedor sin tocar los códecs. */
  async function changeContainer(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const input = store.service.joinPath(opened!.root, asset.source.path);
      const folder = store.service.joinPath(opened!.root, 'entregas');
      const output = store.service.joinPath(
        folder,
        `${asset.label.replace(/[\\/:*?"<>|]/g, '-')}.${container}`,
      );
      const outcome = await store.service.remux({ input, output });
      setResult(`Contenedor cambiado a ${container}: ${(outcome.bytes / 1_000_000).toFixed(1)} MB.`);
      store.setNotice(`Archivo guardado en ${outcome.path}`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'no se pudo cambiar el contenedor');
    } finally {
      setBusy(false);
    }
  }

  /** Escribe los marcadores de la timeline como capítulos del archivo. */
  async function writeChapters(): Promise<void> {
    if (busy) return;
    const project = store.state.project;
    const markers = [...(project?.markers ?? [])].sort((a, b) => a.frame - b.frame);
    if (markers.length === 0) {
      setResult('No hay marcadores en la timeline. Agregá alguno para usarlo como capítulo.');
      return;
    }
    const fps = project?.video.frameRate.num ?? 30;
    setBusy(true);
    setResult(null);
    try {
      const input = store.service.joinPath(opened!.root, asset.source.path);
      const folder = store.service.joinPath(opened!.root, 'entregas');
      const output = store.service.joinPath(
        folder,
        `${asset.label.replace(/[\\/:*?"<>|]/g, '-')}-capitulos.mp4`,
      );
      const chapters = markers.map((marker, index) => ({
        startSeconds: marker.frame / fps,
        endSeconds:
          index + 1 < markers.length
            ? (markers[index + 1]?.frame ?? marker.frame) / fps
            : durationSeconds || marker.frame / fps + 5,
        title: marker.label,
      }));
      const outcome = await store.service.writeChapters({
        input,
        output,
        ...(project?.name ? { title: project.name } : {}),
        chapters,
      });
      setResult(`Capítulos escritos: ${outcome.chapters} en ${outcome.path.split('\\').pop()}.`);
      store.setNotice(`Capítulos guardados en ${outcome.path}`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'no se pudieron escribir los capítulos');
    } finally {
      setBusy(false);
    }
  }

  /** Saca la pista de audio sin recodificar; el contenedor lo elige el códec. */
  async function extractAudio(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const input = store.service.joinPath(opened!.root, asset.source.path);
      const folder = store.service.joinPath(opened!.root, 'entregas');
      const output = store.service.joinPath(
        folder,
        `${asset.label.replace(/[\\/:*?"<>|]/g, '-')}-audio.mka`,
      );
      const outcome = await store.service.extractAudio({ input, output });
      setResult(
        `Audio extraído (${outcome.codec}) en ${outcome.path.split('\\').pop()}: ${(
          outcome.bytes / 1_000_000
        ).toFixed(1)} MB.`,
      );
      store.setNotice(`Audio guardado en ${outcome.path}`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'no se pudo extraer el audio');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Corte sin recodificar">
      <header className="card-head">
        <div>
          <p className="eyebrow">Sin recodificar</p>
          <h4>Cortar un rango</h4>
          <p className="fine-print">
            Copia los paquetes: no pierde calidad y tarda segundos. El inicio cae en el keyframe
            anterior.
          </p>
        </div>
      </header>
      <div className="form-grid">
        <label className="field">
          <span>Inicio (s)</span>
          <input
            type="number"
            min={0}
            step="0.1"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Fin (s)</span>
          <input
            type="number"
            min={0}
            step="0.1"
            value={end}
            placeholder={durationSeconds > 0 ? durationSeconds.toFixed(1) : 'final'}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={exact}
          onChange={(event) => setExact(event.target.checked)}
        />
        <span className="fine-print">
          Corte exacto (recodifica el rango: más lento, sin corrimiento)
        </span>
      </label>
      <button type="button" className="small primary" disabled={busy} onClick={() => void run()}>
        {busy ? 'Cortando…' : 'Cortar sin recodificar'}
      </button>
      <div className="form-grid">
        <label className="field">
          <span>Contenedor</span>
          <select value={container} onChange={(event) => setContainer(event.target.value)}>
            <option value="mkv">MKV</option>
            <option value="mp4">MP4</option>
            <option value="mov">MOV</option>
            <option value="webm">WebM</option>
          </select>
        </label>
        <button type="button" className="small ghost" disabled={busy} onClick={() => void changeContainer()}>
          Cambiar contenedor
        </button>
        <button type="button" className="small ghost" disabled={busy} onClick={() => void writeChapters()}>
          Escribir capítulos
        </button>
        <button type="button" className="small ghost" disabled={busy} onClick={() => void extractAudio()}>
          Extraer audio
        </button>
      </div>
      {result ? <p className="fine-print">{result}</p> : null}
    </section>
  );
}
