import { useContext, useMemo } from 'react';
import type { ProjectDocument } from '@editor-ia/project-schema';
import { formatTimecode } from './project-actions';
import { ProjectContext, PlayheadContext, PlayingContext, PlaybackRateContext } from './project-store-context';
import type { ProjectStoreValue } from './project-store-types';



export function useProjectStore(): ProjectStoreValue {
  const value = useContext(ProjectContext);
  if (!value) {
    throw new Error('useProjectStore necesita un ProjectProvider');
  }
  return value;
}


export function useProjectDocument(): ProjectDocument | null {
  return useProjectStore().state.project;
}


/** Frame del playhead: s├│lo re-renderiza a quienes lo muestran. */
export function usePlayheadFrame(): number {
  return useContext(PlayheadContext);
}


/** Estado de reproducci├│n: cambia s├│lo al play/pausa, no por frame. */
export function useProjectPlaying(): boolean {
  return useContext(PlayingContext);
}


/** Velocidad de reproducción: cambia sólo al elegir otra, no por frame. */
export function useProjectPlaybackRate(): number {
  return useContext(PlaybackRateContext);
}


/** Atajo para quien necesita ambos (preview, transport, loop de playback). */
export function useProjectPlayback(): {
  readonly frame: number;
  readonly playing: boolean;
  readonly rate: number;
} {
  const frame = usePlayheadFrame();
  const playing = useProjectPlaying();
  const rate = useProjectPlaybackRate();
  return useMemo(() => ({ frame, playing, rate }), [frame, playing, rate]);
}


// Selectors especializados para evitar re-renders globales
export function useProjectPlayhead() {
  return useProjectPlayback();
}


export function useProjectSelection() {
  const store = useProjectStore();
  return useMemo(
    () => store.state.selection,
    [store.state.selection],
  );
}


export function useProjectTracks() {
  const store = useProjectStore();
  return useMemo(
    () => store.state.project?.timeline.tracks ?? [],
    [store.state.project],
  );
}


export function useProjectClips() {
  const store = useProjectStore();
  return useMemo(
    () => store.state.project?.timeline.clips ?? [],
    [store.state.project],
  );
}


export function useExportStatus() {
  const store = useProjectStore();
  return useMemo(
    () => store.state.exportRequested,
    [store.state.exportRequested],
  );
}


export function describeFrame(frame: number, project: ProjectDocument | null): string {
  return formatTimecode(frame, project ? project.video.frameRate.num / project.video.frameRate.den : 30);
}
