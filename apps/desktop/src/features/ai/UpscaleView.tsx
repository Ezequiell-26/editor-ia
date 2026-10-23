import { useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type { UpscaleResult } from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import { queuePendingComparison } from '../compare/pending';

/**
 * Upscale ×4 con Real-ESRGAN local.
 *
 * Fase 3: segundo consumo del gestor de modelos. El modelo tiene entrada fija
 * de 128×128, así que la imagen se procesa por teselas con solape; el límite
 * de 2048 por lado es de memoria y está explicado en la UI.
 */
export function UpscaleView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const [inputPath, setInputPath] = useState<string | null>(null);
  const [result, setResult] = useState<UpscaleResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickImage(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const path = await store.service.chooseImageFile('Elegir la imagen a agrandar');
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
      setResult(await store.service.upscaleImage(inputPath));
      store.setNotice('Upscale ×4 listo. El resultado quedó listo para comparar.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'el upscale falló');
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
        label="Upscale"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('learn')}>
            <Icon name="learn" size={14} />
            <span>Ayuda</span>
          </button>
        }
      />

      <header className="background-head">
        <div>
          <h2>Agrandar ×4 con IA local</h2>
          <p>
            Real-ESRGAN corriendo en tu máquina recupera detalle al agrandar ×4. La imagen se
            procesa por teselas de 128×128 con solape, así que puede tardar un rato según el
            tamaño. El modelo exige un límite de 2048×2048 por memoria.
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
          {inputPath ? inputPath.split(/[\\/]/).pop() : 'hasta 2048×2048; el resultado es ×4'}
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
          <span>{busy ? 'Agrandando…' : 'Agrandar ×4'}</span>
        </button>
      </div>

      {result ? (
        <div className="compress-result" role="status">
          <p className="compress-numbers">
            {result.inputWidth}×{result.inputHeight} →{' '}
            <strong>
              {result.outputWidth}×{result.outputHeight}
            </strong>{' '}
            · {result.tiles} tesela(s)
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
