import { useCallback, useEffect, useState } from 'react';
import type { DesktopService, ModelInfo } from '../../services/project-service';
import { Icon } from '../../components/Icon';

/**
 * Pre-check de los modelos on-device compartido por Fondo y Upscale.
 *
 * Antes, estas vistas sólo descubrían que faltaba el modelo (o ONNX Runtime)
 * cuando el usuario ya había elegido la imagen y ejecutado la operación. Acá se
 * consulta `listModels()` al entrar, se ofrece la descarga en la propia vista y
 * se declara el requisito de `onnxruntime.dll` sin prometer que está resuelto:
 * el backend lo mide recién al inferir.
 */

export type LocalModelState = 'loading' | 'ready' | 'missing' | 'error' | 'unavailable';

interface LocalModelSnapshot {
  readonly state: LocalModelState;
  readonly model: ModelInfo | null;
  readonly error: string | null;
}

export interface LocalModelController extends LocalModelSnapshot {
  readonly busy: boolean;
  readonly refresh: () => Promise<void>;
  readonly download: () => Promise<void>;
}

function megaBytes(bytes: number): string {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

export function useLocalModel(service: DesktopService, capability: string): LocalModelController {
  const [snapshot, setSnapshot] = useState<LocalModelSnapshot>({
    state: 'loading',
    model: null,
    error: null,
  });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!service.available) {
      setSnapshot({ state: 'unavailable', model: null, error: null });
      return;
    }
    setSnapshot({ state: 'loading', model: null, error: null });
    try {
      const models = await service.listModels();
      const found = models.find((model) => model.capability === capability) ?? null;
      if (!found) {
        setSnapshot({
          state: 'error',
          model: null,
          error: `El backend no informó ningún modelo para la capacidad «${capability}»; revisá Ajustes → Capacidades.`,
        });
        return;
      }
      setSnapshot({ state: found.downloaded ? 'ready' : 'missing', model: found, error: null });
    } catch (failure) {
      setSnapshot({
        state: 'error',
        model: null,
        error:
          failure instanceof Error
            ? `No se pudo consultar el modelo local: ${failure.message}`
            : 'No se pudo consultar el modelo local.',
      });
    }
  }, [capability, service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const download = useCallback(async () => {
    const current = snapshot.model;
    if (!current) return;
    setBusy(true);
    try {
      const updated = await service.downloadModel(current.id);
      setSnapshot({
        state: updated.downloaded ? 'ready' : 'missing',
        model: updated,
        error: updated.downloaded ? null : 'La descarga terminó pero el modelo no figura como descargado.',
      });
    } catch (failure) {
      setSnapshot({
        state: 'error',
        model: current,
        error:
          failure instanceof Error
            ? `La descarga del modelo falló: ${failure.message}`
            : 'La descarga del modelo falló.',
      });
    } finally {
      setBusy(false);
    }
  }, [service, snapshot.model]);

  return { ...snapshot, busy, refresh, download };
}

export function LocalModelGate({
  label,
  controller,
  onOpenSettings,
}: {
  readonly label: string;
  readonly controller: LocalModelController;
  readonly onOpenSettings: () => void;
}) {
  const { state, model, error, busy } = controller;
  return (
    <section className="card local-model-gate" aria-labelledby="local-model-title">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Modelo local</p>
          <h3 id="local-model-title">{label}</h3>
        </div>
        <span className={`status-pill ${state === 'ready' ? 'saved' : state === 'loading' ? '' : 'dirty'}`}>
          {state === 'ready'
            ? 'Descargado'
            : state === 'loading'
              ? 'Comprobando'
              : state === 'unavailable'
                ? 'Sólo app nativa'
                : state === 'missing'
                  ? 'Falta descargar'
                  : 'Con error'}
        </span>
      </div>

      {state === 'loading' ? (
        <p className="fine-print">Comprobando el modelo instalado…</p>
      ) : null}

      {state === 'ready' && model ? (
        <p className="fine-print">
          {model.id} listo ({megaBytes(model.bytes)}, licencia {model.license.id}). La inferencia
          corre en esta máquina.
        </p>
      ) : null}

      {state === 'missing' && model ? (
        <>
          <p className="fine-print">
            Falta descargar <strong>{model.id}</strong> ({megaBytes(model.bytes)}, licencia{' '}
            {model.license.id}). La app verifica el SHA-256 al terminar.
          </p>
          <div className="actions">
            <button
              type="button"
              className="primary icon-text"
              onClick={() => void controller.download()}
              disabled={busy}
            >
              <Icon name="download" size={14} />
              <span>{busy ? 'Descargando…' : `Descargar modelo (${megaBytes(model.bytes)})`}</span>
            </button>
            <button type="button" className="ghost" onClick={onOpenSettings}>
              Abrir Ajustes
            </button>
          </div>
        </>
      ) : null}

      {state === 'error' ? (
        <>
          <p className="notice notice-warning" role="alert">
            {error ?? 'No se pudo comprobar el modelo local.'}
          </p>
          <div className="actions">
            <button
              type="button"
              className="ghost"
              onClick={() => void controller.refresh()}
              disabled={busy}
            >
              Reintentar
            </button>
            <button type="button" className="ghost" onClick={onOpenSettings}>
              Abrir Ajustes
            </button>
          </div>
        </>
      ) : null}

      {state === 'unavailable' ? (
        <p className="fine-print">
          El modelo corre sólo en la app de escritorio: el navegador no puede cargar ONNX Runtime
          ni escribir modelos en disco.
        </p>
      ) : null}

      <p className="fine-print">
        ONNX Runtime se carga desde <code>onnxruntime.dll</code> junto al ejecutable (o la variable{' '}
        <code>ORT_DYLIB_PATH</code>). Los modelos y su estado medido también viven en Ajustes →
        Inteligencia artificial → Capacidades.
      </p>
    </section>
  );
}
