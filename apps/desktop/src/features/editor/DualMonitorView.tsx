/**
 * Vista de la ventana dual (`previa_dupla` de AlaukCut): monitor del
 * programa a pantalla completa en una segunda ventana del SO, sincronizado
 * con la principal por `BroadcastChannel`.
 *
 * No monta el editor ni permite editar: recibe el `ProjectDocument` por
 * `snapshot`/`project` y el transporte por `transport`, y devuelve sólo
 * comandos de transporte (`play`/`pause`/`seek`/`rate`) y `close`. El
 * `ProjectProvider` corre con `opened: null`, así que el autosave nunca
 * dispara desde esta ventana — el documento sigue siendo propiedad de la
 * principal.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseProject, type ProjectDocument } from '@editor-ia/project-schema';
import { createDesktopService, type DesktopService } from '../../services/project-service';
import type { OpenedProject } from '../../services/contracts/projects';
import {
  closeDualWindowSelf,
  dualChannel,
  isDualMonitorQuery,
  isDualMonitorLabel,
  type DualFromMainMessage,
} from '../../platform/dual-monitor';
import { ProjectProvider, useProjectPlayback, useProjectStore } from '../../state/project-store';
import { describeFrame } from '../../state/project-store-selectors';
import { fpsOf } from '../../state/project-actions';
import { Preview } from './Preview';
import { AppearanceProvider } from '../../state/AppearanceProvider';

interface DualSnapshot {
  readonly project: unknown;
  readonly opened: unknown;
  readonly playheadFrame: number;
  readonly playing: boolean;
  readonly playbackRate: number;
  readonly playbackDirection: 1 | -1;
}

function asOpenedProject(value: unknown): OpenedProject | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<OpenedProject>;
  if (typeof candidate.path !== 'string' || typeof candidate.root !== 'string') return null;
  return value as OpenedProject;
}

/** Barra de transporte mínima: play/pausa, timecode y cerrar. */
function DualTransportBar() {
  const store = useProjectStore();
  const playback = useProjectPlayback();
  const project = store.state.project;
  const fps = project ? fpsOf(project) : 30;

  const toggle = () => store.setPlaying(!playback.playing);
  const close = () => {
    const channel = dualChannel();
    channel?.postMessage({ type: 'close' });
    channel?.close();
    void closeDualWindowSelf();
  };

  return (
    <div className="dual-monitor-bar">
      <button
        type="button"
        className="dual-monitor-play"
        onClick={toggle}
        aria-label={playback.playing ? 'Pausar' : 'Reproducir'}
      >
        {playback.playing ? '❚❚' : '▶'}
      </button>
      <span className="dual-monitor-time">
        {describeFrame(playback.frame, project)} / {describeFrame(store.durationFrames, project)}
        {` · ${fps} fps`}
      </span>
      <span className="dual-monitor-hint">Monitor dual — la edición sigue en la ventana principal</span>
      <button type="button" className="dual-monitor-close" onClick={close}>
        Cerrar
      </button>
    </div>
  );
}

/** Aplica `project`/`transport`/`close` recibidos por el canal. Vive dentro
 *  del provider para tener acceso al store. */
function DualStage({ initial }: { readonly initial: DualSnapshot }) {
  const store = useProjectStore();
  const appliedInitial = useRef(false);

  useEffect(() => {
    const channel = dualChannel();
    if (!channel) return;
    const onMessage = (event: MessageEvent<DualFromMainMessage>) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      switch (message.type) {
        case 'project': {
          if (message.project === null || message.project === undefined) return;
          const parsed = parseProject(message.project);
          if (parsed.ok) {
            store.update(() => parsed.project, { history: false });
          }
          break;
        }
        case 'transport': {
          if (typeof message.playheadFrame === 'number') {
            store.setPlayhead(Math.max(0, Math.round(message.playheadFrame)));
          }
          store.setPlaying(Boolean(message.playing));
          if (typeof message.playbackRate === 'number') store.setPlaybackRate(message.playbackRate);
          if (message.playbackDirection === 1 || message.playbackDirection === -1) {
            store.setPlaybackDirection(message.playbackDirection);
          }
          break;
        }
        case 'close':
          channel.close();
          void closeDualWindowSelf();
          break;
      }
    };
    channel.addEventListener('message', onMessage);
    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Transporte inicial del snapshot (el provider arranca en frame 0).
  useEffect(() => {
    if (appliedInitial.current) return;
    appliedInitial.current = true;
    store.setPlayhead(Math.max(0, Math.round(initial.playheadFrame)));
    store.setPlaying(initial.playing);
    store.setPlaybackRate(initial.playbackRate);
    store.setPlaybackDirection(initial.playbackDirection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dual-monitor-stage">
      <Preview />
      <DualTransportBar />
    </div>
  );
}

export function DualMonitorView() {
  const [service] = useState<DesktopService>(() => createDesktopService());
  const [snapshot, setSnapshot] = useState<DualSnapshot | null>(null);
  const [noProject, setNoProject] = useState(false);

  useEffect(() => {
    const channel = dualChannel();
    if (!channel) return;
    channel.postMessage({ type: 'hello' });
    const onMessage = (event: MessageEvent<DualFromMainMessage>) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      if (message.type === 'snapshot') {
        setSnapshot(message as unknown as DualSnapshot);
        setNoProject(message.project === null || message.project === undefined);
      } else if (message.type === 'project') {
        setNoProject(message.project === null || message.project === undefined);
      } else if (message.type === 'close') {
        void closeDualWindowSelf();
      }
    };
    channel.addEventListener('message', onMessage);
    const bye = () => channel.postMessage({ type: 'bye' });
    window.addEventListener('pagehide', bye);
    return () => {
      channel.removeEventListener('message', onMessage);
      window.removeEventListener('pagehide', bye);
      channel.postMessage({ type: 'bye' });
      channel.close();
    };
  }, []);

  const initial = useMemo(() => {
    if (!snapshot) return null;
    const parsed = parseProject(snapshot.project);
    if (!parsed.ok) return null;
    return {
      project: parsed.project as ProjectDocument,
      opened: asOpenedProject(snapshot.opened),
    };
  }, [snapshot]);

  return (
    <AppearanceProvider>
      <div className="dual-monitor">
        {initial && !noProject ? (
          <ProjectProvider service={service} initial={initial}>
            {snapshot ? <DualStage initial={snapshot} /> : null}
          </ProjectProvider>
        ) : (
          <div className="dual-monitor-empty">
            <p>
              {snapshot
                ? 'La ventana principal no tiene un proyecto abierto.'
                : 'Esperando el proyecto desde la ventana principal…'}
            </p>
            <p className="dual-monitor-hint">
              Abrí un proyecto en Olyvia y el monitor aparecerá acá.
            </p>
            <button type="button" onClick={() => void closeDualWindowSelf()}>
              Cerrar
            </button>
          </div>
        )}
      </div>
    </AppearanceProvider>
  );
}

/** `?dual=1` directo, o el label `dual-monitor` cuando Tauri no conserva
 *  el query de `WebviewUrl::App`. Devuelve `null` mientras se resuelve
 *  para no flashear el editor en la ventana dual. */
export function useDualMonitorMode(): boolean | null {
  const [mode, setMode] = useState<boolean | null>(() =>
    isDualMonitorQuery() ? true : null,
  );
  useEffect(() => {
    if (mode === true) return;
    let active = true;
    void isDualMonitorLabel().then((label) => {
      if (active) setMode(label ? true : false);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return mode;
}
