import { useCallback, useEffect, useState } from 'react';
import type {
  ConcatWorkerEnvelope,
  ConcatWorkerEvent,
  ConcatWorkerExportClip,
  ConcatWorkerExportParams,
  ConcatWorkerExportSpeedCurvePoint,
  ConcatWorkerExportResult,
  ConcatWorkerStatus,
} from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import { basename } from '../../lib/format';
import { SpeedCurvePreview } from './SpeedCurvePreview';

/**
 * Timeout del `render_export`: el backend topa en 10 min
 * (`MAX_TIMEOUT` en `application/concat_worker.rs`) y al vencer mata al
 * proceso del worker. La cancelación fina es `concat_worker_cancel_render`
 * (op `cancel` del worker); el timeout queda como último recurso.
 */
const RENDER_TIMEOUT_MS = 10 * 60 * 1000;

/** Etiqueta ES de cada fase que reporta el worker (`render_export.rs`). */
const PHASE_LABELS: Record<string, string> = {
  composite: 'Renderizando frames',
  audio: 'Mezclando audio',
  mux: 'Uniendo video y audio',
};

/** Último evento `render_export_progress` recibido del worker. */
interface RenderProgress {
  readonly phase: string;
  readonly frames?: number;
  readonly framesTotal?: number;
  readonly percent?: number;
}

const CODECS = ['h264', 'hevc', 'av1', 'prores-4444', 'vp9-alpha'] as const;
const FITS = ['contain', 'cover', 'fill'] as const;
/** Subconjunto xfade del catálogo de Concat (los nombres que acepta el worker). */
const TRANSITIONS = [
  'dissolve',
  'fadeblack',
  'fadewhite',
  'wipeleft',
  'wiperight',
  'wipeup',
  'wipedown',
  'zoomin',
  'pixelize',
] as const;

/** Punto de `speed_curve` en edición: los tres campos son texto libre. */
interface CurvePointForm {
  /** Fracción `0..1` dentro del clip en el timeline. */
  readonly at: string;
  /** Segundos de fuente por segundo de timeline (> 0). */
  readonly speed: string;
  /** Pendiente opcional (sólo cuenta si TODOS los puntos la traen). */
  readonly slope: string;
}

interface ClipForm {
  readonly path: string;
  readonly input: string;
  readonly duration: string;
  readonly fit: string;
  readonly audio: boolean;
  readonly speed: string;
  /** `'const'` usa `speed`; `'curve'` envía `speed_curve` y el worker ignora `speed`. */
  readonly speedMode: 'const' | 'curve';
  readonly curvePoints: readonly CurvePointForm[];
  readonly transitionType: string;
  readonly transitionDuration: string;
}

/** Máximo de puntos de la curva (mismo tope que el editor de curvas del inspector). */
const MAX_CURVE_POINTS = 16;

function emptyClip(): ClipForm {
  return {
    path: '',
    input: '',
    duration: '',
    fit: 'contain',
    audio: false,
    speed: '',
    speedMode: 'const',
    curvePoints: [],
    transitionType: '',
    transitionDuration: '',
  };
}

/** Puntos iniciales al activar la curva: plana en la velocidad del campo. */
function seedCurvePoints(speedText: string): readonly CurvePointForm[] {
  const speed = speedText.trim() === '' ? '1' : speedText.trim();
  return [
    { at: '0', speed, slope: '' },
    { at: '1', speed, slope: '' },
  ];
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Acepta `"1.5"`, `"3/2"` o `""` (vacío = default del worker). */
function isTimeText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return true;
  return /^\d+(\.\d+)?$/.test(trimmed) || /^\d+\/\d+$/.test(trimmed);
}

function isPositiveNumber(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return true;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0;
}

/**
 * Valida y parsea los puntos de `speed_curve` de un clip.
 * `clipIndex` es 0-based: los mensajes se muestran al usuario como "Clip N".
 */
