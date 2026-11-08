import type { ReactNode } from 'react';
import type { ProjectDocument } from '@editor-ia/project-schema';
import type { DesktopService, OpenedProject } from '../services/project-service';
import type { IoRange } from './io-range';
import type { RecoverySnapshot } from './recovery';



/**
 * The single project store.
 *
 * All edits go through `mutate`: the recipe returns a new document, the store
 * validates it with the canonical schema, and only then adopts it and marks the
 * project dirty. A failed save never pretends to be a success, and a save that
 * completes while new edits exist keeps the new edits dirty.
 */

export type Selection =
  | { readonly kind: 'none' }
  | { readonly kind: 'clip'; readonly id: string }
  | { readonly kind: 'track'; readonly id: string }
  | { readonly kind: 'cue'; readonly id: string }
  | { readonly kind: 'asset'; readonly id: string }
  | { readonly kind: 'scene'; readonly id: string };


export type ProjectPhase = 'idle' | 'loading' | 'saved' | 'dirty' | 'saving' | 'failed';


export interface StoreState {
  project: ProjectDocument | null;
  opened: OpenedProject | null;
  phase: ProjectPhase;
  error: string | null;
  notice: string | null;
  undo: ProjectDocument[];
  redo: ProjectDocument[];
  selection: Selection;
  /**
   * Puntos de entrada/salida de la secuencia (port Kdenlive in/out): marcan el
   * rango que el export usa por defecto y que la regla muestra. Se persisten en
   * el documento como `x-ioRange` (ver `io-range.ts`); `null` hasta el primer
   * punto. Es estado de UI: no entra en el historial de deshacer.
   */
  ioRange: IoRange | null;
  lastSavedAt: string | null;
  exportRequested: boolean;
  /** Oferta de recuperaciâ”œâ”‚n de la sesiâ”œâ”‚n anterior, o null si no hay ninguna. */
  recoveryOffer: RecoverySnapshot | null;
}


export interface CreateProjectInput {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
}


export interface ProjectStoreValue {
  readonly state: StoreState;
  readonly service: DesktopService;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly durationFrames: number;
  readonly statusText: string;
  createProject(input: CreateProjectInput): Promise<boolean>;
  openProject(): Promise<boolean>;
  openProjectAt(path: string): Promise<boolean>;
  saveNow(): Promise<boolean>;
  saveAs(): Promise<boolean>;
  packageProject(): Promise<boolean>;
  closeProject(): void;
  /** Proyecto vivo del store, incluso antes del prâ”œâ”‚ximo render. */
  getProject(): ProjectDocument | null;
  mutate<T extends { project: ProjectDocument }>(
    recipe: (project: ProjectDocument) => T,
    options?: { readonly history?: boolean; readonly notice?: string },
  ): T | null;
  update(
    recipe: (project: ProjectDocument) => ProjectDocument,
    options?: { readonly history?: boolean; readonly notice?: string },
  ): boolean;
  undo(): void;
  redo(): void;
  setSelection(selection: Selection): void;
  /** Marca in/out de la secuencia en el playhead actual. */
  setIoPoint(edge: 'in' | 'out'): void;
  clearIoRange(): void;
  setPlayhead(frame: number): void;
  setPlaying(playing: boolean): void;
  /** Sentido del shuttle: 1 hacia adelante, -1 hacia atrás. */
  setPlaybackDirection(direction: 1 | -1): void;
  /** Multiplicador de la velocidad de reproducción (0.1–8). */
  setPlaybackRate(rate: number): void;
  /** Playhead actual sin suscribir el componente (siempre fresco). */
  getPlayhead(): number;
  /** Estado de reproducciâ”œâ”‚n actual sin suscribir el componente. */
  getPlaying(): boolean;
  /** Sentido actual sin suscribir el componente. */
  getPlaybackDirection(): 1 | -1;
  /** Velocidad actual sin suscribir el componente. */
  getPlaybackRate(): number;
  requestExport(): void;
  consumeExportRequest(): void;
  /** Abre el proyecto de la oferta de recuperaciâ”œâ”‚n; false si no hay oferta o fallâ”œâ”‚. */
  acceptRecovery(): Promise<boolean>;
  /** Descarta la oferta: limpia la instantâ”œÃ­nea y vacâ”œÂ¡a el estado. */
  dismissRecovery(): void;
  clearError(): void;
  setNotice(notice: string | null): void;
}


export interface ProjectProviderProps {
  readonly service: DesktopService;
  readonly children: ReactNode;
  readonly initial?: {
    readonly project: ProjectDocument;
    readonly opened?: OpenedProject | null;
  };
}

