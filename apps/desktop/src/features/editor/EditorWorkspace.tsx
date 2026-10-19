import { useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import {
  deleteCaptionCue,
  deleteClip,
  formatTimecode,
  fpsOf,
  splitClip,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
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
  const [exportOpen, setExportOpen] = useState(false);
  usePlayback();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || !project) return;
      const selection = store.state.selection;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.kind === 'clip') {
          event.preventDefault();
          store.update((current) => deleteClip(current, selection.id));
          store.setSelection({ kind: 'none' });
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
        const delta = event.shiftKey ? 10 : 1;
        store.setPlaying(false);
        store.setPlayhead(store.state.playheadFrame + (event.key === 'ArrowLeft' ? -delta : delta));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [project, store]);

  if (!project) {
    return (
      <section className="view">
        <div className="view-head">
          <div>
            <p className="eyebrow">Edición</p>
            <h2>Editor</h2>
            <p className="view-summary">Timeline, vista previa e inspector del proyecto abierto.</p>
          </div>
        </div>
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
        <div className="editor-title">
          <p className="eyebrow">Editor</p>
          <h2 title={project.name}>{project.name}</h2>
          <span className="editor-meta">
            {project.video.width}×{project.video.height} · {fps} fps ·{' '}
            {formatTimecode(store.durationFrames, fps)}
          </span>
        </div>
        <div className="editor-toolbar-actions">
          <span className={`status-pill ${store.state.phase}`}>{store.statusText}</span>
          <button type="button" className="ghost" onClick={() => onNavigate('script')}>
            Guion
          </button>
          <button type="button" className="ghost" onClick={() => onNavigate('assets')}>
            Medios
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setExportOpen(true);
            }}
            disabled={project.timeline.clips.length === 0}
            title={project.timeline.clips.length === 0 ? 'Montá al menos un clip para exportar' : undefined}
          >
            Exportar MP4
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
