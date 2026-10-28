import { useEffect, useRef, useState } from 'react';
import type { LottieDocument } from './lottie';

/**
 * Preview real con el mismo motor que usa la conversión. El damero del fondo
 * muestra el alfa: lo que se ve detrás de la animación es transparencia, no un
 * color inventado.
 */
export function LottiePreview({ document: doc }: { readonly document: LottieDocument }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let destroy: (() => void) | null = null;
    setError(null);
    void (async () => {
      try {
        const module = await import('lottie-web');
        if (disposed || !host.current) return;
        const animation = module.default.loadAnimation({
          container: host.current,
          renderer: 'canvas',
          loop: true,
          autoplay: true,
          animationData: doc.raw,
          rendererSettings: { clearCanvas: true, preserveAspectRatio: 'xMidYMid meet' },
        });
        animation.addEventListener('data_failed', () => {
          setError('El motor Lottie no pudo interpretar la animación.');
        });
        destroy = () => animation.destroy();
      } catch (cause) {
        if (!disposed) {
          setError(
            cause instanceof Error
              ? `La preview no está disponible en este entorno: ${cause.message}`
              : 'La preview no está disponible en este entorno.',
          );
        }
      }
    })();
    return () => {
      disposed = true;
      destroy?.();
    };
  }, [doc]);

  return (
    <div
      className="lottie-preview"
      aria-label="Previsualización Lottie"
      style={{ aspectRatio: `${doc.width} / ${doc.height}` }}
    >
      <div ref={host} className="lottie-preview-canvas" />
      {error ? (
        <p className="lottie-preview-error" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
