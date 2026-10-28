import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Marker, MarkerColor } from '@editor-ia/project-schema';
import { MARKER_COLORS, MAX_MARKER_NOTE } from '@editor-ia/project-schema';
import { fpsOf, formatTimecode } from '../../state/project-actions';
import {
  deleteMarker,
  markerAtFrame,
  nextMarker,
  previousMarker,
  sortedMarkers,
  updateMarker,
} from '../../state/markers';
import { useProjectStore } from '../../state/project-store';

/** Mismos colores que usa el timeline en `styles/app.css` (`.marker-*`). */
const MARKER_COLOR_HEX: Record<MarkerColor, string> = {
  mint: '#6fa8dc',
  amber: '#f3b56b',
  rose: '#f08a9a',
  blue: '#6aa8ff',
  violet: '#b39dff',
  slate: '#9aa8b8',
};

const MARKER_COLOR_LABELS: Record<MarkerColor, string> = {
  mint: 'Menta',
  amber: 'Ámbar',
  rose: 'Rosa',
  blue: 'Azul',
  violet: 'Violeta',
  slate: 'Gris',
};

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 'var(--space-3)',
  background: 'var(--color-panel)',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  minHeight: 0,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--text-base)',
  fontWeight: 600,
  color: 'var(--color-text)',
};

const navButtonStyle: CSSProperties = {
  padding: '4px 10px',
  fontSize: 'var(--text-xs)',
  borderRadius: 6,
  border: '1px solid var(--color-border-strong)',
  background: 'var(--color-panel-2)',
  color: 'var(--color-text)',
  cursor: 'pointer',
};

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  overflowY: 'auto',
  minHeight: 0,
};

const rowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '6px 8px',
  background: 'var(--color-panel-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
};

const rowHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const jumpButtonStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  padding: '2px 6px',
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text)',
  textAlign: 'left',
  cursor: 'pointer',
  borderRadius: 4,
};

const timecodeStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-muted)',
  fontVariantNumeric: 'tabular-nums',
};

const smallButtonStyle: CSSProperties = {
  padding: '2px 8px',
  fontSize: 'var(--text-xs)',
  borderRadius: 5,
  border: '1px solid var(--color-border)',
  background: 'var(--color-panel-3)',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
};

const notePreviewStyle: CSSProperties = {
  margin: 0,
  padding: '0 6px',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const emptyStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--text-sm)',
  color: 'var(--color-empty)',
};

const swatchStyle: CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: '50%',
  border: '1px solid var(--color-border-strong)',
  cursor: 'pointer',
  padding: 0,
};

const editorActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const dangerButtonStyle: CSSProperties = {
  ...smallButtonStyle,
  color: 'var(--color-danger)',
  borderColor: 'var(--color-danger-strong)',
};

function firstLineOf(note: string): string {
  return note.split('\n')[0] ?? '';
}

/**
 * Panel navegable de marcadores del proyecto. Se monta solo con
 * `<MarkersPanel />` porque lee el proyecto del `ProjectProvider`: clic en un
 * marcador mueve el playhead, y cada fila permite editar la nota y el color,
 * o eliminar el marcador. Los botones de cabecera saltan al marcador
 * anterior o siguiente respecto del playhead.
 */
