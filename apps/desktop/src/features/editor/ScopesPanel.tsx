import { useEffect, useRef, useState, type RefObject } from 'react';
import { Icon } from '../../components/Icon';
import type { ScopeFrameResult } from '../../services/project-service';
import {
  VECTOR_SIZE,
  WAVEFORM_COLUMNS,
  WAVEFORM_LEVELS,
  computeScopes,
  PARADE_COLUMNS,
  PARADE_LEVELS,
  maxScopeCount,
  type ScopeData,
} from './scopes';

type ScopeView = 'waveform' | 'vectorscope' | 'histogram' | 'parade';

const VIEWS: readonly { readonly id: ScopeView; readonly label: string; readonly aria: string }[] = [
  { id: 'waveform', label: 'Onda', aria: 'Onda de luminancia' },
  { id: 'vectorscope', label: 'Vectores', aria: 'Vectorscopio de croma' },
  { id: 'histogram', label: 'Hist.', aria: 'Histograma RGB' },
  { id: 'parade', label: 'Parade', aria: 'Parade RGB' },
];

const SCOPE_WIDTH = 236;
const SCOPE_HEIGHT = 108;
const SAMPLE_WIDTH = 160;
const SAMPLE_HEIGHT = 90;

function resampleGrid(
  grid: { readonly columns: number; readonly rows: number; readonly data: readonly number[] },
  columns: number,
  rows: number,
  flipY = false,
): Uint32Array {
  const out = new Uint32Array(columns * rows);
  for (let y = 0; y < grid.rows; y += 1) {
    for (let x = 0; x < grid.columns; x += 1) {
      const count = grid.data[y * grid.columns + x] ?? 0;
      if (count === 0) continue;
      const ox = Math.min(columns - 1, Math.floor((x / Math.max(1, grid.columns)) * columns));
      const oy = Math.min(rows - 1, Math.floor((y / Math.max(1, grid.rows)) * rows));
      const targetY = flipY ? rows - 1 - oy : oy;
      const target = targetY * columns + ox;
      out[target] = (out[target] ?? 0) + count;
    }
  }
  return out;
}

