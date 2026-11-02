import { useEffect, useRef, useState } from 'react';
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
 * El canvas corre en su propio `requestAnimationFrame`: el video puede estar
 * reproduciéndose mientras el usuario arrastra un slider, y el preview tiene
 * que seguir el frame real, no el estado de React.
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
  const stackRef = useRef(stack);
  stackRef.current = stack;

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
    if (!WEBGL_AVAILABLE || !active) return;
    let handle = 0;
    let lastTime = 0;

    const draw = (timestamp: number) => {
      handle = requestAnimationFrame(draw);
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
        cancelAnimationFrame(handle);
      }
    };

    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [active, source, frameIndex, frameRate]);

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