export function MarkersPanel() {
  const store = useProjectStore();
  const project = store.state.project;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const fps = project ? fpsOf(project) : 30;
  const markers = useMemo(
    () => (project ? sortedMarkers(project) : []),
    [project],
  );
  const currentMarkerId = project
    ? markerAtFrame(project, store.state.playheadFrame)?.id
    : undefined;
  const previous = project ? previousMarker(project, store.state.playheadFrame) : undefined;
  const next = project ? nextMarker(project, store.state.playheadFrame) : undefined;

  if (!project) return null;

  function jumpToPrevious(): void {
    if (previous) store.setPlayhead(previous.frame);
  }

  function jumpToNext(): void {
    if (next) store.setPlayhead(next.frame);
  }

  function openEditor(marker: Marker): void {
    setEditingId(marker.id);
    setNoteDraft(marker.note ?? '');
  }

  function closeEditor(): void {
    setEditingId(null);
    setNoteDraft('');
  }

  function saveNote(markerId: string): void {
    // updateMarker y deleteMarker devuelven el proyecto directamente;
    // solo addMarker devuelve una envoltura `{ project }`.
    store.update((current) => updateMarker(current, markerId, { note: noteDraft }));
    closeEditor();
  }

  function applyColor(marker: Marker, color: MarkerColor): void {
    const nextColor: MarkerColor | undefined = marker.color === color ? undefined : color;
    store.update((current) => updateMarker(current, marker.id, { color: nextColor }));
  }

  function removeMarker(markerId: string): void {
    store.update((current) => deleteMarker(current, markerId));
    if (editingId === markerId) closeEditor();
  }

  return (
    <section aria-label="Panel de marcadores" style={panelStyle}>
      <header style={headerStyle}>
        <h2 style={titleStyle}>
          Marcadores <span style={{ color: 'var(--color-text-muted)' }}>({markers.length})</span>
        </h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            style={navButtonStyle}
            onClick={jumpToPrevious}
            disabled={!previous}
            aria-label="Ir al marcador anterior"
            title="Ir al marcador anterior"
          >
            ◀ Anterior
          </button>
          <button
            type="button"
            style={navButtonStyle}
            onClick={jumpToNext}
            disabled={!next}
            aria-label="Ir al marcador siguiente"
            title="Ir al marcador siguiente"
          >
            Siguiente ▶
          </button>
        </div>
      </header>
      {markers.length === 0 ? (
        <p style={emptyStyle}>
          Sin marcadores todavía. Coloca el playhead y pulsa M sobre el timeline para crear uno.
        </p>
      ) : (
        <ul style={listStyle} aria-label="Lista de marcadores">
          {markers.map((marker) => {
            const isEditing = editingId === marker.id;
            const isCurrent = currentMarkerId === marker.id;
            const accent = MARKER_COLOR_HEX[marker.color ?? 'mint'];
            return (
              <li key={marker.id} style={{ ...rowStyle, borderLeft: `3px solid ${accent}` }}>
                <div style={rowHeaderStyle}>
                  <button
                    type="button"
                    style={jumpButtonStyle}
                    onClick={() => store.setPlayhead(marker.frame)}
                    aria-current={isCurrent ? 'true' : undefined}
                    aria-label={`Ir al marcador ${marker.label} en ${formatTimecode(marker.frame, fps)}`}
                  >
                    <span style={timecodeStyle}>{formatTimecode(marker.frame, fps)}</span>
                    <span>{marker.label}</span>
                  </button>
                  <button
                    type="button"
                    style={smallButtonStyle}
                    onClick={() => (isEditing ? closeEditor() : openEditor(marker))}
                    aria-expanded={isEditing}
                    aria-label={`Editar marcador ${marker.label}`}
                  >
                    {isEditing ? 'Cerrar' : 'Editar'}
                  </button>
                </div>
                {marker.note && !isEditing ? (
                  <p style={notePreviewStyle} title={marker.note}>
                    {firstLineOf(marker.note)}
                  </p>
                ) : null}
                {isEditing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <textarea
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      rows={3}
                      maxLength={MAX_MARKER_NOTE}
                      aria-label={`Nota de ${marker.label}`}
                      placeholder="Nota del marcador (opcional)"
                      style={{
                        resize: 'vertical',
                        padding: 6,
                        fontSize: 'var(--text-xs)',
                        background: 'var(--color-panel)',
                        color: 'var(--color-text)',
                        border: '1px solid var(--color-border-strong)',
                        borderRadius: 6,
                      }}
                    />
                    <div role="group" aria-label={`Color de ${marker.label}`} style={editorActionsStyle}>
                      {MARKER_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          style={{
                            ...swatchStyle,
                            background: MARKER_COLOR_HEX[color],
                            outline: marker.color === color ? '2px solid var(--color-text)' : 'none',
                          }}
                          aria-pressed={marker.color === color}
                          aria-label={`Color ${MARKER_COLOR_LABELS[color]}`}
                          title={MARKER_COLOR_LABELS[color]}
                          onClick={() => applyColor(marker, color)}
                        />
                      ))}
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                        {marker.color
                          ? MARKER_COLOR_LABELS[marker.color]
                          : 'Sin color'}
                      </span>
                    </div>
                    <div style={editorActionsStyle}>
                      <button
                        type="button"
                        style={smallButtonStyle}
                        onClick={() => saveNote(marker.id)}
                      >
                        Guardar nota
                      </button>
                      <button
                        type="button"
                        style={dangerButtonStyle}
                        onClick={() => removeMarker(marker.id)}
                      >
                        Eliminar marcador
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
