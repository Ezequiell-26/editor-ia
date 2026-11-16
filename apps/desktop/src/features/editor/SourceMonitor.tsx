import { useEffect, useRef, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { AudioPeaks } from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import { addClipFromAsset, fpsOf } from '../../state/project-actions';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

/**
 * Monitor de origen (paridad acotada de `previa_midia.js` de AlaukCut):
 * al seleccionar un asset de video/audio el Inspector muestra transporte
 * propio — play/pausa, scrub, marcas IN/OUT y montaje del segmento en el
 * playhead. No es un segundo monitor flotante: vive en el panel Detalles,
 * que es donde Olyvia muestra la selección de asset.
 */
export function SourceMonitor({ asset }: { readonly asset: Asset }) {
  const store = useProjectStore();
  const project = store.state.project;
  const root = store.state.opened?.root ?? '';
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const peaksRef = useRef<HTMLCanvasElement | null>(null);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [inSec, setInSec] = useState<number | null>(null);
  const [outSec, setOutSec] = useState<number | null>(null);
  const [peaks, setPeaks] = useState<AudioPeaks | null>(null);
  // Modos de onda (paridad del menú de `onda` de AlaukCut): barras
  // min/max, línea de envolvente o área rellena.
  const [waveMode, setWaveMode] = useState<'bars' | 'line' | 'area'>('bars');

  const isVideo = asset.kind === 'video';
  const isAudio = asset.kind === 'audio';
  const supported = isVideo || isAudio;

  const proxy = 'proxy' in asset ? asset.proxy : undefined;
  const url = supported ? store.service.mediaUrl(root, proxy?.path ?? asset.source.path) : '';

  // Picos de audio para la forma de onda (mismo servicio que usa el
  // análisis de beats). Si el asset no tiene pista de audio el comando
  // rechaza y simplemente no se dibuja nada.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    store.service
      .audioPeaks(asset.id, 240)
      .then((data) => {
        if (!cancelled) setPeaks(data);
      })
      .catch(() => {
        if (!cancelled) setPeaks(null);
      });
    return () => {
      cancelled = true;
    };
  }, [store.service, asset.id, supported]);

  useEffect(() => {
    const canvas = peaksRef.current;
    if (!canvas || !peaks || peaks.peaks.length === 0) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'currentColor';
    ctx.strokeStyle = 'currentColor';
    const step = width / peaks.peaks.length;
    const mid = height / 2;
    if (waveMode === 'line' || waveMode === 'area') {
      // Envoltente: superior = max, inferior = min, unida por líneas.
      const top: [number, number][] = [];
      const bottom: [number, number][] = [];
      peaks.peaks.forEach((peak, index) => {
        const x = index * step + step / 2;
        top.push([x, (1 - peak.max) * height]);
        bottom.push([x, (1 - peak.min) * height]);
      });
      ctx.lineWidth = 1;
      ctx.beginPath();
      top.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      for (let index = bottom.length - 1; index >= 0; index -= 1) {
        ctx.lineTo(bottom[index]![0], bottom[index]![1]);
      }
      ctx.closePath();
      if (waveMode === 'area') {
        ctx.globalAlpha = 0.35;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.stroke();
    } else {
      peaks.peaks.forEach((peak, index) => {
        const x = index * step;
        const barHeight = Math.max(1, (peak.max - peak.min) * height);
        ctx.fillRect(x, mid - barHeight / 2, Math.max(1, step - 1), barHeight);
      });
    }
  }, [peaks, waveMode]);

  // Al cambiar de asset se reinicia el transporte y las marcas.
  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setInSec(null);
    setOutSec(null);
    return () => {
      mediaRef.current?.pause();
    };
  }, [asset.id]);

  if (!supported || !project) return null;

  const fps = fpsOf(project);
  const mediaDurationFrames =
    'media' in asset && asset.media && 'durationFrames' in asset.media
      ? asset.media.durationFrames
      : undefined;
  const knownDuration =
    duration > 0 ? duration : mediaDurationFrames ? mediaDurationFrames / fps : 0;

  function togglePlay(): void {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) {
      // jsdom no implementa play(): puede devolver undefined en tests.
      const pending = el.play() as unknown;
      if (pending && typeof (pending as Promise<void>).catch === 'function') {
        void (pending as Promise<void>).catch(() => setPlaying(false));
      }
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }

  function seek(seconds: number): void {
    const el = mediaRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(knownDuration || seconds, seconds));
    el.currentTime = clamped;
    setCurrent(clamped);
  }

  function markIn(): void {
    setInSec(current);
    if (outSec !== null && outSec <= current) setOutSec(null);
  }

  function markOut(): void {
    setOutSec(current);
    if (inSec !== null && inSec >= current) setInSec(null);
  }

  function mountSegment(): void {
    const inFrame = inSec !== null ? Math.max(0, Math.round(inSec * fps)) : 0;
    const outFrame = outSec !== null ? Math.max(inFrame + 1, Math.round(outSec * fps)) : undefined;
    const options: {
      atFrame: number;
      inFrame?: number;
      outFrame?: number;
    } = { atFrame: store.getPlayhead() };
    if (inFrame > 0 || outFrame !== undefined) {
      options.inFrame = inFrame;
      if (outFrame !== undefined) options.outFrame = outFrame;
    }
    const result = store.mutate((current) =>
      addClipFromAsset(current, asset, options),
    );
    if (result) {
      store.setSelection({ kind: 'clip', id: result.clipId });
      const labelled = inSec !== null || outSec !== null;
      store.setNotice(
        labelled
          ? `${asset.label}: segmento ${formatTime(inSec ?? 0)}–${formatTime(outSec ?? knownDuration)} montado.`
          : `${asset.label} montado en la timeline.`,
      );
    }
  }

  const mediaProps = {
    ref: (element: HTMLVideoElement | HTMLAudioElement | null) => {
      mediaRef.current = element;
    },
    src: url,
    preload: 'metadata' as const,
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      const el = event.currentTarget;
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    },
    onTimeUpdate: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      const el = event.currentTarget;
      setCurrent(el.currentTime);
      // Como AlaukCut: la reproducción se detiene en la marca OUT.
      if (outSec !== null && el.currentTime >= outSec) {
        el.pause();
        setPlaying(false);
      }
    },
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
  };

  const inPct = knownDuration > 0 && inSec !== null ? (inSec / knownDuration) * 100 : null;
  const outPct = knownDuration > 0 && outSec !== null ? (outSec / knownDuration) * 100 : null;

  return (
    <div className="source-monitor">
      {isVideo ? (
        <video {...mediaProps} className="source-monitor-media" playsInline />
      ) : (
        <audio {...mediaProps} className="source-monitor-media" />
      )}
      {peaks ? (
        <div className="source-monitor-wave-row">
          <canvas ref={peaksRef} className="source-monitor-wave" width={220} height={36} />
          <select
            className="source-monitor-wave-mode"
            value={waveMode}
            aria-label="Modo de forma de onda"
            title="Modo de forma de onda"
            onChange={(event) => setWaveMode(event.target.value as typeof waveMode)}
          >
            <option value="bars">Barras</option>
            <option value="line">Línea</option>
            <option value="area">Área</option>
          </select>
        </div>
      ) : null}
      <div className="source-monitor-bar">
        {inPct !== null && outPct !== null ? (
          <div
            className="source-monitor-range"
            style={{
              left: `${Math.min(inPct, outPct)}%`,
              width: `${Math.abs(outPct - inPct)}%`,
            }}
          />
        ) : null}
        <input
          type="range"
          min={0}
          max={knownDuration || 1}
          step={0.01}
          value={Math.min(current, knownDuration || current)}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Posición del material"
        />
      </div>
      <div className="source-monitor-controls">
        <button type="button" className="small" onClick={togglePlay} aria-label={playing ? 'Pausar fuente' : 'Reproducir fuente'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="source-monitor-time">
          {formatTime(current)} / {formatTime(knownDuration)}
        </span>
        <button type="button" className="small" onClick={markIn} title="Marca de entrada en el tiempo actual">
          IN
        </button>
        <button type="button" className="small" onClick={markOut} title="Marca de salida en el tiempo actual">
          OUT
        </button>
        {(inSec !== null || outSec !== null) ? (
          <button
            type="button"
            className="small ghost"
            onClick={() => {
              setInSec(null);
              setOutSec(null);
            }}
          >
            Limpiar
          </button>
        ) : null}
      </div>
      {(inSec !== null || outSec !== null) ? (
        <p className="fine-print">
          Segmento: {formatTime(inSec ?? 0)} → {formatTime(outSec ?? knownDuration)}
        </p>
      ) : null}
      <div className="actions compact">
        <button type="button" className="small" onClick={mountSegment}>
          {inSec !== null || outSec !== null ? 'Montar segmento' : 'Montar en playhead'}
        </button>
      </div>
    </div>
  );
}
