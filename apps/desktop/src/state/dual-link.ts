/**
 * Enlace del monitor dual en la ventana principal (`previa_dupla` de
 * AlaukCut): escucha el `BroadcastChannel` compartido y expone el
 * proyecto + transporte a la segunda ventana.
 *
 * - `hello` (al abrir la dual) → responde `snapshot` con el documento
 *   actual, `opened` y el estado de transporte.
 * - Cambios del proyecto → `project` (debounce; el documento viaja
 *   entero porque la dual no comparte memoria con la principal).
 * - Cambios de transporte → `transport` (cada frame durante playback,
 *   igual que el playhead del editor).
 * - `command` de la dual → ejecuta la acción equivalente del store.
 * - `bye`/`pagehide` de la dual → deja de publicar hasta el próximo
 *   `hello` (evita serializar el proyecto sin nadie escuchando).
 */

import { useEffect, useRef } from 'react';
import {
  DUAL_MONITOR_CHANNEL,
  dualChannel,
  type DualFromMainMessage,
  type DualToMainMessage,
} from '../platform/dual-monitor';
import {
  usePlayheadFrame,
  useProjectPlaybackDirection,
  useProjectPlaybackRate,
  useProjectPlaying,
  useProjectStore,
} from './project-store';

const PROJECT_DEBOUNCE_MS = 800;

export function useDualMonitorLink(): void {
  const store = useProjectStore();
  const playheadFrame = usePlayheadFrame();
  const playing = useProjectPlaying();
  const playbackRate = useProjectPlaybackRate();
  const playbackDirection = useProjectPlaybackDirection();

  const channelRef = useRef<BroadcastChannel | null>(null);
  const activeRef = useRef(false);
  const projectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storeRef = useRef(store);
  storeRef.current = store;

  const post = (message: DualFromMainMessage) => {
    channelRef.current?.postMessage(message);
  };

  // Canal + comandos entrantes. Se crea una sola vez; las acciones leen
  // `storeRef` para no re-suscribir en cada render.
  useEffect(() => {
    const channel = dualChannel();
    if (!channel) return;
    channelRef.current = channel;

    const snapshot = (): DualFromMainMessage => {
      const current = storeRef.current;
      return {
        type: 'snapshot',
        project: current.state.project,
        opened: current.state.opened,
        playheadFrame: current.getPlayhead(),
        playing: current.getPlaying(),
        playbackRate: current.getPlaybackRate(),
        playbackDirection: current.getPlaybackDirection(),
      };
    };

    const onMessage = (event: MessageEvent<DualToMainMessage>) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      switch (message.type) {
        case 'hello':
          activeRef.current = true;
          post(snapshot());
          break;
        case 'bye':
          activeRef.current = false;
          break;
        case 'command': {
          const current = storeRef.current;
          switch (message.action) {
            case 'play':
              current.setPlaying(true);
              break;
            case 'pause':
              current.setPlaying(false);
              break;
            case 'toggle':
              current.setPlaying(!current.getPlaying());
              break;
            case 'seek':
              if (typeof message.frame === 'number' && Number.isFinite(message.frame)) {
                current.setPlayhead(Math.max(0, Math.round(message.frame)));
              }
              break;
            case 'rate':
              if (typeof message.rate === 'number' && Number.isFinite(message.rate)) {
                current.setPlaybackRate(message.rate);
              }
              break;
          }
          break;
        }
        case 'close':
          // La dual se cierra a sí misma; la principal sólo acusa.
          post({ type: 'close' });
          break;
      }
    };
    channel.addEventListener('message', onMessage);
    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Documento: publicar cambios con debounce sólo si hay dual activa.
  const project = store.state.project;
  useEffect(() => {
    if (!activeRef.current) return;
    if (projectTimerRef.current) clearTimeout(projectTimerRef.current);
    projectTimerRef.current = setTimeout(() => {
      projectTimerRef.current = null;
      post({ type: 'project', project });
    }, PROJECT_DEBOUNCE_MS);
    return () => {
      if (projectTimerRef.current) {
        clearTimeout(projectTimerRef.current);
        projectTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // Transporte: se publica en cada cambio (el playhead ya llega por frame).
  useEffect(() => {
    if (!activeRef.current) return;
    post({
      type: 'transport',
      playheadFrame,
      playing,
      playbackRate,
      playbackDirection,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playheadFrame, playing, playbackRate, playbackDirection]);
}
