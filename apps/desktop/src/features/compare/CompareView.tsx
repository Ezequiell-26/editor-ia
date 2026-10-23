import { useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import { useProjectStore } from '../../state/project-store';
import { takePendingComparison } from './pending';
import {
  clampPosition,
  modeLabel,
  type BeforeAfterMode,
} from './before-after';
import { BeforeAfterSlider } from './BeforeAfterSlider';

type Slot = 'before' | 'after';

interface ImageSlot {
  readonly path: string | null;
  readonly url: string;
  readonly failed: boolean;
}

const EMPTY_SLOT: ImageSlot = { path: null, url: '', failed: false };

/**
 * Comparador antes/después.
 *
 * Fase 1 del roadmap: imágenes sueltas del disco con la línea arrastrable. El
 * mismo componente se va a reutilizar para comparar frames de video (fase 2)
 * y para el antes/después de la compresión (fase 2 del motor de salida).
 */
export function CompareView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const [before, setBefore] = useState<ImageSlot>(EMPTY_SLOT);
  const [after, setAfter] = useState<ImageSlot>(EMPTY_SLOT);
  const [position, setPosition] = useState(50);
  const [mode, setMode] = useState<BeforeAfterMode>('slider');
  const [zoom, setZoom] = useState(1);
  const [busySlot, setBusySlot] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = before.url !== '' && after.url !== '' && !before.failed && !after.failed;

  // Si otra vista (Compresión) dejó un par listo, se carga solo.
  useEffect(() => {
    const pending = takePendingComparison();
    if (!pending) return;
    const beforeUrl = store.service.absoluteFileUrl(pending.beforePath);
    const afterUrl = store.service.absoluteFileUrl(pending.afterPath);
    if (!beforeUrl || !afterUrl) return;
    setBefore({ path: pending.beforePath, url: beforeUrl, failed: false });
    setAfter({ path: pending.afterPath, url: afterUrl, failed: false });
  }, [store.service]);

  async function pick(slot: Slot): Promise<void> {
    setBusySlot(slot);
    setError(null);
    try {
      const path = await store.service.chooseImageFile(
        slot === 'before' ? 'Elegir la imagen original (antes)' : 'Elegir la imagen procesada (después)',
      );
      if (!path) return;
      const url = store.service.absoluteFileUrl(path);
      if (!url) {
        setError('Esta vista necesita la app de escritorio para abrir archivos del disco.');
        return;
      }
      const next: ImageSlot = { path, url, failed: false };
      if (slot === 'before') setBefore(next);
      else setAfter(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'no se pudo abrir la imagen');
    } finally {
      setBusySlot(null);
    }
  }

  function onImageError(slot: Slot): void {
    const mark: ImageSlot = { path: null, url: '', failed: true };
    if (slot === 'before') setBefore(mark);
    else setAfter(mark);
    setError('La imagen no se pudo cargar. Si el archivo se movió, elegila de nuevo.');
  }

  function swap(): void {
    setBefore(after);
    setAfter(before);
  }

  return (
    <section className="view compare-view">
      <ViewToolbar
        label="Comparar"
        actions={
          <>
            <button
              type="button"
              className="ghost icon-text"
              onClick={swap}
              disabled={!ready}
              title="Intercambiar antes y después"
            >
              <Icon name="refresh" size={14} />
              <span>Intercambiar</span>
            </button>
            <button type="button" className="ghost icon-text" onClick={() => onNavigate('learn')}>
              <Icon name="learn" size={14} />
              <span>Ayuda</span>
            </button>
          </>
        }
      />

      <header className="compare-head">
        <div>
          <h2>Antes y después</h2>
          <p>
            Cargá la imagen original y la procesada —comprimida, con color, recortada— y
            arrastrá la línea. El cambio se ve en tiempo real, sin esperar renders.
          </p>
        </div>
        <div className="compare-modes" role="group" aria-label="Modo de comparación">
          {(['slider', 'difference'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={mode === option ? 'chip active' : 'chip'}
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              disabled={!after.url}
            >
              {modeLabel(option)}
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}

      <div className="compare-slots">
        <button
          type="button"
          className={`compare-slot${before.url && !before.failed ? ' loaded' : ''}`}
          onClick={() => void pick('before')}
          disabled={busySlot !== null}
        >
          <Icon name="assets" size={16} />
          <strong>Antes</strong>
          <span>{slotLabel(before, busySlot === 'before')}</span>
        </button>
        <button
          type="button"
          className={`compare-slot${after.url && !after.failed ? ' loaded' : ''}`}
          onClick={() => void pick('after')}
          disabled={busySlot !== null}
        >
          <Icon name="effects" size={16} />
          <strong>Después</strong>
          <span>{slotLabel(after, busySlot === 'after')}</span>
        </button>
      </div>

      {before.url && !before.failed && after.url && !after.failed ? (
        <>
          <BeforeAfterSlider
            beforeUrl={before.url}
            afterUrl={after.url}
            position={position}
            mode={mode}
            zoom={zoom}
            onPositionChange={setPosition}
          />
          <div className="compare-controls">
            <label className="field">
              <span>
                Línea <output>{Math.round(position)} %</output>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={0.5}
                value={position}
                aria-label="Posición de la línea"
                onChange={(event) => setPosition(clampPosition(Number(event.target.value)))}
              />
            </label>
            <label className="field">
              <span>
                Zoom <output>{zoom.toFixed(1)}×</output>
              </span>
              <input
                type="range"
                min={1}
                max={8}
                step={0.1}
                value={zoom}
                aria-label="Zoom de las imágenes"
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setPosition(50);
                setZoom(1);
              }}
            >
              Restablecer
            </button>
          </div>
          <p className="fine-print">
            Arrastrá sobre la imagen o usá las flechas del teclado (con Shift salta de a 10 %).
            En modo “Diferencia” los píxeles iguales se ven negros: lo que quede iluminado es lo
            que cambió.
          </p>
        </>
      ) : (
        <p className="empty-inline compare-empty">
          Elegí las dos imágenes para empezar. Podés arrastrar la línea con el mouse o moverla con
          las flechas del teclado.
        </p>
      )}
    </section>
  );
}

function slotLabel(slot: ImageSlot, busy: boolean): string {
  if (busy) return 'Abriendo…';
  if (slot.failed) return 'No se pudo cargar';
  if (!slot.path) return 'Elegir imagen…';
  const parts = slot.path.split(/[\\/]/);
  return parts[parts.length - 1] ?? slot.path;
}
