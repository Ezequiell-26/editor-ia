import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppearance } from '../../state/AppearanceProvider';
import type { ThemePresetId } from '../../state/appearance';
import {
  COLOR_GROUPS,
  COLOR_TOKENS,
  THEME_FILE_KIND,
  THEME_PALETTES,
  fixTextContrast,
  parseThemeFile,
  serializeThemeFile,
  themeContrastReport,
  type ThemePalette,
  type ThemeTokenId,
} from '../../state/theme-palette';

type StatusKind = 'ok' | 'error';

interface Status {
  readonly kind: StatusKind;
  readonly text: string;
}

/** Nombre estable del archivo exportado: el mismo que documenta el contrato. */
const EXPORT_FILE_NAME = 'olyvia-tema.json';

const HEX_VALUE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Acepta `#rgb` y `#rrggbb` (con o sin `#`) y devuelve `#rrggbb` en minúsculas. */
function normalizeHex(value: string): string | null {
  const match = HEX_VALUE.exec(value.trim());
  if (!match) return null;
  const digits = match[1]!.toLowerCase();
  const expanded =
    digits.length === 3
      ? digits
          .split('')
          .map((digit) => `${digit}${digit}`)
          .join('')
      : digits;
  return `#${expanded}`;
}

/** Copia inmutable de la paleta con un token reemplazado. */
function withToken(palette: ThemePalette, token: ThemeTokenId, value: string): ThemePalette {
  return { ...palette, [token]: value };
}

/**
 * Lee el archivo como texto. `File.text()` es lo normal en el WebView y en los
 * navegadores modernos, pero jsdom (tests) todavía no lo implementa: FileReader
 * cubre ese caso sin cambiar el flujo.
 */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () =>
      reject(reader.error ?? new Error('no se pudo leer el archivo de tema'));
    reader.readAsText(file);
  });
}

/** Alturas de la onda decorativa del clip de audio del preview. */
const WAVEFORM_HEIGHTS = [5, 9, 7, 12, 8, 14, 6, 11, 8, 13, 5, 9, 7, 12, 10, 6, 11, 8, 13, 5];

/**
 * Estudio de color: edición de los 34 tokens de la paleta, preview vivo del
 * shell, reporte de contraste, exportar/importar archivo de tema y restablecer
 * colores. Todos los controles escriben en el proveedor de apariencia; el motor
 * (state/theme-palette) aporta tokens, paletas, contraste y archivo.
 */
