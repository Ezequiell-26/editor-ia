import { useEffect, useMemo, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { useProjectStore } from '../../state/project-store';
import type { WhiteboardRenderResult, WhiteboardStatus } from '../../services/project-service';
import { WHITEBOARD_HAND_STYLES } from './hands';
import { WhiteboardPreview } from './WhiteboardPreview';
import { demoWhiteboardStrokes, type WhiteboardDemoScene } from './whiteboard';
import './whiteboard.css';

const SCENES: readonly { id: WhiteboardDemoScene; label: string }[] = [
  { id: 'sketch', label: 'Diagrama' },
  { id: 'circle', label: 'Sol' },
];

/** Tableros predefinidos; el color queda editable con el picker. */
const BOARDS = [
  { id: 'white', label: 'Pizarra blanca', hex: '#f7f5ef' },
  { id: 'green', label: 'Pizarra verde', hex: '#1f4d3a' },
  { id: 'dark', label: 'Pizarra oscura', hex: '#17202a' },
] as const;

/** Velocidad base de la preview: fracción de la altura por segundo. */
const BASE_SPEED = 0.32;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'no se pudo generar el video whiteboard';
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * Generador "Pizarra blanca": convierte una imagen en un video MP4 donde una
 * mano dibuja los trazos detectados. La preview es procedural (escena de
 * ejemplo en SVG); el render real lo hace el backend `whiteboard_generate`
 * (pipeline Python de Inkplainer-OS) y el MP4 resultante se importa como
 * asset normal.
 */
export function WhiteboardPanel({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const service = store.service;

  const [imagePath, setImagePath] = useState<string | null>(null);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [inkHex, setInkHex] = useState('#1f2937');
  const [boardId, setBoardId] = useState<string>('white');
  const [boardHex, setBoardHex] = useState<string>(BOARDS[0].hex);
  const [speedMult, setSpeedMult] = useState(1);
  const [showHand, setShowHand] = useState(true);
  const [handStyle, setHandStyle] = useState('hand1');
  const [scene, setScene] = useState<WhiteboardDemoScene>('sketch');
  const [duration, setDuration] = useState(0);
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('medium');
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<WhiteboardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WhiteboardRenderResult | null>(null);

  useEffect(() => {
    let alive = true;
    service
      .whiteboardStatus()
      .then((status) => {
        if (alive) setEngine(status);
      })
      .catch(() => {
        if (alive) setEngine({ available: false, reason: 'no se pudo consultar el motor whiteboard' });
      });
    return () => {
      alive = false;
    };
  }, [service]);

  const aspect = 16 / 9;
  const speedUnits = BASE_SPEED * speedMult;

  const strokes = useMemo(() => demoWhiteboardStrokes(scene), [scene]);

  function pickBoard(id: string): void {
    setBoardId(id);
    const board = BOARDS.find((item) => item.id === id);
    if (board) setBoardHex(board.hex);
  }

  async function chooseImage(): Promise<void> {
    setError(null);
    try {
      const picked = await service.chooseImageFile('Elegí la imagen para la pizarra blanca');
      if (picked) setImagePath(picked);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function chooseAudio(): Promise<void> {
    setError(null);
    try {
      const picked = await service.chooseAudioFile('Elegí la narración (opcional)');
      if (picked) setAudioPath(picked);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function generate(): Promise<void> {
    if (!imagePath) {
      setError('Elegí una imagen fuente para el video whiteboard.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const rendered = await service.whiteboardGenerate({
        imagePath,
        ...(audioPath ? { audioPath } : {}),
        ...(duration > 0 ? { durationSeconds: duration } : {}),
        quality,
      });
      setResult(rendered);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card whiteboard-panel">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Generador</p>
          <h3>Pizarra blanca</h3>
        </div>
        <span className="fine-print">
          <Icon name="hand" size={13} /> Mano que dibuja · motor whiteboard-animator
        </span>
      </div>
      <p className="fine-print">
        Convierte una imagen en un video donde una mano dibuja los trazos
        detectados, como en los videos explicativos tipo whiteboard. La preview
        es una escena de ejemplo; el MP4 final lo genera el motor local
        (whiteboard-animator) y queda en la caché de la app.
      </p>
      {engine && !engine.available ? (
        <p className="notice notice-warning" role="alert">
          Motor no disponible: {engine.reason ?? 'falta Python con whiteboard-animator'}
        </p>
      ) : null}

      <div className="whiteboard-layout">
        <div className="whiteboard-preview-wrap">
          <WhiteboardPreview
            strokes={strokes}
            aspect={aspect}
            speed={speedUnits}
            inkHex={inkHex}
            boardHex={boardHex}
            showHand={showHand}
            handStyle={handStyle}
          />
          <div className="whiteboard-preview-tools">
            {SCENES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ghost fine-print${scene === item.id ? ' active' : ''}`}
                aria-pressed={scene === item.id}
                onClick={() => setScene(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="denoise-controls">
          <label className="field">
            <span>Imagen fuente</span>
            <span className="record-inline">
              <button type="button" className="ghost" onClick={() => void chooseImage()}>
                {imagePath ? 'Cambiar imagen' : 'Elegir imagen…'}
              </button>
              {imagePath ? (
                <span className="fine-print" title={imagePath}>
                  {baseName(imagePath)}
                </span>
              ) : null}
            </span>
          </label>

          <label className="field">
            <span>Tinta</span>
            <input type="color" value={inkHex} onChange={(e) => setInkHex(e.target.value)} />
          </label>

          <label className="field">
            <span>Pizarra</span>
            <span className="record-inline">
              <select value={boardId} onChange={(e) => pickBoard(e.target.value)} aria-label="Estilo de pizarra">
                {BOARDS.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.label}
                  </option>
                ))}
                <option value="custom">Personalizado</option>
              </select>
              <input
                type="color"
                value={boardHex}
                onChange={(e) => {
                  setBoardHex(e.target.value);
                  setBoardId('custom');
                }}
                aria-label="Color de pizarra"
              />
            </span>
          </label>

          <label className="field">
            <span>Velocidad ({speedMult.toFixed(2)}×)</span>
            <input
              type="range"
              min={0.2}
              max={2.5}
              step={0.05}
              value={speedMult}
              onChange={(e) => setSpeedMult(Number(e.target.value))}
            />
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={showHand}
              onChange={(e) => setShowHand(e.target.checked)}
            />
            <span>Mostrar la mano dibujando</span>
          </label>

          {showHand ? (
            <label className="field">
              <span>Mano</span>
              <select value={handStyle} onChange={(e) => setHandStyle(e.target.value)}>
                {WHITEBOARD_HAND_STYLES.map((style) => (
                  <option key={style.id} value={style.id}>
                    {style.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="field">
            <span>Duración máx. (s, 0 = auto)</span>
            <input
              type="number"
              min={0}
              max={120}
              value={duration}
              onChange={(e) => setDuration(Math.min(120, Math.max(0, Number(e.target.value) || 0)))}
            />
          </label>
          <label className="field">
            <span>Narración (opcional)</span>
            <span className="record-inline">
              <button type="button" className="ghost" onClick={() => void chooseAudio()}>
                {audioPath ? 'Cambiar audio' : 'Elegir audio…'}
              </button>
              {audioPath ? (
                <span className="fine-print" title={audioPath}>
                  {baseName(audioPath)}
                </span>
              ) : null}
            </span>
          </label>

          <label className="field">
            <span>Calidad del render</span>
            <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}>
              <option value="low">Baja (más rápido)</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
            </select>
          </label>

          <p className="fine-print">
            Los controles de estilo (tinta, pizarra, mano, velocidad) aplican a
            la preview; el video exportado usa el estilo propio del motor.
          </p>
        </div>
      </div>

      <div className="actions compact">
        <button
          type="button"
          className="primary icon-text"
          onClick={() => void generate()}
          disabled={busy || engine?.available === false || !imagePath}
        >
          <Icon name="play" size={14} />
          {busy ? 'Generando…' : 'Generar video whiteboard'}
        </button>
        {result ? (
          <button
            type="button"
            className="ghost"
            onClick={() => void service.revealOutput(result.videoPath)}
          >
            Abrir carpeta
          </button>
        ) : null}
      </div>

      {result ? (
        <p className="fine-print">
          Listo: {baseName(result.videoPath)} · {result.durationSeconds.toFixed(1)} s ·{' '}
          {result.width}×{result.height} · {result.fps.toFixed(0)} fps ·{' '}
          {(result.processingTimeMs / 1000).toFixed(1)} s de proceso
        </p>
      ) : null}
      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className="ghost fine-print" onClick={() => onNavigate('learn')}>
        Ver tutorial
      </button>
    </div>
  );
}
