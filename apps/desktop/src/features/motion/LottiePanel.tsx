import { useMemo, useRef, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { addAsset, fpsOf, markAssetReady } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { rasterizeLottieToAsset } from './lottie-import';
import {
  LottieArchiveError,
  parseLottieArchive,
  type LottieArchiveResult,
} from './lottie-archive';
import {
  LottieStateMachineRuntime,
  type LottieStateMachineSnapshot,
} from './lottie-state-machine';
import { applyLottieTheme } from './lottie-theme';
import { LottiePreview } from './LottiePreview';
import {
  LOTTIE_MAX_FILE_BYTES,
  LOTTIE_MAX_FRAMES,
  LottieParseError,
  parseLottieDocument,
  planLottieExport,
  type LottieDocument,
} from './lottie';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'no se pudo convertir el Lottie';
}

interface ArchiveView {
  readonly doc: LottieDocument;
  readonly segment: readonly [number, number] | null;
  readonly warnings: readonly string[];
  readonly applied: number;
  readonly animationId: string;
}

/**
 * Resuelve el estado actual de la máquina, el tema y el segmento a un documento
 * listo para preview/export. Un solo camino evita que preview y export difieran.
 */
function buildArchiveView(
  archive: LottieArchiveResult,
  themeId: string | null,
  runtime: LottieStateMachineRuntime | null,
): ArchiveView {
  const snapshot = runtime?.snapshot() ?? null;
  const animationId = snapshot?.state?.animation ?? archive.animationId ?? '';
  const warnings: string[] = [];
  if (snapshot?.state?.animation && !archive.animations.has(snapshot.state.animation)) {
    warnings.push(
      `El estado "${snapshot.currentState}" usa la animación "${snapshot.state.animation}", que no está en el pack; se usó "${archive.animationId}".`,
    );
  }
  const raw = archive.animations.get(animationId) ?? archive.raw;
  const theme = themeId ? archive.themes.get(themeId) : undefined;
  const themed = theme
    ? applyLottieTheme(raw, theme, animationId)
    : { raw, applied: 0, warnings: [] as string[] };
  warnings.push(...themed.warnings, ...(snapshot?.warnings ?? []));
  let doc = parseLottieDocument(themed.raw);
  let segment: readonly [number, number] | null = null;
  const stateSegment = snapshot?.state?.segment;
  if (stateSegment) {
    const start = Math.max(doc.inFrame, Math.min(stateSegment[0], stateSegment[1]));
    const end = Math.min(doc.outFrame, Math.max(stateSegment[0], stateSegment[1]));
    if (end > start) {
      segment = [start, end];
      doc = { ...doc, inFrame: start, outFrame: end, durationSeconds: (end - start) / doc.fps };
    } else {
      warnings.push(
        'El segmento del estado quedó fuera de la animación; se exporta la animación completa.',
      );
    }
  }
  return { doc, segment, warnings, applied: themed.applied, animationId };
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

/** Igual que `readFileText`, pero para el ZIP de un pack .lottie. */
async function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return new Uint8Array(await file.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new Error('no se pudo leer el archivo'));
    reader.readAsArrayBuffer(file);
  });
}