export function ColorStudioCard() {
  const { appearance, setPalette, previewPalette, commitPreview } = useAppearance();

  const committed = appearance.palette;

  // Paleta "en vivo": va por delante de `appearance` mientras se arrastra un
  // color. El preview del proveedor pinta las variables CSS sin re-renderizar;
  // este estado local es el que refleja swatches, hex y reporte de contraste.
  const [draft, setDraft] = useState<ThemePalette | null>(null);
  const draftRef = useRef<ThemePalette | null>(null);

  // Borradores de los hex: el usuario puede tipear algo parcial o inválido sin
  // que el valor del token salte hasta confirmar o revertir.
  const [hexDrafts, setHexDrafts] = useState<Partial<Record<ThemeTokenId, string>>>({});

  const [status, setStatus] = useState<Status | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /**
   * Persistencia de la muestra de color. El picker nativo dispara `input` de
   * forma continua y no siempre deja foco en el control: si el commit dependiera
   * sólo de `blur`/`pointerup`, elegir un color y cerrar Ajustes con Escape
   * perdería el cambio. Se commitea al soltar y, además, se agrupa con un
   * temporizador corto para que cualquier cambio quede guardado.
   */
  const commitTimerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
    },
    [],
  );

  const palette = draft ?? committed;

  const report = useMemo(() => themeContrastReport(palette), [palette]);

  // Preset de referencia para «volver al preset»: un tema personalizado se
  // compara contra la paleta de marca (Olyvia).
  const referencePreset: Exclude<ThemePresetId, 'custom'> =
    appearance.preset === 'custom' ? 'olyvia' : appearance.preset;
  const referencePalette = THEME_PALETTES[referencePreset];

  // Si la apariencia cambia por fuera (preset desde Apariencia, importar,
  // restablecer), se descartan los borradores locales.
  useEffect(() => {
    draftRef.current = null;
    setDraft(null);
    setHexDrafts({});
  }, [committed]);

  // La confirmación de dos pasos de «Restablecer colores» expira sola.
  useEffect(() => {
    if (!confirmingReset) return;
    const timer = window.setTimeout(() => setConfirmingReset(false), 6_000);
    return () => window.clearTimeout(timer);
  }, [confirmingReset]);

  function setDraftPalette(next: ThemePalette): void {
    draftRef.current = next;
    setDraft(next);
  }

  /** Fija la paleta en vivo en el proveedor (commit + guardado). */
  function commitPalette(next: ThemePalette): void {
    replacePalette(next);
  }

  /** Reemplaza la paleta entera (importar, restablecer) y descarta borradores. */
  function replacePalette(next: ThemePalette, preset?: ThemePresetId): void {
    draftRef.current = null;
    setDraft(null);
    setHexDrafts({});
    setPalette(next, preset);
  }

  /** Preview del token mientras se arrastra el selector de color. */
  function previewToken(token: ThemeTokenId, value: string): void {
    const next = withToken(draftRef.current ?? committed, token, value);
    setDraftPalette(next);
    previewPalette(next);
    // Red de seguridad: además del blur/pointerup, commit agrupado para que el
    // cambio no se pierda si el foco queda dentro del picker nativo.
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = undefined;
      commitDraft();
    }, 320);
  }

  function commitDraft(): void {
    const next = draftRef.current;
    if (next) {
      commitPalette(next);
      return;
    }
    // Sin cambios locales: cierra cualquier preview pendiente por las dudas.
    commitPreview();
  }

  function changeHex(token: ThemeTokenId, value: string): void {
    setHexDrafts((previous) => ({ ...previous, [token]: value }));
    const normalized = normalizeHex(value);
    if (normalized) {
      const next = withToken(draftRef.current ?? committed, token, normalized);
      setDraftPalette(next);
      previewPalette(next);
    }
  }

  /** Enter/blur del hex: aplica si es válido y revierte el texto si no. */
  function commitHex(token: ThemeTokenId): void {
    const raw = hexDrafts[token];
    if (raw === undefined) return;
    setHexDrafts((previous) => {
      const next = { ...previous };
      delete next[token];
      return next;
    });
    const normalized = normalizeHex(raw);
    if (!normalized) return;
    const next = withToken(draftRef.current ?? committed, token, normalized);
    commitPalette(next);
  }

  function revertHex(token: ThemeTokenId): void {
    setHexDrafts((previous) => {
      const next = { ...previous };
      delete next[token];
      return next;
    });
  }

  function resetToken(token: ThemeTokenId): void {
    revertHex(token);
    commitPalette(withToken(committed, token, referencePalette[token]));
  }

  function exportTheme(): void {
    const name = appearance.preset === 'custom' ? 'Tema personalizado' : referencePreset;
    const text = serializeThemeFile(palette, name);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = EXPORT_FILE_NAME;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Igual que el respaldo: se libera con margen por si el WebView demora.
    window.setTimeout(() => URL.revokeObjectURL(url), 4_000);
    setStatus({
      kind: 'ok',
      text: `Tema exportado (${EXPORT_FILE_NAME}, formato ${THEME_FILE_KIND}). Revisá la carpeta de descargas.`,
    });
  }

  async function importTheme(file: File): Promise<void> {
    setBusy(true);
    try {
      const parsed = parseThemeFile(await readFileText(file));
      if (!parsed.ok) {
        // Un archivo inválido se rechaza entero: la paleta actual no se toca.
        setStatus({ kind: 'error', text: parsed.error });
        return;
      }
      replacePalette(parsed.palette, 'custom');
      setStatus({
        kind: 'ok',
        text: `Tema «${parsed.name}» importado. Los 34 colores se aplicaron juntos.`,
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'no se pudo leer el archivo de tema',
      });
    } finally {
      setBusy(false);
    }
  }

  function resetColors(): void {
    if (!confirmingReset) {
      setConfirmingReset(true);
      setStatus(null);
      return;
    }
    setConfirmingReset(false);
    replacePalette(THEME_PALETTES.olyvia, 'olyvia');
    setStatus({ kind: 'ok', text: 'Colores restablecidos al tema Olyvia de fábrica.' });
  }

  function correctText(): void {
    replacePalette(fixTextContrast(palette));
    setStatus({
      kind: 'ok',
      text: 'Se subió el contraste de los textos hasta el mínimo legible (4.5:1).',
    });
  }

  return (
    <article className="card color-studio">
      <header className="color-studio-top">
        <div>
          <h3>Color</h3>
          <p className="muted">
            Editá los 34 colores de la interfaz. Cada cambio se aplica en vivo y queda guardado en
            este equipo.
          </p>
        </div>
        <span className="color-studio-reference" title="Preset que usa el botón ↺ de cada fila">
          Referencia: {referencePreset === 'olyvia' ? 'Olyvia' : referencePreset}
        </span>
      </header>

      <div className="color-studio-actions">
        <button type="button" className="color-studio-export" onClick={exportTheme}>
          Exportar tema
        </button>
        <button
          type="button"
          className="color-studio-import"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? 'Leyendo…' : 'Importar tema'}
        </button>
        <button
          type="button"
          className={confirmingReset ? 'ghost danger color-studio-reset' : 'ghost color-studio-reset'}
          onClick={resetColors}
        >
          {confirmingReset ? 'Confirmar restablecer colores' : 'Restablecer colores'}
        </button>
        <input
          ref={fileRef}
          type="file"
          className="color-studio-file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Se limpia para poder importar dos veces el mismo archivo.
            event.target.value = '';
            if (file) void importTheme(file);
          }}
        />
      </div>

      {status ? (
        <p
          className={`color-studio-status notice ${
            status.kind === 'ok' ? 'notice-ok' : 'notice-warning'
          }`}
          role="status"
        >
          {status.text}
        </p>
      ) : null}

      <div className="theme-preview" role="img" aria-label="Vista previa del tema aplicado">
        <div className="theme-preview-topbar">
          <span className="theme-preview-logo" aria-hidden="true" />
          <span className="theme-preview-title">Olyvia</span>
          <span className="theme-preview-topbar-spacer" />
          <span className="theme-preview-topbar-chip">Sin título</span>
        </div>
        <div className="theme-preview-body">
          <div className="theme-preview-rail" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="theme-preview-main">
            <div className="theme-preview-panel">
              <div className="theme-preview-panel-head">
                <span>Timeline</span>
                <span className="theme-preview-badge">Éxito</span>
              </div>
              <div className="theme-preview-clip is-video">
                <span className="theme-preview-clip-kind">Video</span>
                <span className="theme-preview-clip-name">escena-01.mp4</span>
              </div>
              <div className="theme-preview-clip is-audio">
                <span className="theme-preview-clip-kind">Audio</span>
                <span className="theme-preview-waveform" aria-hidden="true">
                  {WAVEFORM_HEIGHTS.map((height, index) => (
                    <i key={index} style={{ height: `${height}px` }} />
                  ))}
                </span>
              </div>
              <div className="theme-preview-notice">Aviso: falta elegir la carpeta de salida.</div>
              <button type="button" className="theme-preview-primary" tabIndex={-1}>
                Exportar video
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="color-groups">
        {COLOR_GROUPS.map((group) => {
          const tokens = COLOR_TOKENS.filter((token) => token.group === group.id);
          return (
            <details
              key={group.id}
              className="color-group"
              data-group={group.id}
              open={group.id === 'superficies'}
            >
              <summary>
                <span className="color-group-label">{group.label}</span>
                <span className="color-group-count">{tokens.length}</span>
              </summary>
              <div className="color-group-rows">
                {tokens.map((token) => {
                  const current = palette[token.id];
                  const presetValue = referencePalette[token.id];
                  const dirty = current !== presetValue;
                  return (
                    <div key={token.id} className="color-row" data-token={token.id}>
                      <label className="color-row-label" htmlFor={`color-input-${token.id}`}>
                        {token.label}
                      </label>
                      <input
                        id={`color-input-${token.id}`}
                        type="color"
                        className="color-input"
                        value={current}
                        title={token.hint}
                        aria-label={`Color de ${token.label}`}
                        onChange={(event) => previewToken(token.id, event.target.value)}
                        onBlur={commitDraft}
                        onPointerUp={commitDraft}
                      />
                      <input
                        type="text"
                        className="color-hex"
                        value={hexDrafts[token.id] ?? current}
                        spellCheck={false}
                        autoComplete="off"
                        inputMode="text"
                        title={token.hint}
                        aria-label={`Hex de ${token.label}`}
                        onChange={(event) => changeHex(token.id, event.target.value)}
                        onBlur={() => commitHex(token.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            commitHex(token.id);
                          } else if (event.key === 'Escape') {
                            revertHex(token.id);
                          }
                        }}
                      />
                      {dirty ? (
                        <button
                          type="button"
                          className="color-reset"
                          title={`Volver a ${token.label} del preset`}
                          aria-label={`Volver al preset: ${token.label}`}
                          onClick={() => resetToken(token.id)}
                        >
                          ↺
                        </button>
                      ) : (
                        <span className="color-reset-spacer" aria-hidden="true" />
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>

      <section className="color-studio-contrast" aria-labelledby="color-contrast-title">
        <div className="color-studio-contrast-head">
          <h4 id="color-contrast-title">Contraste</h4>
          <p className="muted">
            Cada par se mide sobre la paleta actual; 4.5:1 es el mínimo para texto legible.
          </p>
        </div>
        <div className="contrast-list">
          {report.map((check) => (
            <div
              key={check.id}
              className={`contrast-row ${check.pass ? 'is-pass' : 'is-fail'}`}
              data-check={check.id}
              title={`${check.foreground} sobre ${check.background}`}
            >
              <span className="contrast-label">{check.label}</span>
              <code className="contrast-ratio">{check.ratio.toFixed(2)}:1</code>
              <span className="contrast-min">mín. {check.minimum}:1</span>
              <span className={`contrast-state ${check.pass ? 'is-pass' : 'is-fail'}`}>
                {check.pass ? 'Pasa' : 'Falla'}
              </span>
            </div>
          ))}
        </div>
        <button type="button" className="color-studio-fix" onClick={correctText}>
          Corregir texto
        </button>
      </section>

      <p className="fine-print">
        El tema no toca proyectos ni medios: sólo la apariencia de este equipo. Un archivo de tema
        inválido se rechaza entero en lugar de aplicarse a medias.
      </p>
    </article>
  );
}
