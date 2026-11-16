import { useEffect, useRef, useState } from 'react';
import type { Clip } from '@editor-ia/project-schema';
import { clipSourceFrameAtLocal } from '../../../state/clip-source-time';

interface MonitorVideoProps {
  readonly clip: Clip;
  readonly url: string;
  readonly fps: number;
  /** Frame del playhead en la timeline del proyecto. */
  readonly frame: number;
  readonly playing: boolean;
  /** Velocidad del transporte (shuttle): se multiplica por la del clip. */
  readonly rate: number;
}

/**
 * UI-001/UI-002: preview EN VIVO del clip bajo el playhead. Muestra el
 * video fuente reproduciéndose (silenciado — el audio lo aporta el grafo
 * de Preview del workspace) en vez del frame estático compuesto. El
 * `currentTime` se resincroniza por deriva igual que hace Preview; el
 * padre sólo lo monta para clips planos (sin reverse/speed/curva), así
 * que el mapeo es lineal.
 */
export function MonitorVideo({ clip, url, fps, frame, playing, rate }: MonitorVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Asset movido/borrado o codec no soportado: el <video> queda negro —
  // mejor desmontarlo y dejar ver el frame compuesto que ya está abajo.
  const [failed, setFailed] = useState(false);
  const clipSpeed =
    'speed' in clip && clip.speed
      ? clip.speed.num / Math.max(1, clip.speed.den)
      : 1;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sourceFrame = clipSourceFrameAtLocal(clip, frame - clip.startFrame);
    if (sourceFrame === null) return;
    const target = Math.max(0, sourceFrame) / fps;
    if (Math.abs(video.currentTime - target) > 0.35) {
      video.currentTime = target;
    }
  }, [clip, frame, fps]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // La fuente avanza a clipSpeed×rate por segundo de timeline; el
    // playbackRate del <video> hace que la deriva quede acotada y la
    // corrección por deriva sólo ajuste el desfase residual.
    video.playbackRate = Math.min(16, Math.max(0.0625, clipSpeed * rate));
    if (playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing, url, clipSpeed, rate]);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (failed) return null;

  return (
    <video
      ref={videoRef}
      className="me-monitor-media me-monitor-video"
      src={url}
      muted
      playsInline
      preload="auto"
      onError={() => setFailed(true)}
    />
  );
}
