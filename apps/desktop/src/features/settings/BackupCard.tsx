import { useEffect, useRef, useState } from 'react';
import { useAppearance } from '../../state/AppearanceProvider';
import { resetEditorPreferences } from '../../state/editor-preferences';
import {
  applyPreferencesBundle,
  buildPreferencesBundle,
  parsePreferencesBundle,
  preferencesFileName,
  serializePreferencesBundle,
} from '../../state/preferences-backup';
import { resetShortcuts } from '../../state/shortcuts';

type StatusKind = 'ok' | 'error';

interface Status {
  readonly kind: StatusKind;
  readonly text: string;
}

/**
 * Respaldo de las preferencias locales en un JSON y restauración desde ese
 * mismo archivo. No toca proyectos ni medios: sólo apariencia, atajos y
 * preferencias del editor.
 */
export function BackupCard() {
  const { update, reset } = useAppearance();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 6_000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  function download(): void {
    const name = preferencesFileName();
    const text = serializePreferencesBundle(buildPreferencesBundle());
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Algunos WebView cancelan la descarga si el objeto URL se revoca antes de
    // que el gestor la tome; se libera con margen.
    window.setTimeout(() => URL.revokeObjectURL(url), 4_000);
    setStatus({
      kind: 'ok',
      text: `Respaldo generado (${name}). Revisá la carpeta de descargas del sistema.`,
    });
  }

  async function restore(file: File): Promise<void> {
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = parsePreferencesBundle(text);
      if (!parsed.ok) {
        setStatus({ kind: 'error', text: parsed.error });
        return;
      }
      const summary = applyPreferencesBundle(parsed.bundle);
      // La apariencia se aplica por el proveedor para que el cambio se vea al
      // instante, sin recargar la ventana.
      update(parsed.bundle.appearance);
      setStatus({
        kind: 'ok',
        text: `Restaurado desde ${file.name}: apariencia, ${summary.shortcuts} atajos y preferencias del editor.`,
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'no se pudo leer el archivo',
      });
    } finally {
      setBusy(false);
    }
  }

  function resetAll(): void {
    if (!confirming) {
      setConfirming(true);
      setStatus(null);
      return;
    }
    setConfirming(false);
    resetEditorPreferences();
    resetShortcuts();
    reset();
    setStatus({
      kind: 'ok',
      text: 'Preferencias, atajos y apariencia volvieron a los valores de fábrica.',
    });
  }

  return (
    <article className="card backup-card">
      <p className="eyebrow">Respaldo</p>
      <h3>Preferencias en un archivo</h3>
      <p className="muted">
        Apariencia, atajos y preferencias del editor en un único JSON legible. Sirve para mover la
        configuración a otra máquina o para volver atrás después de probar cambios.
      </p>

      <div className="actions">
        <button type="button" className="primary" onClick={download}>
          Descargar respaldo
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? 'Leyendo…' : 'Restaurar desde archivo'}
        </button>
        <button
          type="button"
          className={confirming ? 'ghost danger' : 'ghost'}
          onClick={resetAll}
        >
          {confirming ? 'Confirmar restablecer de fábrica' : 'Restablecer de fábrica'}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Se limpia el input para poder volver a elegir el mismo archivo.
          event.target.value = '';
          if (file) void restore(file);
        }}
      />

      {status ? (
        <p
          className={status.kind === 'ok' ? 'notice notice-ok' : 'notice notice-warning'}
          role="status"
        >
          {status.text}
        </p>
      ) : null}

      <p className="fine-print">
        El respaldo no incluye proyectos, medios ni claves: las claves siguen en el Administrador
        de credenciales de Windows. Un archivo con atajos inválidos se rechaza entero en lugar de
        aplicarse a medias.
      </p>
    </article>
  );
}
