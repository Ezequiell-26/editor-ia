import { useMemo, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { addAsset, fpsOf, markAssetReady, newId } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { LottiePreview } from './LottiePreview';
import {
  createLottieRasterizer,
  LOTTIE_MAX_FILE_BYTES,
  LOTTIE_MAX_FRAMES,
  LottieParseError,
  parseLottieDocument,
  planLottieExport,
  type LottieDocument,
} from './lottie';

const BATCH_SIZE = 8;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'no se pudo convertir el Lottie';
}

/** WebView2 tiene `File.text()`; el DOM de los tests sólo FileReader. */
async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('no se pudo leer el archivo'));
    reader.readAsText(file);
  });
}

export function LottiePanel({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const projectFps = project ? fpsOf(project) : 30;
  const [fileName, setFileName] = useState<string | null>(null);
  const [doc, setDoc] = useState<LottieDocument | null>(null);
  const [fpsValue, setFpsValue] = useState(projectFps);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const plan = useMemo(
    () => (doc ? planLottieExport(doc, { fps: fpsValue }) : null),
    [doc, fpsValue],
  );

  async function loadFile(file: File | undefined): Promise<void> {
    setError(null);
    setResult(null);
    setDoc(null);
    setFileName(null);
    if (!file) return;
    if (file.size === 0) {
      setError('El archivo está vacío.');
      return;
    }
    if (file.size > LOTTIE_MAX_FILE_BYTES) {
      setError(
        `El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB; el tope es ${
          LOTTIE_MAX_FILE_BYTES / 1024 / 1024
        } MB.`,
      );
      return;
    }
    try {
      const parsed = parseLottieDocument(JSON.parse(await readFileText(file)) as unknown);
      setDoc(parsed);
      setFileName(file.name);
      setFpsValue(Math.max(1, Math.min(60, Math.round(projectFps))));
    } catch (cause) {
      setError(
        cause instanceof LottieParseError
          ? cause.message
          : cause instanceof SyntaxError
            ? 'El archivo no es un JSON válido.'
            : messageOf(cause),
      );
    }
  }

  async function convert(): Promise<void> {
    if (!project) {
      store.setNotice('Abrí o creá un proyecto antes de convertir el Lottie.');
      return;
    }
    if (!doc || !plan) return;
    if (!rights) {
      setError('Confirmá que tenés derechos para usar esta animación.');
      return;
    }
    const token = newId();
    const label = (fileName ?? 'Lottie').replace(/\.(json|lottie)$/i, '').trim().slice(0, 120);
    setBusy(true);
    setProgress(0);
    setError(null);
    setResult(null);
    let rasterizer: Awaited<ReturnType<typeof createLottieRasterizer>> | null = null;
    let wroteFrames = false;
    try {
      rasterizer = await createLottieRasterizer(doc, plan);
      for (let start = 0; start < plan.frameCount; start += BATCH_SIZE) {
        const end = Math.min(plan.frameCount, start + BATCH_SIZE);
        const frames: string[] = [];
        for (let index = start; index < end; index += 1) {
          frames.push(await rasterizer.renderFrame(index));
        }
        await store.service.writeAlphaFrames({ token, startIndex: start, frames });
        wroteFrames = true;
        setProgress(Math.round((end / plan.frameCount) * 100));
      }
      const asset = await store.service.alphaFramesToAsset({
        token,
        label: label || 'Lottie',
        width: plan.width,
        height: plan.height,
        frameCount: plan.frameCount,
        fpsNum: plan.fpsNum,
        fpsDen: plan.fpsDen,
      });
      const ok = store.mutate(
        (current) => ({
          project: markAssetReady(addAsset(current, asset), asset.id, 'allowed'),
        }),
        {
          notice: `Lottie en Medios: ${asset.label} · ${plan.width}×${plan.height} · ${plan.frameCount} frames con alfa.`,
        },
      );
      if (!ok) {
        setError('El video del Lottie no deja el proyecto en un estado válido.');
        return;
      }
      setResult(
        `${asset.label}: video VP9 con transparencia agregado a Medios. Ya se puede montar en la timeline.`,
      );
      onNavigate('assets');
    } catch (cause) {
      if (wroteFrames) {
        await store.service.discardAlphaFrames(token).catch(() => {});
      }
      setError(messageOf(cause));
    } finally {
      rasterizer?.dispose();
      setBusy(false);
    }
  }

  return (
    <div className="card lottie-panel">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Archivo</p>
          <h3>Lottie (.json)</h3>
        </div>
        <span className="fine-print">Motor local · VP9 con alfa</span>
      </div>
      <p className="fine-print">
        Importá una animación Lottie y convertila en un video con transparencia real para la
        timeline. Se rasteriza en la app con lottie-web (MIT) y FFmpeg lo codifica; no se sube
        nada a ningún lado.
      </p>
      <label className="lottie-file">
        <span>Archivo Lottie</span>
        <input
          type="file"
          accept=".json,application/json"
          aria-label="Archivo Lottie"
          disabled={busy}
          onChange={(event) => void loadFile(event.target.files?.[0])}
        />
      </label>
      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}
      {doc && plan ? (
        <div className="lottie-work">
          <LottiePreview document={doc} />
          <div className="lottie-meta">
            <p>
              <strong>{fileName}</strong>
            </p>
            <p className="fine-print">
              Original: {doc.width}×{doc.height} px · {doc.fps} fps ·{' '}
              {doc.durationSeconds.toFixed(2)} s · {doc.layerCount} capa
              {doc.layerCount === 1 ? '' : 's'}
            </p>
            <p className="fine-print">
              Salida: {plan.width}×{plan.height} px · {plan.fpsNum} fps · {plan.frameCount}{' '}
              frames · {plan.durationSeconds.toFixed(2)} s
            </p>
            {plan.trimmed ? (
              <p className="notice notice-warning">
                La animación se recorta al tope de {LOTTIE_MAX_FRAMES} frames.
              </p>
            ) : null}
            <label className="lottie-fps">
              <span>Frames por segundo de salida</span>
              <input
                type="number"
                min={1}
                max={60}
                step={1}
                value={fpsValue}
                disabled={busy}
                onChange={(event) =>
                  setFpsValue(Math.max(1, Math.min(60, Math.round(Number(event.target.value) || 1))))
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={rights}
                disabled={busy}
                onChange={(event) => setRights(event.target.checked)}
              />
              <span>Tengo derechos para usar esta animación.</span>
            </label>
            <div className="actions compact">
              <button
                type="button"
                className="primary"
                disabled={!project || busy || !rights || plan.frameCount < 1}
                onClick={() => void convert()}
              >
                {busy ? `Convirtiendo… ${progress}%` : 'Convertir en video con alfa'}
              </button>
              {busy ? (
                <progress
                  className="lottie-progress"
                  max={100}
                  value={progress}
                  aria-label="Progreso de la conversión Lottie"
                />
              ) : null}
            </div>
            {!project ? (
              <p className="fine-print">Abrí o creá un proyecto para agregar el video a Medios.</p>
            ) : null}
            {result ? (
              <p className="notice" role="status">
                {result}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