function parseCurvePoints(
  points: readonly CurvePointForm[],
  clipIndex: number,
): { readonly points: ConcatWorkerExportSpeedCurvePoint[] } | { readonly error: string } {
  const label = `Clip ${clipIndex + 1}`;
  if (points.length < 2) {
    return { error: `${label}: la curva de velocidad necesita al menos 2 puntos.` };
  }
  if (points.length > MAX_CURVE_POINTS) {
    return { error: `${label}: la curva admite hasta ${MAX_CURVE_POINTS} puntos.` };
  }
  const parsed: ConcatWorkerExportSpeedCurvePoint[] = [];
  let previousAt: number | null = null;
  for (const [position, point] of points.entries()) {
    const pointLabel = `${label}, punto ${position + 1}`;
    const atText = point.at.trim();
    const at = Number(atText);
    if (atText === '' || !Number.isFinite(at) || at < 0 || at > 1) {
      return {
        error: `${pointLabel}: la posición tiene que ser un número entre 0 y 1.`,
      };
    }
    if (previousAt !== null && at <= previousAt) {
      return {
        error: `${pointLabel}: las posiciones tienen que ser crecientes.`,
      };
    }
    previousAt = at;
    const speedText = point.speed.trim();
    const speed = Number(speedText);
    if (speedText === '' || !Number.isFinite(speed) || speed <= 0) {
      return {
        error: `${pointLabel}: la velocidad tiene que ser un número mayor que 0.`,
      };
    }
    const slopeText = point.slope.trim();
    let slope: number | undefined;
    if (slopeText !== '') {
      const value = Number(slopeText);
      if (!Number.isFinite(value)) {
        return {
          error: `${pointLabel}: la pendiente tiene que ser un número (o quedar vacía).`,
        };
      }
      slope = value;
    }
    parsed.push({ at, speed, ...(slope !== undefined ? { slope } : {}) });
  }
  return { points: parsed };
}

/**
 * Versión tolerante de `parseCurvePoints` para el preview: convierte los
 * strings del form a números y descarta lo inválido en vez de fallar (el
 * preview no valida, `buildParams` sí). `slope` sólo viaja si es finito.
 */
function previewCurvePoints(
  points: readonly CurvePointForm[],
): ConcatWorkerExportSpeedCurvePoint[] {
  return points
    .map((point) => {
      const slopeText = point.slope.trim();
      const slope = slopeText === '' ? undefined : Number(slopeText);
      return {
        at: Number(point.at.trim()),
        speed: Number(point.speed.trim()),
        ...(slope !== undefined && Number.isFinite(slope) ? { slope } : {}),
      };
    })
    .filter(
      (point) =>
        Number.isFinite(point.at) && Number.isFinite(point.speed) && point.speed > 0,
    );
}

/**
 * Panel «Motor alternativo» del diálogo de exportación: renderiza con la op
 * `render_export` del concat-worker (proceso JSON-lines `concat-media`), que
 * compone clips sobre un canvas en CPU y escribe un MP4/MOV/WebM. No usa el
 * pipeline de render del proyecto: es una composición manual de archivos ya
 * exportados, pensada como MVP — por eso el formulario pide los clips a mano
 * en vez de mapear el timeline (los clips del proyecto no traducen 1:1:
 * transforms, keyframes y text no existen en el protocolo del worker).
 *
 * Estados honestos:
 * - `concat_worker_status` decide si el formulario se puede usar.
 * - El progreso llega por el evento Tauri `concat-worker-progress`
 *   (`onConcatWorkerEvent`): el worker emite `render_export_progress`
 *   durante el render y `cancel_ack` cuando confirma un cancel. Un worker
 *   viejo no emite nada: el panel funciona igual, sólo sin barra.
 * - `concatWorkerCancelRender` manda `{"op":"cancel"}` al proceso; el
 *   render aborta en el próximo frame/fase y responde `ok:false`
 *   ("render_export cancelled") sin matar al worker.
 */
