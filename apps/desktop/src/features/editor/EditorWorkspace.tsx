import { useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import {
  deleteCaptionCue,
  deleteClip,
  fpsOf,
  splitClip,
  totalFrames,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { useEditorPreferences } from '../../state/useEditorPreferences';
import { Icon } from '../../components/Icon';
import { EditorAssets } from './EditorAssets';
import { ExportDialog } from './ExportDialog';
import { Inspector } from './Inspector';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { Transport } from './Transport';
import { usePlayback } from './usePlayback';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function EditorWorkspace({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const preferences = useEditorPreferences();
  const [exportOpen, setExportOpen] = useState(false);
  usePlayback();

  useEffect(() => {
    if (!store.state.exportRequested) return;
    setExportOpen(true);
    store.consumeExportRequest();
  }, [store.state.exportRequested, store.consumeExportRequest]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || !project) return;
      const selection = store.state.selection;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.kind === 'clip') {
          event.preventDefault();
          let nextDuration = 0;
          store.update((current) => {
            const next = deleteClip(current, selection.id);
            nextDuration = totalFrames(next);
            return next;
          });
          store.setSelection({ kind: 'none' });
          store.setPlayhead(Math.min(store.state.playheadFrame, nextDuration));
        } else if (selection.kind === 'cue') {
          event.preventDefault();
          store.update((current) => deleteCaptionCue(current, selection.id));
          store.setSelection({ kind: 'none' });
        }
      }
      if (event.key.toLowerCase() === 's' && !event.ctrlKey && !event.metaKey) {
        if (selection.kind === 'clip') {
          event.preventDefault();
          store.mutate((current) => {
            const split = splitClip(current, selection.id, store.state.playheadFrame);
            if (!split) throw new Error('el playhead no está dentro del clip seleccionado');
            return { project: split.project, rightClipId: split.rightClipId };
          });
        }
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        // El paso base y el paso con Shift salen de Ajustes → Editor, así que
        // se puede trabajar frame a frame o saltos largos según el proyecto.
        const step = preferences.jumpStepFrames;
        const delta = event.shiftKey ? step * 10 : step;
        store.setPlaying(false);
        store.setPlayhead(store.state.playheadFrame + (event.key === 'ArrowLeft' ? -delta : delta));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [project, store, preferences.jumpStepFrames]);

  if (!project) {
    return (
      <section className="view">
        <p className="empty-state">
          No hay proyecto abierto. Creá o abrí un proyecto para editar. La timeline no inventa
          pistas ni clips: aparece vacía hasta que montás un medio.
        </p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => onNavigate('projects')}>
            Ir a Proyectos
          </button>
        </div>
      </section>
    );
  }

  const fps = fpsOf(project);

  return (
    <section className="editor-workspace">
      <div className="editor-toolbar">
        <div className="editor-toolbar-actions">
          <span
            className={`status-pill ${store.state.phase}`}
            title={store.statusText}
            aria-live="polite"
          >
            <span className={`status-pill-dot phase-${store.state.phase}`} aria-hidden="true" />
            {store.state.phase === 'saved'
              ? 'Guardado'
              : store.state.phase === 'saving'
                ? 'Guardando…'
                : store.state.phase === 'failed'
                  ? 'Error al guardar'
                  : 'Sin guardar'}
          </span>
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('script')}>
            <Icon name="script" size={15} />
            <span>Guion</span>
          </button>
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('assets')}>
            <Icon name="assets" size={15} />
            <span>Medios</span>
          </button>
          <button
            type="button"
            className="primary icon-text"
            onClick={() => {
              setExportOpen(true);
            }}
            disabled={project.timeline.clips.length === 0}
            title={project.timeline.clips.length === 0 ? 'Montá al menos un clip para exportar' : undefined}
          >
            <Icon name="export" size={15} />
            <span>Exportar MP4</span>
          </button>
        </div>
      </div>

      <div className="editor-grid">
        <EditorAssets onNavigate={onNavigate} />
        <div className="preview-panel">
          <Preview />
          <Transport />
        </div>
        <Inspector />
        <div className="timeline-panel">
          <Timeline />
        </div>
      </div>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </section>
  );
}
