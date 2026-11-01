import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { useProjectStore } from '../../state/project-store';
import type { DesktopService } from '../../services/project-service';
import type { ChromaKey, ClipCurves } from '@editor-ia/project-schema';
import { applyCubeToPixels, parseCube, type CubeLut } from './lut-preview';
import { createLutRenderer, type LutRenderStage } from './lut-renderer';
import { applyCurveToPixels, curvesToLut } from './curves-lut';
import { composeToneWithCurves, toneCurveTable } from './tone-curve';
import { hslColorMask, hslMatrixRows } from './hsl-matrix';
import { ensureScratchCanvas } from './scratch-canvas';

/** Hay algún parámetro HSL distinto de cero. */
function hslActive(hue?: number, sat?: number, intensity?: number): boolean {
  return (
    Math.abs(hue ?? 0) > 0.0005 ||
    Math.abs(sat ?? 0) > 0.0005 ||
    Math.abs(intensity ?? 0) > 0.0005
  );
}
import { chromaKeyUniforms } from './chroma-key-preview';
import {
  applyColorWheelsToPixels,
  colorWheelsUniforms,
  type ColorWheelsInput,
} from './color-wheels-preview';
import {
  newestMotionBlurWeight,
  normalizedMotionBlur,
  type MotionBlurSettings,
} from './motion-blur-preview';

/**
 * Superficie de preview de efectos que necesitan canvas: LUT `.cube`, motion
 * blur temporal o ambos. El video/imagen original sigue montado (el video
 * conserva el audio y el enrutado Web Audio); encima se dibuja el frame
 * procesado.
 *
 * Orden, igual al export: grade CSS + shader del clip (ruedas, gamma, curvas,
 * chroma, denoise y viñeta) → acumulación temporal del motion blur → LUT del
 * clip y del look global → glow/grano/nitidez en el filtro CSS del canvas. El
 * motion blur usa un promedio exponencial con el peso exacto del último frame
 * de `tmix`; los anteriores siguen la misma caída geométrica. Si WebGL2 no está
 * disponible, las imágenes usan un fallback 2D para el LUT y el motion blur
 * (sólo video) queda sin preview.
 */

const cubeCaches = new WeakMap<DesktopService, Map<string, Promise<CubeLut>>>();