export function LottiePanel({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const projectFps = project ? fpsOf(project) : 30;
  const [fileName, setFileName] = useState<string | null>(null);
  const [doc, setDoc] = useState<LottieDocument | null>(null);
  const [archive, setArchive] = useState<LottieArchiveResult | null>(null);
  const [themeId, setThemeId] = useState<string | null>(null);
  const [machineId, setMachineId] = useState<string | null>(null);
  const [machineSnapshot, setMachineSnapshot] = useState<LottieStateMachineSnapshot | null>(null);
  const [packWarnings, setPackWarnings] = useState<readonly string[]>([]);
  const [themeApplied, setThemeApplied] = useState(0);
  const [segment, setSegment] = useState<readonly [number, number] | null>(null);
  const [fpsValue, setFpsValue] = useState(projectFps);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const runtimeRef = useRef<LottieStateMachineRuntime | null>(null);

  const machines = archive ? [...archive.stateMachines.values()] : [];
  const themeOptions = archive ? [...archive.themes.values()] : [];
  const machine = machineId
    ? archive?.stateMachines.get(machineId) ?? null
    : machines[0] ?? null;
  const machineInputs = machine?.inputs ?? [];
  const activeState = machineSnapshot?.state ?? null;
  const warnings = useMemo(() => [...new Set(packWarnings)], [packWarnings]);

  const plan = useMemo(
    () => (doc ? planLottieExport(doc, { fps: fpsValue }) : null),
    [doc, fpsValue],
  );

  function applyArchiveView(
    target: LottieArchiveResult,
    nextTheme: string | null,
    runtime: LottieStateMachineRuntime | null,
  ): void {
    try {
      const view = buildArchiveView(target, nextTheme, runtime);
      setDoc(view.doc);
      setSegment(view.segment);
      setThemeApplied(view.applied);
      setPackWarnings([...target.warnings, ...view.warnings]);
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  function syncRuntime(runtime: LottieStateMachineRuntime | null): void {
    setMachineSnapshot(runtime?.snapshot() ?? null);
    if (!archive) return;
    const nextTheme = runtime?.snapshot().themeId ?? themeId;
    setThemeId(nextTheme);
    applyArchiveView(archive, nextTheme, runtime);
  }

  function changeTheme(next: string | null): void {
    runtimeRef.current?.setTheme(next);
    setThemeId(next);
    if (archive) applyArchiveView(archive, next, runtimeRef.current);
  }

  function changeMachine(next: string | null): void {
    if (!archive) return;
    const selected = next ? archive.stateMachines.get(next) : undefined;
    const runtime = selected
      ? new LottieStateMachineRuntime(selected, { initialTheme: themeId })
      : null;
    runtimeRef.current = runtime;
    setMachineId(next);
    syncRuntime(runtime);
  }

  function updateInput(name: string, value: boolean | number | string): void {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.setInput(name, value);
    syncRuntime(runtime);
  }

  function fireInput(name: string): void {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.fireEvent(name);
    syncRuntime(runtime);
  }

  function resetMachine(): void {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.reset();
    syncRuntime(runtime);
  }

  async function loadFile(file: File | undefined): Promise<void> {
    setError(null);
    setResult(null);
    setDoc(null);
    setArchive(null);
    setThemeId(null);
    setMachineId(null);
    setMachineSnapshot(null);
    setPackWarnings([]);
    setThemeApplied(0);
    setSegment(null);
    runtimeRef.current = null;
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
      const isArchive =
        /\.lottie$/i.test(file.name) ||
        file.type === 'application/zip' ||
        file.type === 'application/x-zip-compressed';
      if (isArchive) {
        const nextArchive = await parseLottieArchive(await readFileBytes(file));
        const firstMachine = nextArchive.stateMachines.values().next().value ?? null;
        const runtime = firstMachine
          ? new LottieStateMachineRuntime(firstMachine, {
              initialTheme: nextArchive.initialTheme,
            })
          : null;
        const initialTheme = runtime?.snapshot().themeId ?? nextArchive.initialTheme;
        const view = buildArchiveView(nextArchive, initialTheme, runtime);
        runtimeRef.current = runtime;
        setArchive(nextArchive);
        setThemeId(initialTheme);
        setMachineId(firstMachine?.id ?? null);
        setMachineSnapshot(runtime?.snapshot() ?? null);
        setThemeApplied(view.applied);
        setSegment(view.segment);
        setPackWarnings([...nextArchive.warnings, ...view.warnings]);
        setDoc(view.doc);
      } else {
        const raw = JSON.parse(await readFileText(file)) as unknown;
        setDoc(parseLottieDocument(raw));
      }
      setFileName(file.name);
      setFpsValue(Math.max(1, Math.min(60, Math.round(projectFps))));
    } catch (cause) {
      setError(
        cause instanceof LottieParseError || cause instanceof LottieArchiveError
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
    const label = (fileName ?? 'Lottie').replace(/\.(json|lottie)$/i, '').trim().slice(0, 120);
    setBusy(true);
    setProgress(0);
    setError(null);
    setResult(null);
    try {
      const asset = await rasterizeLottieToAsset({
        service: store.service,
        document: doc,
        plan,
        label: label || 'Lottie',
        onProgress: setProgress,
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
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card lottie-panel">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Archivo</p>
          <h3>Lottie (.json / .lottie)</h3>
        </div>
        <span className="fine-print">Motor local · VP9 con alfa</span>
      </div>
      <p className="fine-print">
        Importá una animación Lottie (.json) o un pack .lottie con imágenes embebidas y
        convertíla en un video con transparencia real para la timeline. Se rasteriza en la app
        con lottie-web (MIT) y FFmpeg lo codifica; no se sube nada a ningún lado.
      </p>
      <label className="lottie-file">
        <span>Archivo Lottie (.json o .lottie)</span>
        <input
          type="file"
          accept=".json,.lottie,application/json,application/zip"
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
          <LottiePreview
            document={doc}
            segment={segment}
            loop={activeState?.loop ?? true}
          />
          <div className="lottie-meta">
            <p>
              <strong>{fileName}</strong>
            </p>
            <p className="fine-print">
              Original: {doc.width}×{doc.height} px · {doc.fps} fps ·{' '}
              {doc.durationSeconds.toFixed(2)} s · {doc.layerCount} capa
              {doc.layerCount === 1 ? '' : 's'}
            </p>
            {archive ? (
              <p className="fine-print">
                Pack .lottie · animación{' '}
                <strong>{activeState?.animation ?? archive.animationId}</strong> ·{' '}
                {archive.embeddedAssets} imagen
                {archive.embeddedAssets === 1 ? '' : 'es'} embebida
                {archive.embeddedAssets === 1 ? '' : 's'}
              </p>
            ) : null}
            {warnings.map((warning) => (
              <p className="notice notice-warning" role="status" key={warning}>
                {warning}
              </p>
            ))}
            {archive && themeOptions.length > 0 ? (
              <label className="lottie-select">
                <span>Tema del pack</span>
                <select
                  value={themeId ?? ''}
                  aria-label="Tema del pack"
                  disabled={busy}
                  onChange={(event) => changeTheme(event.target.value || null)}
                >
                  <option value="">Sin tema</option>
                  {themeOptions.map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {theme.name ?? theme.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {themeId ? (
              <p className="fine-print">
                Tema aplicado: {themeApplied} regla{themeApplied === 1 ? '' : 's'}.
              </p>
            ) : null}
            {segment ? (
              <p className="fine-print">
                Segmento del estado: frames {segment[0]}–{segment[1]}.
              </p>
            ) : null}
            {archive && machines.length > 0 ? (
              <div className="lottie-state-machine">
                <div className="production-card-head">
                  <div>
                    <p className="eyebrow">State machine</p>
                    <strong>{machine?.name ?? machineId ?? 'Máquina'}</strong>
                  </div>
                  <span className="count-pill">
                    Estado: {machineSnapshot?.currentState ?? '—'}
                  </span>
                </div>
                {machines.length > 1 ? (
                  <label className="lottie-select">
                    <span>Máquina</span>
                    <select
                      value={machineId ?? ''}
                      aria-label="State machine"
                      disabled={busy}
                      onChange={(event) => changeMachine(event.target.value || null)}
                    >
                      {machines.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name ?? entry.id}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <p className="fine-print">
                  Animación: {activeState?.animation ?? archive.animationId}
                  {activeState?.segment
                    ? ` · segmento ${activeState.segment[0]}–${activeState.segment[1]}`
                    : ''}
                </p>
                {machineInputs.map((input) => {
                  const value = machineSnapshot?.inputs[input.name];
                  if (input.type === 'Boolean') {
                    return (
                      <label className="check" key={input.name}>
                        <input
                          type="checkbox"
                          checked={value === true}
                          disabled={busy}
                          aria-label={`Input ${input.name}`}
                          onChange={(event) => updateInput(input.name, event.target.checked)}
                        />
                        <span>{input.name}</span>
                      </label>
                    );
                  }
                  if (input.type === 'Numeric') {
                    return (
                      <label className="lottie-select" key={input.name}>
                        <span>{input.name}</span>
                        <input
                          type="number"
                          value={typeof value === 'number' ? value : 0}
                          disabled={busy}
                          aria-label={`Input ${input.name}`}
                          onChange={(event) => updateInput(input.name, Number(event.target.value))}
                        />
                      </label>
                    );
                  }
                  if (input.type === 'String') {
                    return (
                      <label className="lottie-select" key={input.name}>
                        <span>{input.name}</span>
                        <input
                          type="text"
                          value={typeof value === 'string' ? value : ''}
                          disabled={busy}
                          aria-label={`Input ${input.name}`}
                          onChange={(event) => updateInput(input.name, event.target.value)}
                        />
                      </label>
                    );
                  }
                  return (
                    <button
                      key={input.name}
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => fireInput(input.name)}
                    >
                      Disparar {input.name}
                    </button>
                  );
                })}
                <div className="actions compact">
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={resetMachine}
                  >
                    Reiniciar máquina
                  </button>
                </div>
              </div>
            ) : null}
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
