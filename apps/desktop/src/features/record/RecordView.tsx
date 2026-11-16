import { useCallback, useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { useProjectStore } from '../../state/project-store';
import type {
  CaptureDevices,
  CursorOverlaySpec,
  WebcamChromaSpec,
  ObsScene,
  ObsSceneInput,
  ScreenRecordPreview,
  ScreenRecordResult,
  ScreenRecordStatus,
} from '../../services/project-service';

type CaptureTarget = 'desktop' | 'window' | 'region';
type Encoder = 'x264' | 'nvenc' | 'qsv' | 'amf' | 'mf';
type CursorStyleChoice = 'off' | CursorOverlaySpec['style'];
type CursorColor = CursorOverlaySpec['color'];

interface RecordForm {
  captureTarget: CaptureTarget;
  windowTitle: string;
  regionX: string;
  regionY: string;
  regionWidth: string;
  regionHeight: string;
  fps: string;
  webcamDevice: string;
  webcamChroma: boolean;
  webcamChromaColor: string;
  webcamChromaSimilarity: string;
  webcamChromaBlend: string;
  audioDevice: string;
  streamUrl: string;
  encoder: Encoder;
  cursorStyle: CursorStyleChoice;
  cursorColor: CursorColor;
  cursorScale: string;
  cursorRipple: boolean;
  outputDir: string;
}

const EMPTY_FORM: RecordForm = {
  captureTarget: 'desktop',
  windowTitle: '',
  regionX: '0',
  regionY: '0',
  regionWidth: '1920',
  regionHeight: '1080',
  fps: '30',
  webcamDevice: '',
  webcamChroma: false,
  webcamChromaColor: '#00ff00',
  webcamChromaSimilarity: '0.3',
  webcamChromaBlend: '0.1',
  audioDevice: '',
  streamUrl: '',
  encoder: 'x264',
  cursorStyle: 'off',
  cursorColor: 'blanco',
  cursorScale: '1',
  cursorRipple: true,
  outputDir: '',
};

function num(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formToSceneInput(
  form: RecordForm,
  name: string,
  id?: string,
  existing?: ObsScene,
): ObsSceneInput {
  const fps = num(form.fps);
  const regionX = num(form.regionX);
  const regionY = num(form.regionY);
  const regionWidth = num(form.regionWidth);
  const regionHeight = num(form.regionHeight);
  return {
    ...(id ? { id } : {}),
    name,
    ...(fps !== undefined ? { fps } : {}),
    captureTarget: form.captureTarget,
    ...(form.windowTitle.trim() ? { windowTitle: form.windowTitle.trim() } : {}),
    ...(form.captureTarget === 'region'
      ? {
          ...(regionX !== undefined ? { regionX } : {}),
          ...(regionY !== undefined ? { regionY } : {}),
          ...(regionWidth !== undefined ? { regionWidth } : {}),
          ...(regionHeight !== undefined ? { regionHeight } : {}),
        }
      : {}),
    ...(form.webcamDevice ? { webcamDevice: form.webcamDevice } : {}),
    ...(form.webcamChroma && form.webcamDevice
      ? {
          webcamChroma: {
            color: form.webcamChromaColor.trim() || '#00ff00',
            similarity: Number(form.webcamChromaSimilarity) || 0.3,
            blend: Number(form.webcamChromaBlend) || 0.1,
          } satisfies WebcamChromaSpec,
        }
      : {}),
    ...(form.audioDevice ? { audioDevice: form.audioDevice } : {}),
    // AUD-096: el campo puede traer la URL completa (con clave → el backend
    // la manda al llavero) o sólo el endpoint (se conserva la clave
    // guardada). Vacío + escena con stream = limpieza explícita.
    ...(form.streamUrl.trim()
      ? { streamUrl: form.streamUrl.trim() }
      : existing && (existing.streamEndpoint || existing.streamUrl)
        ? { streamEndpoint: '' }
        : {}),
    encoder: form.encoder,
    ...(form.cursorStyle !== 'off' && form.captureTarget === 'desktop'
      ? {
          cursorOverlay: {
            style: form.cursorStyle,
            color: form.cursorColor,
            scale: (Number(form.cursorScale) || 1) as CursorOverlaySpec['scale'],
            ripple: form.cursorRipple,
          },
        }
      : {}),
    captureScreen: true,
  };
}

/**
 * Parámetros que `screen_record_snapshot` acepta: las fuentes de video de la
 * grabación (pantalla/ventana/región + webcam con chroma PiP). Audio,
 * encoder, cursor y destino no aplican a un frame suelto.
 */
function formToSnapshotInput(form: RecordForm) {
  return {
    fps: num(form.fps) ?? 30,
    ...(form.captureTarget !== 'desktop' ? { captureTarget: form.captureTarget } : {}),
    ...(form.windowTitle.trim() ? { windowTitle: form.windowTitle.trim() } : {}),
    ...(form.captureTarget === 'region'
      ? {
          regionX: num(form.regionX) ?? 0,
          regionY: num(form.regionY) ?? 0,
          regionWidth: num(form.regionWidth) ?? 0,
          regionHeight: num(form.regionHeight) ?? 0,
        }
      : {}),
    ...(form.webcamDevice ? { webcamDevice: form.webcamDevice } : {}),
    ...(form.webcamChroma && form.webcamDevice
      ? {
          webcamChroma: {
            color: form.webcamChromaColor.trim() || '#00ff00',
            similarity: Number(form.webcamChromaSimilarity) || 0.3,
            blend: Number(form.webcamChromaBlend) || 0,
          },
        }
      : {}),
    captureScreen: true,
  };
}

function sceneToForm(scene: ObsScene): RecordForm {
  return {
    captureTarget: scene.captureTarget ?? 'desktop',
    windowTitle: scene.windowTitle ?? '',
    regionX: String(scene.regionX ?? 0),
    regionY: String(scene.regionY ?? 0),
    regionWidth: String(scene.regionWidth ?? 1920),
    regionHeight: String(scene.regionHeight ?? 1080),
    fps: String(scene.fps ?? 30),
    webcamDevice: scene.webcamDevice ?? '',
    webcamChroma: Boolean(scene.webcamDevice && scene.webcamChroma),
    webcamChromaColor: scene.webcamChroma?.color ?? '#00ff00',
    webcamChromaSimilarity: String(scene.webcamChroma?.similarity ?? 0.3),
    webcamChromaBlend: String(scene.webcamChroma?.blend ?? 0.1),
    audioDevice: scene.audioDevice ?? '',
    // La escena persistida trae el endpoint SIN clave; streamUrl queda sólo
    // como fallback para datos legacy en memoria (fake service, tests).
    streamUrl: scene.streamEndpoint ?? scene.streamUrl ?? '',
    encoder: scene.encoder ?? 'x264',
    cursorStyle: scene.cursorOverlay?.style ?? 'off',
    cursorColor: scene.cursorOverlay?.color ?? 'blanco',
    cursorScale: String(scene.cursorOverlay?.scale ?? 1),
    cursorRipple: scene.cursorOverlay?.ripple ?? true,
    outputDir: '',
  };
}

/**
 * Grabación y escenas OBS: superficie real de `screen_record` + `obs_scenes`.
 * Antes estas funciones solo existían para el agente MCP; acá el usuario las
 * opera directo: captura de pantalla/ventana/región, webcam PiP, audio,
 * streaming RTMP, presets de escena persistentes y preview de un frame.
 */
export function RecordView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const service = store.service;

  const [devices, setDevices] = useState<CaptureDevices | null>(null);
  const [status, setStatus] = useState<ScreenRecordStatus>({ recording: false });
  const [form, setForm] = useState<RecordForm>(EMPTY_FORM);
  const [scenes, setScenes] = useState<readonly ObsScene[]>([]);
  const [sceneName, setSceneName] = useState('');
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    readonly id: string;
    readonly url: string;
    readonly label: string;
  } | null>(null);
  const [lastResult, setLastResult] = useState<ScreenRecordResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await service.screenRecordStatus());
    } catch {
      setStatus({ recording: false });
    }
  }, [service]);

  const refreshScenes = useCallback(async () => {
    try {
      setScenes(await service.obsSceneList());
    } catch {
      setScenes([]);
    }
  }, [service]);

  useEffect(() => {
    if (!service.available) return;
    void service
      .screenRecordDevices()
      .then(setDevices)
      .catch(() => setDevices(null));
    void refreshStatus();
    void refreshScenes();
  }, [service, refreshStatus, refreshScenes]);

  useEffect(() => {
    if (!status.recording) return;
    const timer = window.setInterval(() => void refreshStatus(), 1000);
    return () => window.clearInterval(timer);
  }, [status.recording, refreshStatus]);

  function patch<K extends keyof RecordForm>(key: K, value: RecordForm[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function chooseFolder(): Promise<void> {
    const dir = await service.chooseDownloadDirectory();
    if (dir) patch('outputDir', dir);
  }

  async function startRecording(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const outputDir = form.outputDir.trim() || (await service.chooseDownloadDirectory()) || '';
      if (!outputDir) {
        setError('Elegí una carpeta de destino para la grabación.');
        return;
      }
      patch('outputDir', outputDir);
      const started = await service.screenRecordStart({
        outputDir,
        fps: num(form.fps) ?? 30,
        ...(form.captureTarget !== 'desktop' ? { captureTarget: form.captureTarget } : {}),
        ...(form.windowTitle.trim() ? { windowTitle: form.windowTitle.trim() } : {}),
        ...(form.captureTarget === 'region'
          ? {
              regionX: num(form.regionX) ?? 0,
              regionY: num(form.regionY) ?? 0,
              regionWidth: num(form.regionWidth) ?? 0,
              regionHeight: num(form.regionHeight) ?? 0,
            }
          : {}),
        ...(form.webcamDevice ? { webcamDevice: form.webcamDevice } : {}),
        ...(form.webcamChroma && form.webcamDevice
          ? {
              webcamChroma: {
                color: form.webcamChromaColor.trim() || '#00ff00',
                similarity: Number(form.webcamChromaSimilarity) || 0.3,
                blend: Number(form.webcamChromaBlend) || 0,
              },
            }
          : {}),
        ...(form.audioDevice ? { audioDevice: form.audioDevice } : {}),
        ...(form.streamUrl.trim() ? { streamUrl: form.streamUrl.trim() } : {}),
        encoder: form.encoder,
        ...(form.cursorStyle !== 'off' && form.captureTarget === 'desktop'
          ? {
              cursorOverlay: {
                style: form.cursorStyle,
                color: form.cursorColor,
                scale: (Number(form.cursorScale) || 1) as CursorOverlaySpec['scale'],
                ripple: form.cursorRipple,
              },
            }
          : {}),
        captureScreen: true,
      });
      setStatus(started);
      setNotice(started.streaming ? 'Grabando y streameando por RTMP.' : 'Grabación iniciada.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function stopRecording(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await service.screenRecordStop();
      setLastResult(result);
      setStatus(await service.screenRecordStatus());
      if (!result.ok) setError(result.error ?? 'La grabación falló.');
      else {
        setNotice(
          `Grabación guardada: ${result.output ?? ''} (${result.durationSecs ?? '?'} s, ${result.width ?? '?'}×${result.height ?? '?'})`,
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveScene(): Promise<void> {
    const name = sceneName.trim();
    if (!name) {
      setError('Poné un nombre para la escena.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const existing = scenes.find((s) => s.id === editingSceneId);
      await service.obsSceneSave(
        formToSceneInput(form, name, editingSceneId ?? undefined, existing),
      );
      setSceneName('');
      setEditingSceneId(null);
      setNotice('Escena guardada.');
      await refreshScenes();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function startScene(id: string): Promise<void> {
    const outputDir = form.outputDir.trim();
    if (!outputDir) {
      setError('Elegí una carpeta de destino antes de iniciar la escena.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const started = await service.obsSceneStart(id, outputDir);
      setStatus(started);
      setNotice('Escena aplicada: grabación/streaming iniciado.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function previewScene(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result: ScreenRecordPreview = await service.obsScenePreview(id);
      if (result.ok && result.path) {
        setPreview({ id, url: service.absoluteFileUrl(result.path), label: 'la escena' });
      } else {
        setError(result.error ?? 'No se pudo generar el preview.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Preview de la grabación ad-hoc: captura un frame con la configuración
   * actual del formulario («Grabación rápida») sin grabar ni streamear.
   */
  async function previewRecording(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await service.screenRecordSnapshot(formToSnapshotInput(form));
      if (result.ok && result.path) {
        setPreview({
          id: 'adhoc',
          url: service.absoluteFileUrl(result.path),
          label: 'la grabación',
        });
      } else {
        setError(result.error ?? 'No se pudo generar el preview.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function deleteScene(id: string): Promise<void> {
    setBusy(true);
    try {
      await service.obsSceneDelete(id);
      await refreshScenes();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const elapsed = status.elapsedSecs ?? 0;

  return (
    <section className="view record-view" aria-label="Grabación y escenas">
      <header className="compress-head">
        <div>
          <h1>Grabación y escenas OBS</h1>
          <p className="fine-print">
            Captura de pantalla, ventana o región con webcam, audio y streaming RTMP. Las escenas
            guardan la configuración completa y se pueden previsualizar o lanzar en un clic.
          </p>
        </div>
        <button type="button" className="ghost icon-text" onClick={() => onNavigate('learn')}>
          <Icon name="learn" size={14} />
          Ayuda
        </button>
      </header>

      {!service.available ? (
        <p className="notice notice-warning" role="alert">
          La grabación está disponible solo en la app de escritorio.
        </p>
      ) : null}

      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <div className="compress-slot">
        <h2>Grabación rápida</h2>
        <div className="denoise-controls">
          <label className="field">
            <span>Capturar</span>
            <select
              value={form.captureTarget}
              onChange={(event) => patch('captureTarget', event.target.value as CaptureTarget)}
            >
              <option value="desktop">Escritorio completo</option>
              <option value="window">Ventana</option>
              <option value="region">Región</option>
            </select>
          </label>
          {form.captureTarget === 'window' ? (
            <label className="field">
              <span>Título de la ventana</span>
              <input
                value={form.windowTitle}
                onChange={(event) => patch('windowTitle', event.target.value)}
                placeholder="Ej. Bloco de notas"
              />
            </label>
          ) : null}
          {form.captureTarget === 'region' ? (
            <>
              <label className="field">
                <span>X / Y</span>
                <span className="record-inline">
                  <input value={form.regionX} onChange={(e) => patch('regionX', e.target.value)} />
                  <input value={form.regionY} onChange={(e) => patch('regionY', e.target.value)} />
                </span>
              </label>
              <label className="field">
                <span>Ancho × alto</span>
                <span className="record-inline">
                  <input
                    value={form.regionWidth}
                    onChange={(e) => patch('regionWidth', e.target.value)}
                  />
                  <input
                    value={form.regionHeight}
                    onChange={(e) => patch('regionHeight', e.target.value)}
                  />
                </span>
              </label>
            </>
          ) : null}
          <label className="field">
            <span>FPS</span>
            <input value={form.fps} onChange={(e) => patch('fps', e.target.value)} inputMode="numeric" />
          </label>
          <label className="field">
            <span>Cámara (webcam PiP)</span>
            <select value={form.webcamDevice} onChange={(e) => patch('webcamDevice', e.target.value)}>
              <option value="">Sin cámara</option>
              {(devices?.cameras ?? []).map((cam) => (
                <option key={cam} value={cam}>
                  {cam}
                </option>
              ))}
            </select>
          </label>
          {form.webcamDevice ? (
            <>
              <label className="field field-checkbox">
                <input
                  type="checkbox"
                  checked={form.webcamChroma}
                  onChange={(e) => patch('webcamChroma', e.target.checked)}
                />
                <span>Chroma key en la cámara (fondo verde)</span>
              </label>
              {form.webcamChroma ? (
                <>
                  <label className="field">
                    <span>Color a eliminar</span>
                    <input
                      value={form.webcamChromaColor}
                      onChange={(e) => patch('webcamChromaColor', e.target.value)}
                      placeholder="#00ff00"
                    />
                  </label>
                  <label className="field">
                    <span>Tolerancia (0–1)</span>
                    <input
                      value={form.webcamChromaSimilarity}
                      onChange={(e) => patch('webcamChromaSimilarity', e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                  <label className="field">
                    <span>Dureza del borde (0–1)</span>
                    <input
                      value={form.webcamChromaBlend}
                      onChange={(e) => patch('webcamChromaBlend', e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                </>
              ) : null}
            </>
          ) : null}
          <label className="field">
            <span>Micrófono / audio</span>
            <select value={form.audioDevice} onChange={(e) => patch('audioDevice', e.target.value)}>
              <option value="">Predeterminado del sistema</option>
              {(devices?.microphones ?? []).map((mic) => (
                <option key={mic} value={mic}>
                  {mic}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Encoder</span>
            <select value={form.encoder} onChange={(e) => patch('encoder', e.target.value as Encoder)}>
              <option value="x264">x264 (CPU, compatible)</option>
              <option value="nvenc">NVENC (NVIDIA)</option>
              <option value="qsv">QSV (Intel)</option>
              <option value="amf">AMF (AMD)</option>
              <option value="mf">MediaFoundation</option>
            </select>
          </label>
          {form.captureTarget === 'desktop' ? (
            <>
              <label className="field">
                <span>Cursor en el vídeo</span>
                <select
                  value={form.cursorStyle}
                  onChange={(e) => patch('cursorStyle', e.target.value as CursorStyleChoice)}
                >
                  <option value="off">Desactivado</option>
                  <option value="flecha">Flecha</option>
                  <option value="cheia">Flecha gruesa</option>
                  <option value="3d">Flecha 3D</option>
                  <option value="punto">Punto</option>
                  <option value="cruz">Cruz de mira</option>
                </select>
              </label>
              {form.cursorStyle !== 'off' ? (
                <>
                  <label className="field">
                    <span>Color del cursor</span>
                    <select
                      value={form.cursorColor}
                      onChange={(e) => patch('cursorColor', e.target.value as CursorColor)}
                    >
                      <option value="blanco">Blanco</option>
                      <option value="negro">Negro</option>
                      <option value="amarillo">Amarillo</option>
                      <option value="verde">Verde</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Tamaño del cursor</span>
                    <select
                      value={form.cursorScale}
                      onChange={(e) => patch('cursorScale', e.target.value)}
                    >
                      <option value="0.5">Chico (50 %)</option>
                      <option value="1">Normal</option>
                      <option value="2">Grande (200 %)</option>
                    </select>
                  </label>
                  <label className="field field-checkbox">
                    <input
                      type="checkbox"
                      checked={form.cursorRipple}
                      onChange={(e) => patch('cursorRipple', e.target.checked)}
                    />
                    <span>Anillo en cada click</span>
                  </label>
                </>
              ) : null}
            </>
          ) : null}
          <label className="field">
            <span>Stream RTMP (opcional)</span>
            <input
              value={form.streamUrl}
              onChange={(e) => patch('streamUrl', e.target.value)}
              placeholder="rtmp://servidor/app/clave"
            />
          </label>
          <label className="field">
            <span>Carpeta de destino</span>
            <span className="record-inline">
              <input
                value={form.outputDir}
                onChange={(e) => patch('outputDir', e.target.value)}
                placeholder="Elegí la carpeta…"
              />
              <button type="button" className="ghost" onClick={() => void chooseFolder()}>
                Examinar
              </button>
            </span>
          </label>
        </div>

        <div className="compress-actions">
          {status.recording ? (
            <button
              type="button"
              className="primary icon-text"
              onClick={() => void stopRecording()}
              disabled={busy}
            >
              <Icon name="stop" size={14} />
              Detener ({Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')})
            </button>
          ) : (
            <button
              type="button"
              className="primary icon-text"
              onClick={() => void startRecording()}
              disabled={busy || !service.available}
            >
              <Icon name="play" size={14} />
              Grabar
            </button>
          )}
          {status.output ? (
            <button
              type="button"
              className="ghost"
              onClick={() => void service.revealOutput(status.output!)}
            >
              Abrir carpeta
            </button>
          ) : null}
          <button
            type="button"
            className="ghost"
            onClick={() => void previewRecording()}
            disabled={busy || !service.available || status.recording}
          >
            Vista previa
          </button>
        </div>
        {lastResult?.ok ? (
          <p className="fine-print">
            Última grabación: {lastResult.output} · {lastResult.durationSecs ?? '?'} s ·{' '}
            {lastResult.width ?? '?'}×{lastResult.height ?? '?'}
            {lastResult.hasAudio ? ' · con audio' : ' · sin audio'}
            {lastResult.cursorBurned ? ' · cursor quemado' : ''}
          </p>
        ) : null}
        {lastResult?.warning ? <p className="fine-print">{lastResult.warning}</p> : null}
      </div>

      <div className="compress-slot">
        <h2>Escenas OBS</h2>
        <p className="fine-print">
          Una escena guarda captura, cámara, audio, encoder y streaming. Se guardan en tu equipo y
          sobreviven al reinicio de la app.
        </p>

        <div className="denoise-controls">
          <label className="field">
            <span>Nombre de la escena</span>
            <input
              value={sceneName}
              onChange={(e) => setSceneName(e.target.value)}
              placeholder="Ej. Charla con webcam"
            />
          </label>
        </div>
        <p className="fine-print">
          La escena usará la configuración de «Grabación rápida» de arriba (captura, cámara,
          audio, encoder y carpeta de destino).
        </p>
        <div className="compress-actions">
          <button
            type="button"
            className="ghost icon-text"
            onClick={() => void saveScene()}
            disabled={busy || !service.available}
          >
            <Icon name="save" size={14} />
            {editingSceneId ? 'Actualizar escena' : 'Guardar escena'}
          </button>
          {editingSceneId ? (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setEditingSceneId(null);
                setSceneName('');
                setForm(EMPTY_FORM);
              }}
            >
              Cancelar edición
            </button>
          ) : null}
        </div>

        {scenes.length === 0 ? (
          <p className="fine-print">Todavía no hay escenas guardadas.</p>
        ) : (
          <ul className="record-scenes">
            {scenes.map((scene) => (
              <li key={scene.id} className="record-scene">
                <div>
                  <strong>{scene.name}</strong>
                  <span className="fine-print">
                    {scene.captureTarget ?? 'desktop'} · {scene.fps ?? 30} fps
                    {scene.streamEndpoint || scene.streamUrl ? ' · RTMP' : ''}
                    {scene.webcamDevice ? ' · webcam' : ''}{scene.webcamChroma ? ' · chroma key' : ''}{scene.cursorOverlay ? ' · cursor personalizado' : ''}
                  </span>
                </div>
                <div className="record-scene-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void previewScene(scene.id)}
                    disabled={busy}
                  >
                    Vista previa
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setEditingSceneId(scene.id);
                      setSceneName(scene.name);
                      setForm(sceneToForm(scene));
                    }}
                    disabled={busy}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void startScene(scene.id)}
                    disabled={busy || status.recording}
                  >
                    Iniciar
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void deleteScene(scene.id)}
                    disabled={busy}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {preview ? (
        <figure className="record-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt={`Vista previa de ${preview.label}`} />
          <figcaption className="fine-print">
            Frame real capturado de {preview.label} (sin grabar).
          </figcaption>
        </figure>
      ) : null}
    </section>
  );
}
