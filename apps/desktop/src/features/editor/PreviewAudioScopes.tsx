import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useProjectPlaying } from '../../state/project-store';
import {
  isPreviewAudioSupported,
  readPreviewAudioMasterScope,
  type MasterAudioScope,
} from '../mixer/usePreviewAudio';

/**
 * Scopes de audio en vivo del monitor de la preview (port del audioscope del
 * monitor de Kdenlive): oscilograma arriba y espectro abajo, leídos del
 * AnalyserNode del bus master del grafo Web Audio — es decir, la mezcla real
 * que suena en la preview (pistas, EQ, fader, paneo y ganancia master).
 *
 * Límites honestos: mide el bus Web Audio, no el archivo exportado. Los
 * efectos por clip (`audioStack`) y los filtros que sólo existen en el
 * render FFmpeg no aparecen acá; el pie del panel lo declara.
 */

const SCOPE_WIDTH = 560;
const SCOPE_HEIGHT = 180;
const WAVEFORM_FRACTION = 0.34;
const DB_FLOOR = -120;
const SIGNAL_THRESHOLD = 0.001;

function scopeHasSignal(scope: MasterAudioScope): boolean {
  for (let index = 0; index < scope.waveform.length; index += 1) {
    if (Math.abs(scope.waveform[index] ?? 0) > SIGNAL_THRESHOLD) return true;
  }
  return false;
}

function drawMasterScope(
  ctx: CanvasRenderingContext2D,
  scope: MasterAudioScope,
  width: number,
  height: number,
): void {
  ctx.fillStyle = '#070b10';
  ctx.fillRect(0, 0, width, height);

  // OSILOGRAMA (tercio superior): min/max por columna sobre las muestras.
  const waveH = Math.round(height * WAVEFORM_FRACTION);
  const samples = scope.waveform;
  const columns = Math.min(width, samples.length);
  const step = samples.length / Math.max(1, columns);
  const mid = waveH / 2;
  ctx.fillStyle = 'rgba(88, 196, 220, 0.9)';
  for (let column = 0; column < columns; column += 1) {
    const start = Math.floor(column * step);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((column + 1) * step)));
    let min = 1;
    let max = -1;
    for (let index = start; index < end; index += 1) {
      const value = samples[index] ?? 0;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const y1 = mid - max * mid;
    const y2 = mid - min * mid;
    ctx.fillRect(column, y1, 1, Math.max(1, y2 - y1));
  }

  // Línea divisoria entre oscilograma y espectro.
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, waveH + 4.5);
  ctx.lineTo(width, waveH + 4.5);
  ctx.stroke();

  // ESPECTRO (resto): pico por columna en dBFS, eje lineal en frecuencia.
  const specTop = waveH + 9;
  const specH = height - specTop;
  const bins = scope.spectrumDb.length || 1;
  for (let x = 0; x < width; x += 1) {
    const binStart = Math.floor((x / width) * bins);
    const binEnd = Math.min(bins, Math.max(binStart + 1, Math.floor(((x + 1) / width) * bins)));
    let peak = Number.NEGATIVE_INFINITY;
    for (let bin = binStart; bin < binEnd; bin += 1) {
      const db = scope.spectrumDb[bin] ?? DB_FLOOR;
      if (db > peak) peak = db;
    }
    const level = Math.max(0, Math.min(1, (peak - DB_FLOOR) / -DB_FLOOR));
    const barHeight = level * specH;
    ctx.fillStyle = `rgba(158, 206, 106, ${(0.3 + 0.7 * level).toFixed(3)})`;
    ctx.fillRect(x, specTop + specH - barHeight, 1, Math.max(1, barHeight));
  }
}

export function PreviewAudioScopes({ onClose }: { readonly onClose: () => void }) {
  const playing = useProjectPlaying();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [signal, setSignal] = useState(false);
  const signalRef = useRef(false);
  const supported = isPreviewAudioSupported();

  // El muestreo corre mientras el panel está abierto: el analizador conserva
  // el último bloque renderizado, así que en pausa la imagen queda quieta.
  useEffect(() => {
    let handle = 0;
    const tick = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      const scope = readPreviewAudioMasterScope();
      if (canvas && ctx && scope) {
        drawMasterScope(ctx, scope, canvas.width, canvas.height);
        const next = scopeHasSignal(scope);
        if (next !== signalRef.current) {
          signalRef.current = next;
          setSignal(next);
        }
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, []);

  // Fondo inicial aunque todavía no haya grafo ni señal.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.fillStyle = '#070b10';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  return (
    <section className="scopes-panel scopes-panel--audio" aria-label="Scopes de audio del monitor">
      <header className="scopes-head">
        <span className="scopes-title">
          <Icon name="volume" size={11} />
          Scopes de audio
        </span>
        <button
          type="button"
          className="scopes-close"
          aria-label="Cerrar scopes de audio"
          title="Cerrar scopes de audio"
          onClick={onClose}
        >
          <Icon name="close" size={10} />
        </button>
      </header>
      <canvas
        ref={canvasRef}
        width={SCOPE_WIDTH}
        height={SCOPE_HEIGHT}
        role="img"
        aria-label="Oscilograma y espectro del audio mezclado de la preview"
      />
      <footer className="scopes-foot">
        <span className={signal ? 'scopes-signal' : 'scopes-signal off'}>
          {signal ? 'Señal en vivo' : playing ? 'Sin señal' : 'En pausa'}
        </span>
        <span title="Mide el bus master de Web Audio de la preview: pistas, EQ, fader, paneo y ganancia master. Los efectos por clip y el render de exportación no pasan por este bus.">
          Bus master
        </span>
      </footer>
      {!supported ? (
        <p className="scopes-note">
          Este entorno no expone Web Audio: los scopes quedan en reposo y la preview usa el volumen
          del elemento.
        </p>
      ) : null}
    </section>
  );
}
