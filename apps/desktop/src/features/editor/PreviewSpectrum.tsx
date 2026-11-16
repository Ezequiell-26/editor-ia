import { useEffect, useRef } from 'react';
import type { ClipEffects } from '@editor-ia/project-schema';
import { readPreviewAudioMasterScope } from '../mixer/usePreviewAudio';

/**
 * Visualizador de espectro audio-reactivo de la preview (paridad de
 * `espectro.js` de AlaukCut). Dibuja en canvas el `spectrumDb` del bus
 * master de Web Audio — la misma mezcla que suena— dentro de la ventana
 * del clip de ajuste que lo declara en `effects.spectrum`.
 *
 * Límites honestos: mide el bus Web Audio de la preview, no el archivo
 * exportado; los clips de audio que el render FFmpeg procesa pero la
 * preview no reproduce (p. ej. fuentes sin decode en vivo) no aportan
 * energía. El export usa `showfreqs` de FFmpeg sobre el bus final.
 */

const CANVAS_WIDTH = 512;
const CANVAS_HEIGHT = 160;
const DB_FLOOR = -120;
const BAR_COUNT = 96;

type SpectrumConfig = NonNullable<ClipEffects['spectrum']>;

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const clean = /^[0-9a-fA-F]{6}$/.test(value) ? value : 'FFFFFF';
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function cssColor(rgb: [number, number, number], alpha = 1): string {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

export function PreviewSpectrum({ spec }: { readonly spec: SpectrumConfig }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const specRef = useRef(spec);
  specRef.current = spec;

  useEffect(() => {
    let handle = 0;
    const tick = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      const scope = readPreviewAudioMasterScope();
      if (canvas && ctx && scope) {
        const current = specRef.current;
        const mode = current.mode ?? 'bars';
        const intensity = current.intensity ?? 1;
        const color1 = hexToRgb(current.color1 ?? (mode === 'bars' ? '#FFFFFF' : mode === 'wave' ? '#3B82F6' : '#00FFFF'));
        const color2 = hexToRgb(current.color2 ?? (mode === 'bars' ? '#9ADCFF' : mode === 'wave' ? '#8B5CF6' : '#FF00FF'));
        const db = scope.spectrumDb;
        const bins = Math.max(1, db.length);
        const levelAt = (bin: number): number => {
          const value = db[Math.min(bins - 1, Math.max(0, bin))] ?? DB_FLOOR;
          return Math.max(0, Math.min(1, (value - DB_FLOOR) / -DB_FLOOR));
        };
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = Math.max(0, Math.min(1, intensity));

        if (mode === 'bars') {
          const barWidth = canvas.width / BAR_COUNT;
          for (let bar = 0; bar < BAR_COUNT; bar += 1) {
            const binStart = Math.floor((bar / BAR_COUNT) * bins);
            const binEnd = Math.min(bins, Math.max(binStart + 1, Math.floor(((bar + 1) / BAR_COUNT) * bins)));
            let peak = Number.NEGATIVE_INFINITY;
            for (let bin = binStart; bin < binEnd; bin += 1) {
              const value = db[bin] ?? DB_FLOOR;
              if (value > peak) peak = value;
            }
            const level = Math.max(0, Math.min(1, (peak - DB_FLOOR) / -DB_FLOOR));
            const barHeight = Math.max(1, level * canvas.height);
            const [r, g, b] = lerpColor(color1, color2, level);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(bar * barWidth, canvas.height - barHeight, Math.max(1, barWidth - 1), barHeight);
          }
        } else {
          const neon = mode === 'neon';
          ctx.beginPath();
          for (let x = 0; x <= canvas.width; x += 1) {
            const bin = Math.floor((x / canvas.width) * bins);
            const level = levelAt(bin);
            const y = canvas.height - 4 - level * (canvas.height - 8);
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
          gradient.addColorStop(0, cssColor(color1));
          gradient.addColorStop(1, cssColor(color2));
          ctx.strokeStyle = gradient;
          ctx.lineWidth = neon ? 3 : 2;
          if (neon) {
            ctx.shadowColor = cssColor(color2);
            ctx.shadowBlur = 14;
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      className="preview-spectrum-canvas"
      aria-hidden="true"
    />
  );
}