export function ConcatWorkerExportPanel() {
  const store = useProjectStore();
  const [status, setStatus] = useState<ConcatWorkerStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [output, setOutput] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [frameRate, setFrameRate] = useState('30');
  const [codec, setCodec] = useState<string>('h264');
  const [clips, setClips] = useState<readonly ClipForm[]>([emptyClip()]);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [cancelAcked, setCancelAcked] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    readonly ok: boolean;
    readonly cancelled?: boolean;
    readonly text: string;
    readonly outputPath: string | null;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!store.service.available) {
      setStatus(null);
      setChecked(true);
      return;
    }
    setStatusError(null);
    try {
      setStatus(await store.service.concatWorkerStatus());
    } catch (failure) {
      setStatusError(
        failure instanceof Error
          ? failure.message
          : 'no se pudo leer el estado del concat-worker',
      );
    } finally {
      setChecked(true);
    }
  }, [store.service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Eventos del worker (`concat-worker-progress`): progreso del render en
  // curso y ack de cancelación. Se suscribe una vez; los eventos sólo
  // llegan mientras una `concatWorkerRequest` está en vuelo.
  useEffect(() => {
    if (!store.service.available) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    store.service
      .onConcatWorkerEvent((event: ConcatWorkerEvent) => {
        if (event.type === 'render_export_progress') {
          setProgress({
            phase: typeof event.phase === 'string' ? event.phase : 'render',
            ...(typeof event.frames === 'number' ? { frames: event.frames } : {}),
            ...(typeof event.frames_total === 'number'
              ? { framesTotal: event.frames_total }
              : {}),
            ...(typeof event.percent === 'number' ? { percent: event.percent } : {}),
          });
        } else if (event.type === 'cancel_ack') {
          setCancelAcked(true);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Sin eventos (navegador/tests): el render funciona igual.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [store.service]);

  function updateClip(index: number, patch: Partial<ClipForm>): void {
    setClips((current) =>
      current.map((clip, position) => (position === index ? { ...clip, ...patch } : clip)),
    );
  }

  function updateCurvePoint(
    clipIndex: number,
    pointIndex: number,
    patch: Partial<CurvePointForm>,
  ): void {
    setClips((current) =>
      current.map((clip, position) =>
        position === clipIndex
          ? {
              ...clip,
              curvePoints: clip.curvePoints.map((point, at) =>
                at === pointIndex ? { ...point, ...patch } : point,
              ),
            }
          : clip,
      ),
    );
  }

  function addCurvePoint(clipIndex: number): void {
    setClips((current) =>
      current.map((clip, position) =>
        position === clipIndex && clip.curvePoints.length < MAX_CURVE_POINTS
          ? {
              ...clip,
              // Punto nuevo al final con la velocidad del último punto: el
              // usuario lo reubica editando `at` (la validación exige orden).
              curvePoints: [
                ...clip.curvePoints,
                {
                  at: '1',
                  speed: clip.curvePoints[clip.curvePoints.length - 1]?.speed ?? '1',
                  slope: '',
                },
              ],
            }
          : clip,
      ),
    );
  }

  function removeCurvePoint(clipIndex: number, pointIndex: number): void {
    setClips((current) =>
      current.map((clip, position) =>
        position === clipIndex && clip.curvePoints.length > 2
          ? {
              ...clip,
              curvePoints: clip.curvePoints.filter((_, at) => at !== pointIndex),
            }
          : clip,
      ),
    );
  }

  function addClip(): void {
    setClips((current) => [...current, emptyClip()]);
  }

  function removeClip(index: number): void {
    setClips((current) => current.filter((_, position) => position !== index));
  }

  async function pickOutput(): Promise<void> {
    const folder = await store.service.chooseExportDirectory().catch(() => null);
    if (!folder) return;
    const separator = folder.includes('\\') ? '\\' : '/';
    setOutput(`${folder.replace(/[\\/]+$/, '')}${separator}concat-export.mp4`);
  }

  /** Valida el formulario y arma los params del protocolo. `null` = inválido. */
  function buildParams(): ConcatWorkerExportParams | { readonly error: string } {
    const outputPath = output.trim();
    if (!outputPath) return { error: 'Elegí el archivo de salida (MP4).' };
    const filled = clips.filter((clip) => clip.path.trim() !== '' || clip.duration.trim() !== '');
    if (filled.length === 0) {
      return { error: 'Agregá al menos un clip con su archivo de medio.' };
    }
    if (clips.some((clip) => clip.path.trim() === '')) {
      return { error: 'Todos los clips necesitan la ruta de su archivo de medio.' };
    }
    const canvasWidth = width.trim() === '' ? null : Number(width.trim());
    const canvasHeight = height.trim() === '' ? null : Number(height.trim());
    if (canvasWidth !== null && (!Number.isInteger(canvasWidth) || canvasWidth <= 0)) {
      return { error: 'El ancho del canvas tiene que ser un entero positivo (o quedar vacío).' };
    }
    if (canvasHeight !== null && (!Number.isInteger(canvasHeight) || canvasHeight <= 0)) {
      return { error: 'El alto del canvas tiene que ser un entero positivo (o quedar vacío).' };
    }
    const exportClips: ConcatWorkerExportClip[] = [];
    for (const [index, clip] of clips.entries()) {
      if (!isTimeText(clip.input) || !isTimeText(clip.duration) || !isTimeText(clip.transitionDuration)) {
        return { error: `Clip ${index + 1}: los tiempos tienen que ser segundos ("1.5") o fracción ("3/2").` };
      }
      if (!isPositiveNumber(clip.speed)) {
        return { error: `Clip ${index + 1}: la velocidad tiene que ser un número mayor que 0.` };
      }
      if (clip.transitionType !== '' && clip.transitionDuration.trim() === '') {
        return { error: `Clip ${index + 1}: la transición necesita una duración en segundos.` };
      }
      // `transition` en el primer clip no tiene clip anterior: el worker lo
      // rechaza, así que se valida acá en vez de gastar el spawn.
      if (clip.transitionType !== '' && index === 0) {
        return { error: 'El primer clip no puede tener transición (no hay clip anterior).' };
      }
      // Con curva activa el worker ignora `speed` (`speed_curve` manda);
      // se sigue serializando por compatibilidad pero el panel lo deshabilita.
      let speedCurve: ConcatWorkerExportSpeedCurvePoint[] | undefined;
      if (clip.speedMode === 'curve') {
        const parsed = parseCurvePoints(clip.curvePoints, index);
        if ('error' in parsed) return parsed;
        speedCurve = parsed.points;
      }
      const speedText = clip.speed.trim();
      const numericSpeed = Number(speedText);
      exportClips.push({
        path: clip.path.trim(),
        fit: clip.fit,
        audio: clip.audio,
        ...(clip.input.trim() !== '' ? { in: clip.input.trim() } : {}),
        ...(clip.duration.trim() !== '' ? { duration: clip.duration.trim() } : {}),
        ...(speedText !== ''
          ? { speed: Number.isFinite(numericSpeed) ? numericSpeed : speedText }
          : {}),
        ...(speedCurve !== undefined ? { speed_curve: speedCurve } : {}),
        ...(clip.transitionType !== ''
          ? {
              transition: {
                type: clip.transitionType,
                duration: clip.transitionDuration.trim(),
              },
            }
          : {}),
      });
    }
    return {
      output: outputPath,
      clips: exportClips,
      ...(canvasWidth !== null ? { width: canvasWidth } : {}),
      ...(canvasHeight !== null ? { height: canvasHeight } : {}),
      ...(frameRate.trim() !== '' ? { frame_rate: frameRate.trim() } : {}),
      codec,
    };
  }

  async function render(): Promise<void> {
    if (busy) return;
    setFormError(null);
    setResult(null);
    const params = buildParams();
    if ('error' in params) {
      setFormError(params.error);
      return;
    }
    setBusy(true);
    setCancelling(false);
    setProgress(null);
    setCancelAcked(false);
    try {
      const envelope: ConcatWorkerEnvelope = await store.service.concatWorkerRequest(
        'render_export',
        params as unknown as Record<string, unknown>,
        RENDER_TIMEOUT_MS,
      );
      if (envelope.ok === true) {
        const payload = envelope as unknown as ConcatWorkerExportResult & ConcatWorkerEnvelope;
        const outputPath = typeof payload.output === 'string' ? payload.output : params.output;
        setResult({
          ok: true,
          outputPath,
          text: pretty({
            output: payload.output,
            width: payload.width,
            height: payload.height,
            frame_rate: payload.frame_rate,
            frames: payload.frames,
            duration_seconds: payload.duration_seconds,
            codec: payload.codec,
            audio: payload.audio,
            transitions: payload.transitions,
          }),
        });
        store.setNotice(`Render del concat-worker completado: ${basename(outputPath)}`);
      } else {
        // `render_export cancelled` es el error del worker al abortar por
        // `{"op":"cancel"}`: se muestra como cancelación, no como fallo.
        const cancelled = /cancel/i.test(envelope.error ?? '');
        setResult({
          ok: false,
          cancelled,
          outputPath: null,
          text: cancelled
            ? `Render cancelado. ${envelope.error ?? ''}`.trim()
            : (envelope.error ?? pretty(envelope)),
        });
      }
      // El render spawnea/mantiene el proceso: refrescar el estado real.
      await refresh();
    } catch (failure) {
      setResult({
        ok: false,
        outputPath: null,
        text:
          failure instanceof Error
            ? failure.message
            : 'el concat-worker no respondió al render_export',
      });
    } finally {
      setBusy(false);
      setCancelling(false);
    }
  }

  /**
   * Manda `{"op":"cancel"}` al worker sin esperar respuesta: el render
   * aborta en el próximo frame o cambio de fase y la request en vuelo
   * responde `ok:false`. `false` del servicio = no había worker leyendo.
   */
  async function cancelRender(): Promise<void> {
    if (!busy || cancelling) return;
    setFormError(null);
    setCancelling(true);
    try {
      const sent = await store.service.concatWorkerCancelRender();
      if (!sent) {
        setFormError('No había un render activo en el concat-worker para cancelar.');
        setCancelling(false);
      }
      // Si se envió, el worker emite `cancel_ack` (se ve en `cancelAcked`)
      // y el render termina solo: `busy` sigue true hasta la respuesta.
    } catch (failure) {
      setFormError(
        failure instanceof Error
          ? failure.message
          : 'no se pudo enviar la cancelación al concat-worker',
      );
      setCancelling(false);
    }
  }

  const workerReady = status?.available === true;

  return (
    <div className="export-settings-card concat-worker-export">
      <div className="export-settings-head">
        <span>Motor alternativo · concat-worker</span>
        <span className="export-settings-hint">
          {!store.service.available ? (
            'Sólo en la app de escritorio'
          ) : checked ? (
            status ? (
              status.available ? (
                status.running
                  ? 'Worker disponible · proceso activo'
                  : 'Worker disponible'
              ) : (
                `No disponible${status.reason ? `: ${status.reason}` : ''}`
              )
            ) : (
              'Sin lectura del estado'
            )
          ) : (
            'Comprobando…'
          )}
        </span>
      </div>
      {!store.service.available ? (
        <p className="fine-print">
          El concat-worker sólo existe en la app de escritorio; en el navegador no hay render
          alternativo.
        </p>
      ) : statusError ? (
        <p className="notice notice-warning" role="alert">
          {statusError}
        </p>
      ) : status && !status.available ? (
        <p className="fine-print">
          No disponible{status.reason ? `: ${status.reason}` : ''}. Compilá{' '}
          <code>apps/concat-worker</code> o reinstalá la app para habilitar este motor.
        </p>
      ) : (
        <>
          <p className="export-settings-note">
            Renderiza una composición manual de clips sobre un canvas (CPU, sin GPU ni pipeline del
            proyecto). No usa los perfiles de arriba ni exporta subtítulos/keyframes del timeline.
          </p>
          <button
            type="button"
            className="small ghost"
            onClick={() => setExpanded((value) => !value)}
            disabled={busy}
          >
            {expanded ? 'Ocultar formulario' : 'Configurar render con clips…'}
          </button>
          {expanded ? (
            <div className="concat-worker-form">
              <label className="field">
                <span>Archivo de salida</span>
                <div className="export-path-row">
                  <input
                    type="text"
                    value={output}
                    placeholder="C:\exports\concat-export.mp4"
                    disabled={busy}
                    onChange={(event) => setOutput(event.target.value)}
                  />
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() => void pickOutput()}
                    disabled={busy}
                  >
                    Examinar…
                  </button>
                </div>
              </label>
              <div className="export-settings-grid">
                <label className="field">
                  <span>Ancho del canvas (opcional)</span>
                  <input
                    type="number"
                    min={1}
                    value={width}
                    placeholder="automático"
                    disabled={busy}
                    onChange={(event) => setWidth(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Alto del canvas (opcional)</span>
                  <input
                    type="number"
                    min={1}
                    value={height}
                    placeholder="automático"
                    disabled={busy}
                    onChange={(event) => setHeight(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Frame rate</span>
                  <input
                    type="text"
                    value={frameRate}
                    placeholder="30 o 30000/1001"
                    disabled={busy}
                    onChange={(event) => setFrameRate(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Codec</span>
                  <select
                    value={codec}
                    disabled={busy}
                    onChange={(event) => setCodec(event.target.value)}
                  >
                    {CODECS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="fine-print">
                Canvas vacío usa el tamaño del primer clip. Codecs:{' '}
                {CODECS.join(' · ')} — el worker elige el contenedor según el codec.
              </p>

              <div className="concat-worker-clips">
                {clips.map((clip, index) => (
                  <fieldset key={index} className="concat-worker-clip" disabled={busy}>
                    <legend>Clip {index + 1}</legend>
                    <label className="field">
                      <span>Archivo de medio</span>
                      <input
                        type="text"
                        value={clip.path}
                        placeholder="C:\videos\clip.mp4"
                        onChange={(event) => updateClip(index, { path: event.target.value })}
                      />
                    </label>
                    <div className="export-settings-grid">
                      <label className="field">
                        <span>Entrada (s, opcional)</span>
                        <input
                          type="text"
                          value={clip.input}
                          placeholder="0"
                          onChange={(event) => updateClip(index, { input: event.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Duración (s, opcional)</span>
                        <input
                          type="text"
                          value={clip.duration}
                          placeholder="resto del medio"
                          onChange={(event) => updateClip(index, { duration: event.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Encuadre</span>
                        <select
                          value={clip.fit}
                          onChange={(event) => updateClip(index, { fit: event.target.value })}
                        >
                          {FITS.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Velocidad (opcional)</span>
                        <input
                          type="text"
                          value={clip.speed}
                          placeholder="1"
                          disabled={clip.speedMode === 'curve'}
                          title={
                            clip.speedMode === 'curve'
                              ? 'Con curva activa el worker ignora la velocidad constante'
                              : undefined
                          }
                          onChange={(event) => updateClip(index, { speed: event.target.value })}
                        />
                      </label>
                      {index > 0 ? (
                        <>
                          <label className="field">
                            <span>Transición con el anterior</span>
                            <select
                              value={clip.transitionType}
                              onChange={(event) =>
                                updateClip(index, { transitionType: event.target.value })
                              }
                            >
                              <option value="">— ninguna —</option>
                              {TRANSITIONS.map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="field">
                            <span>Duración de la transición (s)</span>
                            <input
                              type="text"
                              value={clip.transitionDuration}
                              placeholder="0.5"
                              disabled={clip.transitionType === ''}
                              onChange={(event) =>
                                updateClip(index, {
                                  transitionDuration: event.target.value,
                                })
                              }
                            />
                          </label>
                        </>
                      ) : null}
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={clip.audio}
                        onChange={(event) => updateClip(index, { audio: event.target.checked })}
                      />
                      <span>Mezclar el audio del clip en la salida</span>
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={clip.speedMode === 'curve'}
                        onChange={(event) =>
                          updateClip(
                            index,
                            event.target.checked
                              ? {
                                  speedMode: 'curve',
                                  curvePoints: seedCurvePoints(clip.speed),
                                }
                              : { speedMode: 'const' },
                          )
                        }
                      />
                      <span>
                        Curva de velocidad por puntos (se aplica a este clip; reemplaza la
                        velocidad constante)
                      </span>
                    </label>
                    {clip.speedMode === 'curve' ? (
                      <div className="concat-worker-curve">
                        <SpeedCurvePreview
                          points={previewCurvePoints(clip.curvePoints)}
                          label={`Clip ${index + 1}: curva de velocidad`}
                        />
                        {clip.curvePoints.map((point, pointIndex) => (
                          <div key={pointIndex} className="concat-worker-curve-point">
                            <label className="field">
                              <span>Posición (0–1)</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={point.at}
                                placeholder="0.5"
                                aria-label={`Clip ${index + 1}, punto ${pointIndex + 1}: posición`}
                                onChange={(event) =>
                                  updateCurvePoint(index, pointIndex, { at: event.target.value })
                                }
                              />
                            </label>
                            <label className="field">
                              <span>Velocidad</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={point.speed}
                                placeholder="1"
                                aria-label={`Clip ${index + 1}, punto ${pointIndex + 1}: velocidad`}
                                onChange={(event) =>
                                  updateCurvePoint(index, pointIndex, { speed: event.target.value })
                                }
                              />
                            </label>
                            <label className="field">
                              <span>Pendiente (opc.)</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={point.slope}
                                placeholder="—"
                                aria-label={`Clip ${index + 1}, punto ${pointIndex + 1}: pendiente`}
                                onChange={(event) =>
                                  updateCurvePoint(index, pointIndex, { slope: event.target.value })
                                }
                              />
                            </label>
                            <button
                              type="button"
                              className="small ghost"
                              disabled={clip.curvePoints.length <= 2}
                              onClick={() => removeCurvePoint(index, pointIndex)}
                              aria-label={`Clip ${index + 1}, quitar punto ${pointIndex + 1}`}
                            >
                              Quitar
                            </button>
                          </div>
                        ))}
                        <div className="actions compact">
                          <button
                            type="button"
                            className="small ghost"
                            disabled={clip.curvePoints.length >= MAX_CURVE_POINTS}
                            onClick={() => addCurvePoint(index)}
                          >
                            Agregar punto
                          </button>
                        </div>
                        <p className="fine-print">
                          <code>at</code> es la fracción 0–1 del clip en la línea de tiempo y las
                          posiciones tienen que ser crecientes. Si todos los puntos tienen
                          pendiente el worker interpola con Hermite; si falta alguna, interpola
                          en líneas rectas. Sin curva el campo Velocidad manda.
                        </p>
                      </div>
                    ) : null}
                    {clips.length > 1 ? (
                      <button
                        type="button"
                        className="small ghost"
                        onClick={() => removeClip(index)}
                      >
                        Quitar clip
                      </button>
                    ) : null}
                  </fieldset>
                ))}
              </div>
              <div className="actions compact">
                <button type="button" className="small ghost" onClick={addClip} disabled={busy}>
                  Agregar clip
                </button>
                <button
                  type="button"
                  className="primary small"
                  onClick={() => void render()}
                  disabled={busy || !workerReady}
                  title={
                    workerReady
                      ? 'Renderiza los clips con el concat-worker (puede tardar varios minutos)'
                      : 'El worker no está disponible en esta instalación'
                  }
                >
                  {busy ? 'Renderizando…' : 'Renderizar con concat-worker'}
                </button>
                {busy ? (
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() => void cancelRender()}
                    disabled={cancelling}
                    title="Manda cancel al worker: aborta en el próximo frame o fase"
                  >
                    {cancelling ? (cancelAcked ? 'Cancelando…' : 'Enviando cancel…') : 'Cancelar render'}
                  </button>
                ) : null}
              </div>
              {busy && progress ? (
                <div className="concat-worker-progress" role="status">
                  <progress
                    max={100}
                    value={
                      progress.percent !== undefined
                        ? Math.round(progress.percent * 1000) / 10
                        : undefined
                    }
                  />
                  <span className="fine-print">
                    {PHASE_LABELS[progress.phase] ?? progress.phase}
                    {progress.phase === 'composite' &&
                    progress.frames !== undefined &&
                    progress.framesTotal !== undefined
                      ? ` · frame ${progress.frames.toLocaleString()} de ${progress.framesTotal.toLocaleString()}`
                      : ''}
                    {progress.percent !== undefined
                      ? ` (${Math.round(progress.percent * 100)} %)`
                      : ''}
                    {cancelling ? ' · cancelación enviada' : ''}
                  </span>
                </div>
              ) : null}
              {formError ? (
                <p className="notice notice-warning" role="alert">
                  {formError}
                </p>
              ) : null}
              <p className="fine-print">
                El worker reporta progreso por fase (frames, audio, mux) y acepta cancelación:
                aborta en el próximo frame o cambio de fase sin matar el proceso. Si la
                request supera los 10 minutos el proceso se corta por timeout. Los clips se
                pintan en orden (el último cubre a los anteriores).
              </p>
            </div>
          ) : null}
          {result ? (
            <div className={`mcp-result${result.ok ? '' : ' error'}`} role="status">
              <div>
                <span>
                  {result.ok
                    ? 'Render completado'
                    : result.cancelled
                      ? 'Render cancelado'
                      : 'Falló el render'}
                </span>
                <span>render_export</span>
              </div>
              <pre>{result.text}</pre>
              {result.ok && result.outputPath ? (
                <div className="actions compact">
                  <button
                    type="button"
                    className="small"
                    onClick={() =>
                      void store.service
                        .revealOutput(result.outputPath!)
                        .catch((cause) =>
                          setResult({
                            ok: false,
                            outputPath: null,
                            text:
                              cause instanceof Error
                                ? cause.message
                                : 'no se pudo abrir la carpeta del archivo',
                          }),
                        )
                    }
                  >
                    Abrir carpeta
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