function histogram256(values: readonly number[]): Uint32Array {
  const out = new Uint32Array(256);
  for (let index = 0; index < Math.min(256, values.length); index += 1) {
    out[index] = values[index] ?? 0;
  }
  return out;
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.lineWidth = 1;
  for (let row = 0; row <= 4; row += 1) {
    const y = Math.round((row / 4) * height) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let column = 1; column < 6; column += 1) {
    const x = Math.round((column / 6) * width) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  data: ScopeData | null,
  width: number,
  height: number,
): void {
  drawGrid(ctx, width, height);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
  ctx.font = '7px ui-monospace, monospace';
  ctx.fillText('100', 3, 8);
  ctx.fillText('0', 3, height - 3);
  if (!data || data.sampleCount === 0) return;
  const max = maxScopeCount(data.waveform);
  if (max === 0) return;
  const cellWidth = width / WAVEFORM_COLUMNS;
  const cellHeight = height / WAVEFORM_LEVELS;
  for (let index = 0; index < data.waveform.length; index += 1) {
    const count = data.waveform[index] ?? 0;
    if (count === 0) continue;
    const column = index % WAVEFORM_COLUMNS;
    const level = Math.floor(index / WAVEFORM_COLUMNS);
    const alpha = Math.min(0.95, 0.1 + 0.85 * Math.pow(count / max, 0.4));
    ctx.fillStyle = `rgba(94, 234, 212, ${alpha.toFixed(3)})`;
    ctx.fillRect(
      column * cellWidth,
      height - (level + 1) * cellHeight,
      Math.max(1, cellWidth),
      Math.max(1, cellHeight),
    );
  }
}

function drawVectorscope(
  ctx: CanvasRenderingContext2D,
  data: ScopeData | null,
  width: number,
  height: number,
): void {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.42;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(centerX, 4);
  ctx.lineTo(centerX, height - 4);
  ctx.moveTo(4, centerY);
  ctx.lineTo(width - 4, centerY);
  ctx.stroke();
  if (!data || data.sampleCount === 0) return;
  const max = maxScopeCount(data.vectorscope);
  if (max === 0) return;
  const cellWidth = width / VECTOR_SIZE;
  const cellHeight = height / VECTOR_SIZE;
  for (let index = 0; index < data.vectorscope.length; index += 1) {
    const count = data.vectorscope[index] ?? 0;
    if (count === 0) continue;
    const ux = index % VECTOR_SIZE;
    const vy = Math.floor(index / VECTOR_SIZE);
    const x = (ux + 0.5) * cellWidth;
    const y = height - (vy + 0.5) * cellHeight;
    const angle = (Math.atan2(centerY - y, x - centerX) * 180) / Math.PI;
    const alpha = Math.min(0.95, 0.2 + 0.8 * Math.pow(count / max, 0.45));
    ctx.fillStyle = `hsla(${angle.toFixed(0)}, 80%, 66%, ${alpha.toFixed(3)})`;
    ctx.fillRect(x - 1, y - 1, 2.4, 2.4);
  }
  ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
  ctx.fillRect(centerX - 1, centerY - 1, 2, 2);
}

/**
 * Parade RGB: tres waveforms apilados, uno por canal, cada uno en su tercio
 * del ancho. Es el scope que usa DaVinci para ver balance de canales.
 */
function drawParade(
  ctx: CanvasRenderingContext2D,
  data: ScopeData | null,
  width: number,
  height: number,
): void {
  drawGrid(ctx, width, height);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
  ctx.font = '7px ui-monospace, monospace';
  ctx.fillText('100', 3, 8);
  ctx.fillText('0', 3, height - 3);
  const third = width / 3;
  const channels = [
    { color: 'rgba(248, 113, 113,', tint: 'R' },
    { color: 'rgba(74, 222, 128,', tint: 'G' },
    { color: 'rgba(96, 165, 250,', tint: 'B' },
  ];
  channels.forEach((channel, index) => {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.beginPath();
    ctx.moveTo(index * third, 0);
    ctx.lineTo(index * third, height);
    ctx.stroke();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.fillText(channel.tint, index * third + 4, height - 4);
  });
  if (!data || data.sampleCount === 0) return;
  const max = maxScopeCount(data.parade);
  if (max === 0) return;
  const cellWidth = width / PARADE_COLUMNS;
  const cellHeight = height / PARADE_LEVELS;
  for (let index = 0; index < data.parade.length; index += 1) {
    const count = data.parade[index] ?? 0;
    if (count === 0) continue;
    const column = index % PARADE_COLUMNS;
    const level = Math.floor(index / PARADE_COLUMNS);
    const alpha = Math.min(0.95, 0.1 + 0.85 * Math.pow(count / max, 0.4));
    const channel = Math.min(2, Math.floor(column / Math.floor(PARADE_COLUMNS / 3)));
    ctx.fillStyle = `${channels[channel]?.color ?? 'rgba(226, 232, 240,'} ${alpha.toFixed(3)})`;
    ctx.fillRect(
      column * cellWidth,
      height - (level + 1) * cellHeight,
      Math.max(1, cellWidth),
      Math.max(1, cellHeight),
    );
  }
}

function drawHistogram(
  ctx: CanvasRenderingContext2D,
  data: ScopeData | null,
  width: number,
  height: number,
): void {
  drawGrid(ctx, width, height);
  if (!data || data.sampleCount === 0) return;
  const max = Math.max(
    maxScopeCount(data.red),
    maxScopeCount(data.green),
    maxScopeCount(data.blue),
  );
  if (max === 0) return;
  const channels: readonly [Uint32Array, string][] = [
    [data.red, 'rgba(248, 113, 113, 0.9)'],
    [data.green, 'rgba(74, 222, 128, 0.9)'],
    [data.blue, 'rgba(96, 165, 250, 0.9)'],
  ];
  for (const [values, color] of channels) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let index = 0; index < values.length; index += 1) {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((values[index] ?? 0) / max) * (height - 6);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
}

export function ScopesPanel({
  stageRef,
  realFramePath,
  analyzeScopes,
  onClose,
}: {
  readonly stageRef: RefObject<HTMLDivElement | null>;
  readonly realFramePath?: string | null;
  readonly analyzeScopes?: (path: string) => Promise<ScopeFrameResult>;
  readonly onClose: () => void;
}) {
  const [view, setView] = useState<ScopeView>('waveform');
  const [data, setData] = useState<ScopeData | null>(null);
  const [signal, setSignal] = useState(false);
  const [filmcraft, setFilmcraft] = useState(false);
  const [filmcraftBusy, setFilmcraftBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setFilmcraft(false);
  }, [realFramePath]);

  async function loadFilmcraft(): Promise<void> {
    if (!realFramePath || !analyzeScopes || filmcraftBusy) return;
    setFilmcraftBusy(true);
    try {
      const result = await analyzeScopes(realFramePath);
      setData({
        width: result.width,
        height: result.height,
        sampleCount: result.samples,
        luma: histogram256(result.histogramY),
        red: histogram256(result.histogram[0]),
        green: histogram256(result.histogram[1]),
        blue: histogram256(result.histogram[2]),
        waveform: resampleGrid(result.waveform, WAVEFORM_COLUMNS, WAVEFORM_LEVELS),
        vectorscope: resampleGrid(result.vectorscope, VECTOR_SIZE, VECTOR_SIZE, true),
        parade: new Uint32Array(PARADE_COLUMNS * PARADE_LEVELS),
      });
      setFilmcraft(true);
      setSignal(true);
    } catch {
      setFilmcraft(false);
    } finally {
      setFilmcraftBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let handle = 0;
    let last = 0;
    const tick = (now: number): void => {
      if (cancelled) return;
      if (filmcraft) {
        handle = requestAnimationFrame(tick);
        return;
      }
      if (now - last >= 180) {
        last = now;
        const stage = stageRef.current;
        const media = stage?.querySelectorAll<HTMLVideoElement | HTMLImageElement>(
          '.preview-media',
        );
        const source = media && media.length > 0 ? (media[media.length - 1] ?? null) : null;
        const ready =
          source !== null &&
          (source.tagName === 'IMG'
            ? (source as HTMLImageElement).complete &&
              (source as HTMLImageElement).naturalWidth > 0
            : (source as HTMLVideoElement).readyState >= 2 &&
              (source as HTMLVideoElement).videoWidth > 0);
        if (!ready || !source) {
          setSignal(false);
        } else {
          const offscreen = offscreenRef.current ?? document.createElement('canvas');
          offscreenRef.current = offscreen;
          offscreen.width = SAMPLE_WIDTH;
          offscreen.height = SAMPLE_HEIGHT;
          const context = offscreen.getContext('2d', { willReadFrequently: true });
          if (context) {
            const sourceFilter = getComputedStyle(source).filter;
            const look = stage?.querySelector('.preview-look');
            const lookFilter = look ? getComputedStyle(look).filter : 'none';
            const filter = [sourceFilter, lookFilter]
              .filter((value) => value && value !== 'none')
              .join(' ');
            try {
              context.clearRect(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
              context.filter = filter || 'none';
              context.drawImage(source, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
              const frame = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
              const next = computeScopes(frame.data, SAMPLE_WIDTH, SAMPLE_HEIGHT);
              if (next.sampleCount > 0) {
                setData(next);
                setSignal(true);
              } else {
                setSignal(false);
              }
            } catch {
              setSignal(false);
            }
          }
        }
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(handle);
    };
  }, [stageRef, filmcraft]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, SCOPE_WIDTH, SCOPE_HEIGHT);
    context.fillStyle = '#070b10';
    context.fillRect(0, 0, SCOPE_WIDTH, SCOPE_HEIGHT);
    if (view === 'waveform') {
      drawWaveform(context, data, SCOPE_WIDTH, SCOPE_HEIGHT);
    } else if (view === 'vectorscope') {
      drawVectorscope(context, data, SCOPE_WIDTH, SCOPE_HEIGHT);
    } else if (view === 'parade') {
      drawParade(context, data, SCOPE_WIDTH, SCOPE_HEIGHT);
    } else {
      drawHistogram(context, data, SCOPE_WIDTH, SCOPE_HEIGHT);
    }
  }, [data, view]);

  const current = VIEWS.find((entry) => entry.id === view) ?? VIEWS[0];

  return (
    <section className="scopes-panel" aria-label="Scopes de color">
      <header className="scopes-head">
        <span className="scopes-title">
          <Icon name="palette" size={11} />
          Scopes
        </span>
        <button
          type="button"
          className={`scopes-source${filmcraft ? ' active' : ''}`}
          disabled={!realFramePath || !analyzeScopes || filmcraftBusy}
          onClick={() => void loadFilmcraft()}
          title={realFramePath ? 'Scopes calculados por FilmCraft sobre el Frame real' : 'Generá primero un Frame real'}
        >
          {filmcraftBusy ? 'FFmpeg…' : 'FilmCraft'}
        </button>
        <div className="scopes-tabs">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={view === entry.id}
              aria-label={entry.aria}
              onClick={() => setView(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="scopes-close"
          aria-label="Cerrar scopes"
          title="Cerrar scopes"
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
        aria-label={current?.aria ?? 'Scopes de color'}
      />
      <footer className="scopes-foot">
        <span className={signal ? 'scopes-signal' : 'scopes-signal off'}>
          {signal ? 'Señal en vivo' : 'Sin señal'}
        </span>
        <span
          title="Muestrea el clip visual activo con el grade CSS de la preview; no incluye LUT, títulos ni recortes."
        >
          Clip activo
        </span>
      </footer>
    </section>
  );
}
