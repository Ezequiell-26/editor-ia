import { useEffect, useMemo, useRef, useState } from 'react';
import { EffectRenderer, effectRegistry, type EffectStack } from '@editor-ia/effect-kit';

export interface EffectCanvasProps {
  readonly source: HTMLVideoElement | HTMLImageElement | null;
  readonly stack: EffectStack;
  readonly frameIndex: number;
  readonly frameRate: number;
  readonly active: boolean;
  readonly className?: string;
}

/** jsdom no implementa WebGL; en tests el canvas se omite sin romper la vista. */
const WEBGL_AVAILABLE =
  typeof navigator === 'undefined' || !/jsdom/i.test(navigator.userAgent);

function sourceSize(source: HTMLVideoElement | HTMLImageElement): [number, number] {
  const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  return [width, height];
}

function sourceReady(source: HTMLVideoElement | HTMLImageElement): boolean {
  if (source instanceof HTMLVideoElement) return source.readyState >= 2 && source.videoWidth > 0;
  return source.complete && source.naturalWidth > 0;
}

/**
 * Dibuja el stack de efectos sobre el frame actual del visor.
 *
 * Antes corría un `requestAnimationFrame` perpetuo a 30 fps mientras el
 * preview estuviera abierto, aunque el video estuviera pausado y el frame
 * fuera siempre el mismo: re-subía la textura y ejecutaba los shaders 30
 * veces por segundo de forma indefinida. Ahora el render es **bajo demanda**:
 *
 * - un frame al montar y cada vez que cambian source/stack/frame;
 * - un bucle continuo (también con tope de 30 fps) sólo mientras el video
 *   esté reproduciéndose, controlado por los eventos `play`/`pause`;
 * - reintentos acotados mientras el medio todavía no tiene frame decodificado.
 *
 * En reposo no queda ningún rAF vivo, así que la vista VFX no consume CPU/GPU.
 */
export function EffectCanvas({
  source,
  stack,
  frameIndex,
  frameRate,
  active,
  className,
}: EffectCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<EffectRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `VfxView` pasa `effects.stack ?? []`: cuando no hay stack crea un array
  // nuevo en cada render. Comparar por contenido evita reiniciar el
  // programador de frames 30 veces por segundo durante la reproducción; el
  // ref garantiza que el draw use siempre el stack más reciente.
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const stackKey = useMemo(() => JSON.stringify(stack), [stack]);

  useEffect(() => {
    if (!WEBGL_AVAILABLE || !active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current = new EffectRenderer(canvas);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar el preview GPU.');
      return;
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [active]);

  useEffect(() => {
    if (!WEBGL_AVAILABLE || !active || !source) return;
    let disposed = false;
    let looping = false;
    let loopHandle = 0;
    let onceHandle = 0;
    let readyTimer = 0;
    let readyAttempts = 0;
    let lastTime = -Infinity;

    const render = (timestamp: number): void => {
      const renderer = rendererRef.current;
      const target = source;
      if (!renderer || !target || !sourceReady(target)) return;
      // 30 fps alcanzan para el preview y dejan aire al hilo de la UI.
      if (timestamp - lastTime < 32) return;
      lastTime = timestamp;
      const [width, height] = sourceSize(target);
      if (width <= 0 || height <= 0) return;
      try {
        renderer.resize(width, height);
        renderer.uploadSource(target);
        renderer.render(effectRegistry, stackRef.current, {
          timeSeconds:
            target instanceof HTMLVideoElement ? target.currentTime : frameIndex / frameRate,
          frameIndex,
          frameRate,
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'El shader no compiló.');
        stopLoop();
      }
    };

    const stopLoop = (): void => {
      looping = false;
      if (loopHandle !== 0) cancelAnimationFrame(loopHandle);
      loopHandle = 0;
    };

    const tick = (timestamp: number): void => {
      if (disposed || !looping) return;
      render(timestamp);
      if (looping && !disposed) loopHandle = requestAnimationFrame(tick);
    };

    const startLoop = (): void => {
      if (disposed || looping) return;
      looping = true;
      lastTime = -Infinity;
      loopHandle = requestAnimationFrame(tick);
    };

    /** Un único frame. Si el medio aún no está listo, reintenta acotado. */
    const scheduleOnce = (): void => {
      if (disposed) return;
      if (onceHandle !== 0) cancelAnimationFrame(onceHandle);
      lastTime = -Infinity;
      onceHandle = requestAnimationFrame((timestamp) => {
        onceHandle = 0;
        if (disposed) return;
        const wasReady = sourceReady(source);
        render(timestamp);
        if (!wasReady && readyAttempts < 25 && !looping) {
          readyAttempts += 1;
          readyTimer = window.setTimeout(scheduleOnce, 120);
        }
      });
    };

    const video = source instanceof HTMLVideoElement ? source : null;
    const onPlay = (): void => startLoop();
    const onPause = (): void => {
      stopLoop();
      scheduleOnce();
    };
    const onFrameChanged = (): void => {
      if (!looping) scheduleOnce();
    };

    if (video) {
      video.addEventListener('play', onPlay);
      video.addEventListener('pause', onPause);
      video.addEventListener('seeked', onFrameChanged);
      video.addEventListener('loadeddata', onFrameChanged);
      if (!video.paused && !video.ended) startLoop();
    }
    scheduleOnce();

    return () => {
      disposed = true;
      stopLoop();
      if (onceHandle !== 0) cancelAnimationFrame(onceHandle);
      if (readyTimer !== 0) window.clearTimeout(readyTimer);
      if (video) {
        video.removeEventListener('play', onPlay);
        video.removeEventListener('pause', onPause);
        video.removeEventListener('seeked', onFrameChanged);
        video.removeEventListener('loadeddata', onFrameChanged);
      }
    };
  }, [active, source, stackKey, frameIndex, frameRate]);

  if (!active) return null;
  if (error) {
    return (
      <div className="effect-canvas-error" role="status">
        Preview GPU no disponible: {error}
      </div>
    );
  }
  return <canvas ref={canvasRef} className={className ?? 'effect-canvas'} aria-label="Preview de efectos" />;
}
