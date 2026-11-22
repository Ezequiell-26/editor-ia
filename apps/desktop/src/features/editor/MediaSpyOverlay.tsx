import { useEffect, useRef, useState } from 'react';
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
 *
 * Con `pinned` (clic en la tarjeta) el overlay se vuelve interactivo:
 * controles nativos de <video> (play/pausa/seek/volumen) y autoplay
 * silencioso. Escape o el clic de nuevo sueltan el pin.
 */
export function MediaSpyOverlay() {
  const spy = useMediaSpy();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const coalescerRef = useRef<ReturnType<typeof createRafCoalescer<number>> | null>(null);
  const [liveTime, setLiveTime] = useState<number | null>(null);

  const interactive = Boolean(spy?.pinned && spy.kind === 'video');

  // Alta/baja del <video>: sólo cuando cambia el medio espiado.
  useEffect(() => {
    const video = videoRef.current;
    setLiveTime(null);
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

  // Pin activado: reproduce el medio (muteado, autoplay permitido).
  useEffect(() => {
    const video = videoRef.current;
    if (!interactive || !video) return;
    if (video.paused) void video.play().catch(() => {});
  }, [interactive, spy?.assetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al soltar el pin el <video> queda en pausa: si siguiera corriendo, el
  // hover-scrub pelearía con currentTime avanzando solo.
  useEffect(() => {
    const video = videoRef.current;
    if (video && !interactive && !video.paused) video.pause();
  }, [interactive]);

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

  const shownTime = spy.pinned && liveTime !== null ? liveTime : spy.timeSeconds;

  return (
    <div
      className={`media-spy${interactive ? ' media-spy-interactive' : ''}`}
      aria-hidden={!interactive}
    >
      {spy.kind === 'image' ? (
        <img className="media-spy-media" src={spy.url} alt="" draggable={false} />
      ) : (
        <video
          ref={videoRef}
          className="media-spy-media"
          muted
          playsInline
          preload="auto"
          controls={interactive}
          onTimeUpdate={(event) => {
            if (interactive) setLiveTime(event.currentTarget.currentTime);
          }}
        />
      )}
      <span className="media-spy-time">{mmss(shownTime)}</span>
      {spy.pinned ? (
        <span className="media-spy-pin" title="Preview fijada — clic en la tarjeta o Escape para soltar">
          fijado
        </span>
      ) : null}
    </div>
  );
}