/** Cache por servicio y ruta: el LUT es texto estático dentro del proyecto. */
export function loadCubeLut(
  service: DesktopService,
  root: string,
  file: string,
): Promise<CubeLut> {
  let cache = cubeCaches.get(service);
  if (!cache) {
    cache = new Map();
    cubeCaches.set(service, cache);
  }
  const key = `${root}\u0000${file}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = service.readProjectText(file).then((text) => parseCube(text));
  cache.set(key, promise);
  promise.catch(() => {
    if (cache?.get(key) === promise) cache.delete(key);
  });
  return promise;
}

function clampIntensity(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

function useCubeLut(file: string | undefined): CubeLut | null {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const [lut, setLut] = useState<CubeLut | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLut(null);
    if (!file) {
      return () => {
        cancelled = true;
      };
    }
    loadCubeLut(store.service, root, file)
      .then((value) => {
        if (!cancelled) setLut(value);
      })
      .catch(() => {
        if (!cancelled) setLut(null);
      });
    return () => {
      cancelled = true;
    };
  }, [store.service, root, file]);
  return lut;
}

export interface EffectOverlayProps {
  readonly sourceRef: RefObject<HTMLVideoElement | HTMLImageElement | null>;
  readonly sourceKind: 'video' | 'image';
  /** Cambia cuando el elemento fuente se remonta (nueva URL o reload). */
  readonly sourceKey: string;
  readonly style: CSSProperties;
  readonly dataClipId: string;
  readonly gradeFilter: string;
  /**
   * Grade del look global. El export lo aplica después del LUT del clip y
   * antes del LUT del look; la preview lo inserta en ese mismo punto.
   */
  readonly lookGradeFilter?: string;
  readonly clipLutFile: string | undefined;
  readonly clipIntensity: number;
  readonly lookLutFile: string | undefined;
  readonly lookIntensity: number;
  readonly motionBlur: MotionBlurSettings | undefined;
  readonly denoise: number | undefined;
  readonly vignette: number | undefined;
  /** Curvas del clip; se aplican antes del LUT, como el export. */
  readonly curves?: ClipCurves | undefined;
  /** Sombras/luces/fade: curva maestra antes de las curvas del clip. */
  readonly shadows?: number | undefined;
  readonly highlights?: number | undefined;
  readonly fade?: number | undefined;
  /** Sombras/luces/fade del look, aplicados en la pasada del look. */
  readonly lookShadows?: number | undefined;
  readonly lookHighlights?: number | undefined;
  readonly lookFade?: number | undefined;
  /** Ganancia por canal del colorMatch del clip y del look. */
  readonly matchR?: number | undefined;
  readonly matchG?: number | undefined;
  readonly matchB?: number | undefined;
  readonly lookMatchR?: number | undefined;
  readonly lookMatchG?: number | undefined;
  readonly lookMatchB?: number | undefined;
  /** HSL (huesaturation) del clip y del look. */
  readonly hslHue?: number | undefined;
  readonly hslSat?: number | undefined;
  readonly hslIntensity?: number | undefined;
  /** Ranges seleccionados de `huesaturation` (r/y/g/c/b/m). */
  readonly hslColors?: readonly string[] | null | undefined;
  readonly lookHslHue?: number | undefined;
  readonly lookHslSat?: number | undefined;
  readonly lookHslIntensity?: number | undefined;
  readonly lookHslColors?: readonly string[] | null | undefined;
  /** Chroma key del clip; el alfa se calcula antes del grade, como el export. */
  readonly chromaKey?: ChromaKey | undefined;
  /** Ruedas de color (lift/offset/gain) y gamma del clip. */
  readonly colorWheels?: ColorWheelsInput | undefined;
  /** Aplica el brillo del clip con `colorbalance` cuando la capa ya usa shader. */
  readonly brightnessInShader?: boolean;
  /** Temperatura del clip (colorbalance de sombras) cuando el shader la aplica. */
  readonly temperature?: number | undefined;
  /** Contraste del clip (colorlevels) cuando el shader lo aplica. */
  readonly contrast?: number | undefined;
  /** Saturación del clip (hue=s con luma BT.601) cuando el shader la aplica. */
  readonly saturation?: number | undefined;
  /** Giro de tono del clip en grados cuando el shader lo aplica. */
  readonly hueRotateDeg?: number | undefined;
  /** Escala de grises (BT.601) aplicada por el shader después de curvas. */
  readonly grayscale?: boolean | undefined;
  /** Sepia (colorchannelmixer) aplicado por el shader después de curvas. */
  readonly sepia?: boolean | undefined;
  /** Ruedas de color del look global; se aplican entre el grade y el LUT del look. */
  readonly lookColorWheels?: ColorWheelsInput | undefined;
  /** El look sólo tiene brillo: se aplica como colorbalance de sombras. */
  readonly lookBrightnessInShader?: boolean;
  /** Grade del look (mismas etapas que el clip) aplicado antes del LUT del look. */
  readonly lookContrast?: number | undefined;
  readonly lookSaturation?: number | undefined;
  readonly lookHueDeg?: number | undefined;
  readonly lookTemperature?: number | undefined;
  readonly lookGrayscale?: boolean | undefined;
  readonly lookSepia?: boolean | undefined;
  /** Historial temporal del denoise; se puede desactivar en perfiles livianos. */
  readonly temporalDenoise?: boolean;
  readonly playing: boolean;
  readonly onReadyChange: (ready: boolean) => void;
}

export function EffectOverlay({
  sourceRef,
  sourceKind,
  sourceKey,
  style,
  dataClipId,
  gradeFilter,
  lookGradeFilter = '',
  clipLutFile,
  clipIntensity,
  lookLutFile,
  lookIntensity,
  motionBlur,
  denoise,
  vignette,
  curves,
  shadows,
  highlights,
  fade,
  lookShadows,
  lookHighlights,
  lookFade,
  matchR,
  matchG,
  matchB,
  lookMatchR,
  lookMatchG,
  lookMatchB,
  hslHue,
  hslSat,
  hslIntensity,
  hslColors,
  lookHslHue,
  lookHslSat,
  lookHslIntensity,
  lookHslColors,
  chromaKey,
  colorWheels,
  brightnessInShader = false,
  temperature,
  contrast,
  saturation,
  hueRotateDeg,
  grayscale,
  sepia,
  lookColorWheels,
  lookBrightnessInShader = false,
  lookContrast,
  lookSaturation,
  lookHueDeg,
  lookTemperature,
  lookGrayscale,
  lookSepia,
  temporalDenoise = true,
  playing,
  onReadyChange,
}: EffectOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const clipLut = useCubeLut(clipLutFile);
  const lookLut = useCubeLut(lookLutFile);
  const drawRef = useRef<(force?: boolean) => void>(() => {});
  const readyRef = useRef(false);
  const gradeRef = useRef(gradeFilter);
  const lookGradeRef = useRef(lookGradeFilter);
  const clipIntensityRef = useRef(clipIntensity);
  const lookIntensityRef = useRef(lookIntensity);
  const blurRef = useRef<MotionBlurSettings | undefined>(motionBlur);
  const denoiseRef = useRef(denoise);
  const vignetteRef = useRef(vignette);
  const temperatureRef = useRef(temperature);
  const contrastRef = useRef(contrast);
  const saturationRef = useRef(saturation);
  const hueRef = useRef(hueRotateDeg);
  const grayscaleRef = useRef(grayscale === true);
  const sepiaRef = useRef(sepia === true);
  const lookGradeValuesRef = useRef({
    contrast: lookContrast,
    saturation: lookSaturation,
    hueRotateDeg: lookHueDeg,
    temperature: lookTemperature,
    grayscale: lookGrayscale,
    sepia: lookSepia,
  });
  // La tabla se reconstruye sólo si cambian las curvas; el renderer compara
  // bytes antes de subirla, así que un objeto nuevo por keyframes no cuesta.
  const curveTable = useMemo(() => curvesToLut(curves), [curves]);
  const toneTable = useMemo(
    () => toneCurveTable({ shadows, highlights, fade }),
    [shadows, highlights, fade],
  );
  // La curva maestra de tono va antes de las curvas del clip, como el export.
  const composedCurve = useMemo(
    () => composeToneWithCurves(toneTable, curveTable),
    [toneTable, curveTable],
  );
  const curveRef = useRef<Uint8Array | null>(composedCurve);
  const lookToneTable = useMemo(
    () => toneCurveTable({ shadows: lookShadows, highlights: lookHighlights, fade: lookFade }),
    [lookShadows, lookHighlights, lookFade],
  );
  // El renderer recibe una tabla RGBA; la curva de tono sola se replica.
  const lookCurveTable = useMemo(
    () => composeToneWithCurves(lookToneTable, null),
    [lookToneTable],
  );
  const lookToneRef = useRef(lookCurveTable);
  const matchRef = useRef({ r: matchR ?? 1, g: matchG ?? 1, b: matchB ?? 1 });
  const lookMatchRef = useRef({
    r: lookMatchR ?? 1,
    g: lookMatchG ?? 1,
    b: lookMatchB ?? 1,
  });
  const hslRows = useMemo(
    () =>
      hslActive(hslHue, hslSat, hslIntensity)
        ? hslMatrixRows({ hue: hslHue, saturation: hslSat, intensity: hslIntensity })
        : null,
    [hslHue, hslSat, hslIntensity],
  );
  const lookHslRows = useMemo(
    () =>
      hslActive(lookHslHue, lookHslSat, lookHslIntensity)
        ? hslMatrixRows({
            hue: lookHslHue,
            saturation: lookHslSat,
            intensity: lookHslIntensity,
          })
        : null,
    [lookHslHue, lookHslSat, lookHslIntensity],
  );
  const hslRef = useRef(hslRows);
  const lookHslRef = useRef(lookHslRows);
  const hslMask = useMemo(() => hslColorMask(hslColors), [hslColors]);
  const lookHslMask = useMemo(() => hslColorMask(lookHslColors), [lookHslColors]);
  const hslMaskRef = useRef(hslMask);
  const lookHslMaskRef = useRef(lookHslMask);
  const keyUniforms = useMemo(() => chromaKeyUniforms(chromaKey), [chromaKey]);
  const keyRef = useRef(keyUniforms);
  const wheelsUniforms = useMemo(
    () => colorWheelsUniforms(colorWheels, { brightnessOnly: brightnessInShader }),
    [colorWheels, brightnessInShader],
  );
  const wheelsRef = useRef(wheelsUniforms);
  const lookWheelsUniforms = useMemo(
    () => colorWheelsUniforms(lookColorWheels, { brightnessOnly: lookBrightnessInShader }),
    [lookColorWheels, lookBrightnessInShader],
  );
  const lookWheelsRef = useRef(lookWheelsUniforms);
  // Un canvas no puede cambiar de contexto: si el LUT o los efectos de shader
  // aparecen o desaparecen se remonta el elemento para no quedar clavado en 2D
  // o WebGL.
  const denoiseActive =
    denoise !== undefined && Number.isFinite(denoise) && denoise > 0.001;
  const vignetteActive =
    vignette !== undefined && Number.isFinite(vignette) && vignette > 0.001;
  const curveActive = composedCurve !== null;
  const keyActive = keyUniforms !== null;
  const wheelsActive = wheelsUniforms !== null;
  const lookWheelsActive = lookWheelsUniforms !== null;
  const temperatureActive =
    temperature !== undefined && Number.isFinite(temperature) && Math.abs(temperature) > 0.001;
  const contrastActive =
    contrast !== undefined && Number.isFinite(contrast) && Math.abs(contrast - 1) > 0.001;
  const saturationActive =
    saturation !== undefined && Number.isFinite(saturation) && Math.abs(saturation - 1) > 0.001;
  const hueActive =
    hueRotateDeg !== undefined && Number.isFinite(hueRotateDeg) && Math.abs(hueRotateDeg) > 0.01;
  const grayscaleActive = grayscale === true;
  const sepiaActive = sepia === true;
  const matchActive =
    Math.abs((matchR ?? 1) - 1) > 0.0005 ||
    Math.abs((matchG ?? 1) - 1) > 0.0005 ||
    Math.abs((matchB ?? 1) - 1) > 0.0005;
  const lookMatchActive =
    Math.abs((lookMatchR ?? 1) - 1) > 0.0005 ||
    Math.abs((lookMatchG ?? 1) - 1) > 0.0005 ||
    Math.abs((lookMatchB ?? 1) - 1) > 0.0005;
  const lookGradeShaderActive =
    (lookContrast !== undefined && Math.abs(lookContrast - 1) > 0.001) ||
    (lookSaturation !== undefined && Math.abs(lookSaturation - 1) > 0.001) ||
    (lookHueDeg !== undefined && Math.abs(lookHueDeg) > 0.01) ||
    (lookTemperature !== undefined && Math.abs(lookTemperature) > 0.001) ||
    lookGrayscale === true ||
    lookSepia === true;
  const needsGl =
    Boolean(clipLutFile || lookLutFile) ||
    denoiseActive ||
    vignetteActive ||
    curveActive ||
    lookToneTable !== null ||
    keyActive ||
    wheelsActive ||
    lookWheelsActive ||
    temperatureActive ||
    contrastActive ||
    saturationActive ||
    hueActive ||
    grayscaleActive ||
    sepiaActive ||
    matchActive ||
    lookGradeShaderActive ||
    lookMatchActive ||
    hslRows !== null ||
    lookHslRows !== null;

  const reportReady = (ready: boolean): void => {
    if (readyRef.current === ready) return;
    readyRef.current = ready;
    onReadyChange(ready);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const source = sourceRef.current;
    if (!canvas || !source) return;
    // Mientras un LUT pedido no cargó, el medio original sigue visible sin
    // capa de efectos: nunca se muestra un frame en negro por una carga.
    if (clipLutFile && !clipLut) return;
    if (lookLutFile && !lookLut) return;

    let disposed = false;
    let failures = 0;
    let renderer = needsGl ? createLutRenderer(canvas) : null;
    if (
      needsGl &&
      !renderer &&
      (sourceKind === 'video' || denoiseActive || vignetteActive)
    ) {
      // Sin WebGL2 no hay denoise/vignette honesto; con LUT las imágenes
      // conservan el fallback 2D de abajo.
      reportReady(false);
      return;
    }
    let frame: HTMLCanvasElement | null = null;
    let frameContext: CanvasRenderingContext2D | null = null;
    let lookFrame: HTMLCanvasElement | null = null;
    let lookFrameContext: CanvasRenderingContext2D | null = null;
    let temporalA: HTMLCanvasElement | null = null;
    let temporalB: HTMLCanvasElement | null = null;
    let temporalC: HTMLCanvasElement | null = null;
    let temporalWidth = 0;
    let temporalHeight = 0;
    let temporalSamples = 0;
    let temporalSlot = 0;
    let lastTemporalTime = Number.NaN;
    let history: HTMLCanvasElement | null = null;
    let historyContext: CanvasRenderingContext2D | null = null;
    // Lienzos de trabajo reutilizados por la ruta 2D. Antes se creaba un canvas
    // nuevo por frame (y otro más cuando había grade del look): dos lienzos de
    // 1280×720 por frame de video es basura que el GC tiene que recoger en
    // plena reproducción. Se redimensionan sólo cuando cambia el tamaño.
    let workCanvas: HTMLCanvasElement | null = null;
    let gradedCanvas: HTMLCanvasElement | null = null;
    let fallbackContext: CanvasRenderingContext2D | null = null;
    let historyKey = '';
    let historySeeded = false;
    let lastTime = -1;
    let lastDrawnTime = Number.NaN;

    const sizeOf = (): { width: number; height: number } | null => {
      if (source instanceof HTMLVideoElement) {
        return source.videoWidth > 0 && source.videoHeight > 0
          ? { width: source.videoWidth, height: source.videoHeight }
          : null;
      }
      if (source instanceof HTMLImageElement) {
        return source.naturalWidth > 0 && source.naturalHeight > 0
          ? { width: source.naturalWidth, height: source.naturalHeight }
          : null;
      }
      return null;
    };

    const clipStagesNow = (): LutRenderStage[] =>
      clipLut
        ? [{ lut: clipLut, intensity: clampIntensity(clipIntensityRef.current) }]
        : [];

    const lookStagesNow = (): LutRenderStage[] =>
      lookLut
        ? [{ lut: lookLut, intensity: clampIntensity(lookIntensityRef.current) }]
        : [];

    const ensureFrame = (size: { width: number; height: number }): HTMLCanvasElement | null => {
      if (!frame) {
        frame = document.createElement('canvas');
        frameContext = frame.getContext('2d');
      }
      if (!frameContext) return null;
      if (frame.width !== size.width) frame.width = size.width;
      if (frame.height !== size.height) frame.height = size.height;
      return frame;
    };

    const ensureLookFrame = (
      size: { width: number; height: number },
    ): HTMLCanvasElement | null => {
      if (!lookFrame) {
        lookFrame = document.createElement('canvas');
        lookFrameContext = lookFrame.getContext('2d');
      }
      if (!lookFrameContext) return null;
      if (lookFrame.width !== size.width) lookFrame.width = size.width;
      if (lookFrame.height !== size.height) lookFrame.height = size.height;
      return lookFrame;
    };

    const ensureHistory = (
      size: { width: number; height: number },
      blur: { frames: number; intensity: number },
    ): HTMLCanvasElement | null => {
      // Cap de 1920 px: el blur se acumula en 2D y no necesita el tamaño 4K
      // completo para verse en el visor.
      const scale = Math.min(1, 1920 / Math.max(1, size.width));
      const width = Math.max(1, Math.round(size.width * scale));
      const height = Math.max(1, Math.round(size.height * scale));
      const key = `${width}x${height}:${blur.frames}:${blur.intensity}`;
      if (!history) history = document.createElement('canvas');
      if (historyKey !== key) {
        history.width = width;
        history.height = height;
        historyContext = history.getContext('2d');
        historyKey = key;
        historySeeded = false;
        lastTime = -1;
        lastDrawnTime = Number.NaN;
      }
      return historyContext ? history : null;
    };

    const drawImageFallback = (
      size: { width: number; height: number },
      clipStages: readonly LutRenderStage[],
      lookStages: readonly LutRenderStage[],
    ): void => {
      const scale = Math.min(1, 1280 / Math.max(1, size.width));
      const width = Math.max(1, Math.round(size.width * scale));
      const height = Math.max(1, Math.round(size.height * scale));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const ensureWorkCanvas = (): HTMLCanvasElement => {
        const scratch = ensureScratchCanvas(workCanvas, width, height, () =>
          document.createElement('canvas'),
        );
        workCanvas = scratch.canvas;
        return scratch.canvas;
      };
      const ensureGradedCanvas = (): HTMLCanvasElement => {
        const scratch = ensureScratchCanvas(gradedCanvas, width, height, () =>
          document.createElement('canvas'),
        );
        gradedCanvas = scratch.canvas;
        return scratch.canvas;
      };
      // `willReadFrequently` mantiene el lienzo en memoria del CPU: esta ruta
      // hace getImageData/putImageData en cada frame, y con el lienzo en GPU
      // cada lectura es una descarga completa.
      const context =
        fallbackContext ?? canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        reportReady(false);
        return;
      }
      fallbackContext = context;
      if (typeof context.filter !== 'string') {
        reportReady(false);
        return;
      }
      const work = ensureWorkCanvas();
      const workContext = work?.getContext('2d');
      if (!work) {
        reportReady(false);
        return;
      }
      if (!workContext || typeof workContext.filter !== 'string') {
        reportReady(false);
        return;
      }
      const applyStages = (
        target: CanvasRenderingContext2D,
        stages: readonly LutRenderStage[],
        withCurve = false,
        withWheels = false,
      ): boolean => {
        const table = withCurve ? curveRef.current : null;
        const wheels = withWheels ? wheelsRef.current : null;
        if (stages.length === 0 && !table && !wheels) return true;
        const imageData = target.getImageData(0, 0, width, height);
        // Mismo orden que el export y el shader: ruedas (colorbalance con
        // brillo y gamma) antes de las curvas.
        if (wheels) applyColorWheelsToPixels(wheels, imageData.data);
        if (table) applyCurveToPixels(table, imageData.data);
        for (const stage of stages) {
          applyCubeToPixels(stage.lut, imageData.data, stage.intensity);
        }
        target.putImageData(imageData, 0, 0);
        return true;
      };
      const paintWheels = (
        target: CanvasRenderingContext2D,
        wheels: NonNullable<typeof lookWheelsRef.current>,
      ): void => {
        const imageData = target.getImageData(0, 0, width, height);
        applyColorWheelsToPixels(wheels, imageData.data);
        target.putImageData(imageData, 0, 0);
      };
      try {
        workContext.filter = gradeRef.current.trim() || 'none';
        workContext.drawImage(source, 0, 0, width, height);
        workContext.filter = 'none';
        let input = work;
        const lookGrade = lookGradeRef.current.trim();
        const lookWheels = lookWheelsRef.current;
        if (!lookGrade && !lookWheels) {
          applyStages(workContext, [...clipStages, ...lookStages], true, true);
        } else {
          // Orden del export: ruedas del look → grade del look → LUT del look.
          applyStages(workContext, clipStages, true, true);
          if (lookWheels) paintWheels(workContext, lookWheels);
          let graded = work;
          let gradedContext = workContext;
          if (lookGrade) {
            const scratch = ensureGradedCanvas();
            if (!scratch) {
              reportReady(false);
              return;
            }
            graded = scratch;
            const created = scratch.getContext('2d');
            if (!created || typeof created.filter !== 'string') {
              reportReady(false);
              return;
            }
            gradedContext = created;
            gradedContext.filter = lookGrade;
            gradedContext.drawImage(work, 0, 0, width, height);
            gradedContext.filter = 'none';
          }
          applyStages(gradedContext, lookStages);
          input = graded;
        }
        context.clearRect(0, 0, width, height);
        context.drawImage(input, 0, 0, width, height);
        reportReady(true);
      } catch {
        reportReady(false);
      }
    };

    /**
     * Orden del look: LUT del clip → ruedas del look → grade 2D → LUT del look.
     * Las ruedas van antes del resto del grade, como `grade_filters` del export.
     * Las curvas, ruedas y chroma del clip sólo actúan en la primera pasada.
     */
    const renderWithLookOrder = (
      input: TexImageSource,
      width: number,
      height: number,
      denoise: number | undefined,
      vignette: number | undefined,
      previous?: TexImageSource,
      temporal?: number,
      clipStateApplied = false,
      previous2?: TexImageSource,
    ): boolean => {
      if (!renderer) return false;
      const lookGrade = lookGradeRef.current.trim();
      const lookWheels = lookWheelsRef.current;
      const lookStages = lookStagesNow();
      const lookValues = lookGradeValuesRef.current;
      const lookToneActive = lookToneRef.current !== null;
      const lookHslActive = lookHslRef.current !== null;
      const lookMatchActiveNow =
        Math.abs(lookMatchRef.current.r - 1) > 0.0005 ||
        Math.abs(lookMatchRef.current.g - 1) > 0.0005 ||
        Math.abs(lookMatchRef.current.b - 1) > 0.0005;
      const lookShaderActive =
        (lookValues.contrast !== undefined && Math.abs(lookValues.contrast - 1) > 0.001) ||
        (lookValues.saturation !== undefined && Math.abs(lookValues.saturation - 1) > 0.001) ||
        (lookValues.hueRotateDeg !== undefined &&
          Math.abs(lookValues.hueRotateDeg) > 0.01) ||
        (lookValues.temperature !== undefined && Math.abs(lookValues.temperature) > 0.001) ||
        lookValues.grayscale === true ||
        lookValues.sepia === true;
      const runWithoutClipState = (paint: () => boolean): boolean => {
        const savedCurve = curveRef.current;
        const savedWheels = wheelsRef.current;
        const savedKey = keyRef.current;
        const savedTemperature = temperatureRef.current ?? 0;
        const savedContrast = contrastRef.current ?? 1;
        const savedSaturation = saturationRef.current ?? 1;
        const savedHue = hueRef.current ?? 0;
        const savedGrayscale = grayscaleRef.current;
        const savedSepia = sepiaRef.current;
        const savedMatch = matchRef.current;
        const savedHsl = hslRef.current;
        const savedHslMask = hslMaskRef.current;
        renderer!.setCurve(null);
        renderer!.setColorWheels(null);
        renderer!.setChromaKey(null);
        renderer!.setTemperature(0);
        renderer!.setContrast(1);
        renderer!.setSaturation(1);
        renderer!.setHue(0);
        renderer!.setGrayscale(false);
        renderer!.setSepia(false);
        renderer!.setChannelGain(1, 1, 1);
        renderer!.setHslMatrix(null);
        try {
          return paint();
        } finally {
          renderer!.setCurve(savedCurve);
          renderer!.setColorWheels(savedWheels);
          renderer!.setChromaKey(savedKey);
          renderer!.setTemperature(savedTemperature);
          renderer!.setContrast(savedContrast);
          renderer!.setSaturation(savedSaturation);
          renderer!.setHue(savedHue);
          renderer!.setGrayscale(savedGrayscale);
          renderer!.setSepia(savedSepia);
          renderer!.setChannelGain(savedMatch.r, savedMatch.g, savedMatch.b);
          renderer!.setHslMatrix(savedHsl, savedHslMask);
        }
      };
      const runWithLookGrade = (paint: () => boolean): boolean => {
        const savedCurve = curveRef.current;
        const savedWheels = wheelsRef.current;
        const savedKey = keyRef.current;
        const savedTemperature = temperatureRef.current ?? 0;
        const savedContrast = contrastRef.current ?? 1;
        const savedSaturation = saturationRef.current ?? 1;
        const savedHue = hueRef.current ?? 0;
        const savedGrayscale = grayscaleRef.current;
        const savedSepia = sepiaRef.current;
        const savedHsl = hslRef.current;
        const savedHslMask = hslMaskRef.current;
        renderer!.setCurve(lookToneRef.current);
        renderer!.setColorWheels(null);
        renderer!.setChromaKey(null);
        renderer!.setTemperature(lookValues.temperature ?? 0);
        renderer!.setContrast(lookValues.contrast ?? 1);
        renderer!.setSaturation(lookValues.saturation ?? 1);
        renderer!.setHue(lookValues.hueRotateDeg ?? 0);
        renderer!.setGrayscale(lookValues.grayscale === true);
        renderer!.setSepia(lookValues.sepia === true);
        renderer!.setChannelGain(
          lookMatchRef.current.r,
          lookMatchRef.current.g,
          lookMatchRef.current.b,
        );
        renderer!.setHslMatrix(lookHslRef.current, lookHslMaskRef.current);
        try {
          return paint();
        } finally {
          renderer!.setCurve(savedCurve);
          renderer!.setColorWheels(savedWheels);
          renderer!.setChromaKey(savedKey);
          renderer!.setTemperature(savedTemperature);
          renderer!.setContrast(savedContrast);
          renderer!.setSaturation(savedSaturation);
          renderer!.setHue(savedHue);
          renderer!.setGrayscale(savedGrayscale);
          renderer!.setSepia(savedSepia);
          renderer!.setHslMatrix(savedHsl, savedHslMask);
        }
      };
      if (
        !lookGrade &&
        !lookWheels &&
        !lookShaderActive &&
        !lookToneActive &&
        !lookMatchActiveNow &&
        !lookHslActive
      ) {
        if (clipStateApplied) {
          return runWithoutClipState(() =>
            renderer!.render(
              input,
              width,
              height,
              [...clipStagesNow(), ...lookStages],
              denoise,
              vignette,
              previous,
              temporal,
              previous2,
            ),
          );
        }
        return renderer.render(
          input,
          width,
          height,
          [...clipStagesNow(), ...lookStages],
          denoise,
          vignette,
          previous,
          temporal,
          previous2,
        );
      }
      const first = clipStateApplied
        ? runWithoutClipState(() =>
            renderer!.render(
              input,
              width,
              height,
              clipStagesNow(),
              denoise,
              vignette,
              previous,
              temporal,
              previous2,
            ),
          )
        : renderer.render(
            input,
            width,
            height,
            clipStagesNow(),
            denoise,
            vignette,
            previous,
            temporal,
            previous2,
          );
      if (!first) return false;
      // Ruedas del look antes del resto del grade, como el export.
      if (lookWheels) {
        const wheelsBuffer = ensureLookFrame({ width: canvas.width, height: canvas.height });
        if (!wheelsBuffer || !lookFrameContext) return false;
        lookFrameContext.clearRect(0, 0, wheelsBuffer.width, wheelsBuffer.height);
        lookFrameContext.drawImage(canvas, 0, 0, wheelsBuffer.width, wheelsBuffer.height);
        const painted = runWithoutClipState(() => {
          renderer!.setColorWheels(lookWheels);
          return renderer!.render(
            wheelsBuffer,
            wheelsBuffer.width,
            wheelsBuffer.height,
            [],
            0,
            0,
          );
        });
        if (!painted) return false;
        if (
          !lookGrade &&
          !lookShaderActive &&
          !lookToneActive &&
          !lookMatchActiveNow &&
          !lookHslActive &&
          lookStages.length === 0
        ) {
          return true;
        }
      }
      if (
        lookGrade ||
        lookStages.length > 0 ||
        lookShaderActive ||
        lookToneActive ||
        lookMatchActiveNow ||
        lookHslActive
      ) {
        const buffer = ensureLookFrame({ width: canvas.width, height: canvas.height });
        if (!buffer || !lookFrameContext || typeof lookFrameContext.filter !== 'string') {
          return false;
        }
        // Copia a un canvas 2D: leer y escribir el mismo canvas WebGL como
        // fuente depende del driver.
        lookFrameContext.clearRect(0, 0, buffer.width, buffer.height);
        if (lookGrade) {
          lookFrameContext.filter = lookGrade;
        }
        lookFrameContext.drawImage(canvas, 0, 0, buffer.width, buffer.height);
        lookFrameContext.filter = 'none';
        if (lookShaderActive || lookToneActive || lookMatchActiveNow || lookHslActive) {
          // Etapas del look con la fórmula del export, después del grade CSS
          // restante y antes del LUT del look.
          const painted = runWithLookGrade(() =>
            renderer!.render(buffer, buffer.width, buffer.height, [], 0, 0),
          );
          if (!painted) return false;
          if (lookStages.length === 0) return true;
          lookFrameContext.clearRect(0, 0, buffer.width, buffer.height);
          lookFrameContext.drawImage(canvas, 0, 0, buffer.width, buffer.height);
        }
        if (lookStages.length === 0) {
          // Sólo grade (con o sin ruedas): quedó en el buffer 2D y hay que
          // devolverlo al canvas visible (un canvas WebGL no admite un
          // contexto 2D para dibujarlo directamente).
          return runWithoutClipState(() =>
            renderer!.render(buffer, buffer.width, buffer.height, [], 0, 0),
          );
        }
        return runWithoutClipState(() =>
          renderer!.render(
            buffer,
            buffer.width,
            buffer.height,
            lookStages,
            0,
            0,
          ),
        );
      }
      return true;
    };

    const displayHistory = (width: number, height: number): void => {
      const context = canvas.getContext('2d');
      if (!context || !history) {
        reportReady(false);
        return;
      }
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const lookGrade = lookGradeRef.current.trim();
      context.clearRect(0, 0, width, height);
      if (lookGrade && typeof context.filter === 'string') {
        const graded = document.createElement('canvas');
        graded.width = width;
        graded.height = height;
        const gradedContext = graded.getContext('2d');
        if (!gradedContext || typeof gradedContext.filter !== 'string') {
          reportReady(false);
          return;
        }
        gradedContext.filter = lookGrade;
        gradedContext.drawImage(history, 0, 0, width, height);
        gradedContext.filter = 'none';
        context.drawImage(graded, 0, 0, width, height);
      } else {
        context.drawImage(history, 0, 0, width, height);
      }
      reportReady(true);
    };

    const draw = (force = false): void => {
      if (disposed) return;
      renderer?.setCurve(curveRef.current);
      renderer?.setChromaKey(keyRef.current);
      renderer?.setColorWheels(wheelsRef.current);
      renderer?.setTemperature(temperatureRef.current ?? 0);
      renderer?.setContrast(contrastRef.current ?? 1);
      renderer?.setSaturation(saturationRef.current ?? 1);
      renderer?.setHue(hueRef.current ?? 0);
      renderer?.setGrayscale(grayscaleRef.current);
      renderer?.setSepia(sepiaRef.current);
      renderer?.setChannelGain(
        matchRef.current.r,
        matchRef.current.g,
        matchRef.current.b,
      );
      renderer?.setHslMatrix(hslRef.current, hslMaskRef.current);
      const size = sizeOf();
      if (!size) return;
      if (source instanceof HTMLVideoElement && source.readyState < 2) return;
      const grade = gradeRef.current.trim();
      const clipStages = clipStagesNow();
      const lookStages = lookStagesNow();
      const blur = normalizedMotionBlur(blurRef.current);
      const time = source instanceof HTMLVideoElement ? source.currentTime : 0;

      if (blur) {
        const buffer = ensureHistory(size, blur);
        if (!buffer || !historyContext) {
          reportReady(false);
          return;
        }
        const reset =
          !historySeeded || time < lastTime - 0.05 || time - lastTime > 0.75;
        const sameFrame =
          historySeeded && !reset && Math.abs(time - lastDrawnTime) < 1e-4;
        // Un mismo frame puede disparar loadeddata/timeupdate/seeked: no se
        // vuelve a acumular. `force` sólo re-renderiza la salida (por ejemplo
        // al cambiar la intensidad del LUT) sin sumar otra copia.
        if (!force && sameFrame) return;
        if (!sameFrame) {
          const alpha =
            !historySeeded || reset
              ? 1
              : newestMotionBlurWeight(blur.frames, blur.intensity);
          let accumulated = false;
          if (renderer) {
            // Grade, curvas, ruedas, chroma, denoise y viñeta antes de `tmix`,
            // como el export; el LUT del clip va después de la acumulación.
            let input: TexImageSource = source;
            if (grade) {
              const prepared = ensureFrame({ width: buffer.width, height: buffer.height });
              if (prepared && frameContext) {
                frameContext.filter = grade;
                frameContext.drawImage(source, 0, 0, buffer.width, buffer.height);
                frameContext.filter = 'none';
                input = prepared;
              }
            }
            const rendered = renderer.render(
              input,
              buffer.width,
              buffer.height,
              [],
              denoiseRef.current,
              vignetteRef.current,
            );
            if (rendered) {
              historyContext.globalCompositeOperation = 'source-over';
              historyContext.globalAlpha = alpha;
              historyContext.drawImage(canvas, 0, 0, buffer.width, buffer.height);
              historyContext.globalAlpha = 1;
              accumulated = true;
            } else {
              failures += 1;
              if (failures >= 3) {
                renderer.dispose();
                renderer = null;
              }
            }
          }
          if (!accumulated) {
            if (grade && typeof historyContext.filter !== 'string') {
              renderer?.dispose();
              renderer = null;
              reportReady(false);
              return;
            }
            historyContext.globalCompositeOperation = 'source-over';
            historyContext.globalAlpha = alpha;
            historyContext.filter = grade || 'none';
            historyContext.drawImage(source, 0, 0, buffer.width, buffer.height);
            historyContext.filter = 'none';
            historyContext.globalAlpha = 1;
          }
          historySeeded = true;
          lastDrawnTime = time;
        }
        lastTime = time;
        if (renderer) {
          const ok = renderWithLookOrder(
            buffer,
            buffer.width,
            buffer.height,
            undefined,
            undefined,
            undefined,
            undefined,
            true,
          );
          if (!ok) {
            failures += 1;
            if (failures >= 3) {
              renderer.dispose();
              renderer = null;
            }
          } else {
            failures = 0;
          }
          reportReady(ok);
          return;
        }
        displayHistory(buffer.width, buffer.height);
        return;
      }

      if (renderer) {
        let input: TexImageSource = source;
        let previousInput: TexImageSource | undefined;
        let previousInput2: TexImageSource | undefined;
        let temporalStrength = 0;
        let temporalPending = false;
        if (denoiseActive && sourceKind === 'video' && temporalDenoise) {
          const scale = Math.min(1, 1920 / Math.max(1, size.width));
          const width = Math.max(1, Math.round(size.width * scale));
          const height = Math.max(1, Math.round(size.height * scale));
          if (!temporalA || !temporalB || !temporalC) {
            temporalA = document.createElement('canvas');
            temporalB = document.createElement('canvas');
            temporalC = document.createElement('canvas');
          }
          if (temporalWidth !== width || temporalHeight !== height) {
            temporalA.width = width;
            temporalA.height = height;
            temporalB.width = width;
            temporalB.height = height;
            temporalC.width = width;
            temporalC.height = height;
            temporalWidth = width;
            temporalHeight = height;
            temporalSamples = 0;
            temporalSlot = 0;
          }
          const paused = source instanceof HTMLVideoElement && source.paused;
          const reset =
            paused ||
            !Number.isFinite(lastTemporalTime) ||
            time < lastTemporalTime - 0.05 ||
            time - lastTemporalTime > 0.5;
          if (reset) {
            temporalSamples = 0;
            temporalSlot = 0;
          }
          const frames = [temporalA, temporalB, temporalC];
          const current = frames[temporalSlot]!;
          const previousBuffer =
            temporalSamples >= 1 ? frames[(temporalSlot + 2) % 3] : undefined;
          const previousBuffer2 =
            temporalSamples >= 2 ? frames[(temporalSlot + 1) % 3] : undefined;
          const currentContext = current.getContext('2d');
          if (currentContext) {
            currentContext.clearRect(0, 0, width, height);
            currentContext.filter = grade || 'none';
            currentContext.drawImage(source, 0, 0, width, height);
            currentContext.filter = 'none';
            input = current;
            if (!reset) {
              previousInput = previousBuffer;
              previousInput2 = previousBuffer2;
              temporalStrength = denoiseRef.current ?? 0;
            }
            temporalPending = true;
          }
        }
        if (input === source && grade) {
          const graded = ensureFrame(size);
          if (!graded || !frameContext || typeof frameContext.filter !== 'string') {
            renderer.dispose();
            renderer = null;
            reportReady(false);
            return;
          }
          frameContext.filter = grade;
          frameContext.drawImage(source, 0, 0, size.width, size.height);
          frameContext.filter = 'none';
          input = graded;
        }
        const ok = renderWithLookOrder(
          input,
          size.width,
          size.height,
          denoiseRef.current,
          vignetteRef.current,
          previousInput,
          temporalStrength,
          false,
          previousInput2,
        );
        if (!ok) {
          failures += 1;
          if (failures >= 3) {
            renderer.dispose();
            renderer = null;
          }
        } else {
          failures = 0;
          if (temporalPending) {
            temporalSamples = Math.min(3, temporalSamples + 1);
            temporalSlot = (temporalSlot + 1) % 3;
            lastTemporalTime = time;
          }
        }
        reportReady(ok);
        return;
      }
      if (sourceKind === 'image') {
        drawImageFallback(size, clipStages, lookStages);
        return;
      }
      // Un video sin WebGL2 no se redibuja en JS frame a frame: se deja el
      // elemento original y la UI sigue funcionando sin el efecto en vivo.
      reportReady(false);
    };

    drawRef.current = draw;

    const onFrame = (): void => {
      // Con motion blur y reproducción activa, sólo rVFC marca frames nuevos:
      // timeupdate/playing podrían acumular dos veces la misma imagen.
      if (
        normalizedMotionBlur(blurRef.current) &&
        source instanceof HTMLVideoElement &&
        !source.paused
      ) {
        return;
      }
      draw();
    };
    if (source instanceof HTMLVideoElement) {
      for (const event of ['loadeddata', 'seeked', 'timeupdate', 'playing', 'pause', 'resize', 'emptied']) {
        source.addEventListener(event, onFrame);
      }
    } else if (source instanceof HTMLImageElement) {
      if (source.complete) draw();
      else source.addEventListener('load', onFrame);
    }
    draw();

    return () => {
      disposed = true;
      drawRef.current = () => {};
      if (source instanceof HTMLVideoElement) {
        for (const event of ['loadeddata', 'seeked', 'timeupdate', 'playing', 'pause', 'resize', 'emptied']) {
          source.removeEventListener(event, onFrame);
        }
      } else if (source instanceof HTMLImageElement) {
        source.removeEventListener('load', onFrame);
      }
      renderer?.dispose();
      renderer = null;
      reportReady(false);
    };
    // El elemento fuente se identifica con `sourceKey`; los LUT son estados
    // inmutables. El grade, las intensidades y el blur se leen por ref en cada
    // frame para no reconstruir el renderer cuando animan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, sourceKind, clipLut, lookLut, clipLutFile, lookLutFile, needsGl]);

  useEffect(() => {
    gradeRef.current = gradeFilter;
    lookGradeRef.current = lookGradeFilter;
    clipIntensityRef.current = clipIntensity;
    lookIntensityRef.current = lookIntensity;
    blurRef.current = motionBlur;
    denoiseRef.current = denoise;
    vignetteRef.current = vignette;
    temperatureRef.current = temperature;
    contrastRef.current = contrast;
    saturationRef.current = saturation;
    hueRef.current = hueRotateDeg;
    grayscaleRef.current = grayscale === true;
    sepiaRef.current = sepia === true;
    lookGradeValuesRef.current = {
      contrast: lookContrast,
      saturation: lookSaturation,
      hueRotateDeg: lookHueDeg,
      temperature: lookTemperature,
      grayscale: lookGrayscale,
      sepia: lookSepia,
    };
    curveRef.current = composedCurve;
    hslRef.current = hslRows;
    lookHslRef.current = lookHslRows;
    hslMaskRef.current = hslMask;
    lookHslMaskRef.current = lookHslMask;
    lookToneRef.current = lookCurveTable;
    keyRef.current = keyUniforms;
    wheelsRef.current = wheelsUniforms;
    lookWheelsRef.current = lookWheelsUniforms;
    drawRef.current(true);
  }, [gradeFilter, lookGradeFilter, clipIntensity, lookIntensity, motionBlur, denoise, vignette, temperature, contrast, saturation, hueRotateDeg, grayscale, sepia, lookContrast, lookSaturation, lookHueDeg, lookTemperature, lookGrayscale, lookSepia, composedCurve, lookToneTable, lookCurveTable, matchR, matchG, matchB, lookMatchR, lookMatchG, lookMatchB, hslRows, lookHslRows, hslMask, lookHslMask, keyUniforms, wheelsUniforms, lookWheelsUniforms]);

  useEffect(() => {
    if (!playing) return;
    const source = sourceRef.current;
    let raf = 0;
    let cancelled = false;
    let frameHandle = 0;
    const video =
      source instanceof HTMLVideoElement &&
      typeof source.requestVideoFrameCallback === 'function'
        ? source
        : null;
    if (video) {
      // WebView2 entrega un callback por frame decodificado: evita subir la
      // misma textura dos veces cuando el video va a menos de 60 fps.
      const onVideoFrame = (): void => {
        if (cancelled) return;
        drawRef.current();
        frameHandle = video.requestVideoFrameCallback(onVideoFrame);
      };
      frameHandle = video.requestVideoFrameCallback(onVideoFrame);
    } else {
      const loop = (): void => {
        drawRef.current();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (video) video.cancelVideoFrameCallback(frameHandle);
    };
  }, [playing, sourceKey, sourceRef]);

  return (
    <canvas
      key={needsGl ? 'gl' : '2d'}
      ref={canvasRef}
      className="preview-media effect-preview-canvas"
      style={style}
      data-clip-id={dataClipId}
      aria-hidden="true"
    />
  );
}
