import { useEffect, useRef } from 'react';
import { hideMediaSpy, useMediaSpy } from '../../state/media-spy';
import { createRafCoalescer } from './timeline-raf';

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/**
 * Espía de medios sobre el monitor (paridad `espiada_midia.js`): mientras
 * el puntero recorre la tarjeta de un medio en la biblioteca, muestra el
 * frame del instante bajo el cursor con su timecode.
 *
 * Un solo <video> por medio visible: `currentTime` se actualiza
 * coalescido por frame (el puntero puede emitir 100+ eventos/segundo).
 */
export function MediaSpyOverlay() {
  const spy = useMediaSpy();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const coalescerRef = useRef<ReturnType<typeof createRafCoalescer<number>> | null>(null);

  // Alta/baja del <video>: sólo cuando cambia el medio espiado.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !spy || spy.kind !== 'video') return;
    video.src = spy.url;
    video.muted = true;
    video.preload = 'auto';
    video.load();
  }, [spy?.assetId, spy?.url, spy?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seek coalescido por frame hacia el instante bajo el cursor.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !spy || spy.kind !== 'video') return;
    if (!coalescerRef.current) {
      coalescerRef.current = createRafCoalescer<number>((t) => {
        const v = videoRef.current;
        if (v && Number.isFinite(t)) v.currentTime = t;
      });
    }
    coalescerRef.current.push(spy.timeSeconds);
    return () => coalescerRef.current?.flush();
  }, [spy?.timeSeconds, spy?.assetId, spy?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      coalescerRef.current?.cancel();
      coalescerRef.current = null;
    },
    [],
  );

  // Escape suelta el pin (source monitor mínimo).
  useEffect(() => {
    if (!spy?.pinned) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hideMediaSpy();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spy?.pinned]);

  if (!spy) return null;

  return (
    <div className="media-spy" aria-hidden="true">
      {spy.kind === 'image' ? (
        <img className="media-spy-media" src={spy.url} alt="" draggable={false} />
      ) : (
        <video
          ref={videoRef}
          className="media-spy-media"
          muted
          playsInline
          preload="auto"
        />
      )}
      <span className="media-spy-time">{mmss(spy.timeSeconds)}</span>
      {spy.pinned ? (
        <span className="media-spy-pin" title="Preview fijada — clic en la tarjeta o Escape para soltar">
          fijado
        </span>
      ) : null}
    </div>
  );
}
