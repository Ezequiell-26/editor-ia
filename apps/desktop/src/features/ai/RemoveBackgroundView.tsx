import { useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type { BackgroundRemoval } from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import { queuePendingComparison } from '../compare/pending';

/**
 * Quitar fondo con IA local.
 *
 * Fase 3: es la primera capacidad que corre con un modelo neuronal en la
 * máquina del usuario (u2netp vía ONNX Runtime). Nada sale de la app; el
 * resultado es un PNG con transparencia listo para el comparador.
 */
export function RemoveBackgroundView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const [inputPath, setInputPath] = useState<string | null>(null);
  const [result, setResult] = useState<BackgroundRemoval | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickImage(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const path = await store.service.chooseImageFile('Elegir la imagen a recortar');
      if (path) setInputPath(path);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'no se pudo abrir la imagen');
    } finally {
      setBusy(false);
    }
  }

  async function run(): Promise<void> {
    if (!inputPath) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await store.service.removeBackground(inputPath));
      store.setNotice('Fondo quitado con el modelo local. El resultado tiene canal alfa.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'el recorte falló');
    } finally {
      setBusy(false);
    }
  }

  function compare(): void {
    if (!result || !inputPath) return;
    queuePendingComparison({ beforePath: inputPath, afterPath: result.path });
    onNavigate('compare');
  }

  return (
    <section className="view background-view">
      <ViewToolbar
        label="Quitar fondo"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('learn')}>
            <Icon name="learn" size={14} />
            <span>Ayuda</span>
          </button>
        }
      />

      <header className="background-head">
        <div>
          <h2>Quitar fondo con IA local</h2>
          <p>
            El modelo corre en esta máquina con ONNX Runtime: la imagen no sale de tu equipo y no
            hay cuotas ni cuentas. El resultado es un PNG con transparencia.
          </p>
        </div>
      </header>

      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className={`compress-slot${inputPath ? ' loaded' : ''}`}
        onClick={() => void pickImage()}
        disabled={busy}
      >
        <Icon name="assets" size={16} />
        <strong>{inputPath ? 'Imagen elegida' : 'Elegir imagen'}</strong>
        <span>
          {inputPath ? inputPath.split(/[\\/]/).pop() : 'JPG, PNG, WebP y demás formatos que FFmpeg lee'}
        </span>
      </button>

      <div className="background-actions">
        <button
          type="button"
          className="primary icon-text"
          onClick={() => void run()}
          disabled={busy || !inputPath}
        >
          <Icon name="sparkles" size={15} />
          <span>{busy ? 'Recortando…' : 'Quitar fondo'}</span>
        </button>
      </div>

      {result ? (
        <div className="compress-result" role="status">
          <p className="compress-numbers">
            Listo: {result.width}×{result.height} con transparencia
          </p>
          <p className="compress-path">{result.path}</p>
          <button type="button" className="primary icon-text" onClick={compare}>
            <Icon name="split" size={15} />
            <span>Comparar antes y después</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
