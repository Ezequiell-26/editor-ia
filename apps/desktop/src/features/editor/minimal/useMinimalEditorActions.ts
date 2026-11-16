import { useCallback, useEffect, useState } from 'react';
import type { ViewId } from '../../../app/navigation';
import { sanitizeForUi } from '../../../platform/tauri/shared';
import { addAsset, markAssetReady } from '../../../state/assets-actions';
import { updateEditorPreferences } from '../../../state/editor-preferences';
import { useEditorPreferences } from '../../../state/useEditorPreferences';
import { addMarker } from '../../../state/markers';
import {
  addTrack, deleteClip, duplicateClip, splitClip,
} from '../../../state/project-actions';
import { useProjectStore } from '../../../state/project-store';
import {
  ACTION_VIEWS, clampZoom, resolveAction, ZOOM_DEFAULT, ZOOM_STEP,
  type EditorAction,
} from './editor-actions';

/**
 * Operaciones reales detrás de la superficie mínima. Antes de este módulo los
 * controles sólo cambiaban de «escena» de demostración; acá cada uno actúa
 * sobre el store del proyecto, navega a una vista real o abre un diálogo
 * existente. No se crea ninguna API nueva: se reutilizan las acciones puras y
 * los contratos de `services/`.
 */

const RIGHTS_KEY = 'olyvia.editor.rightsConfirmed';
const NOTICE_MS = 3200;

function readRightsConsent(): boolean {
  try {
    return localStorage.getItem(RIGHTS_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeRightsConsent(): void {
  try {
    localStorage.setItem(RIGHTS_KEY, 'true');
  } catch {
    // Almacenamiento deshabilitado: el consentimiento vale sólo esta sesión.
  }
}

export interface MinimalEditorCallbacks {
  readonly onNavigate?: ((id: ViewId) => void) | undefined;
  readonly onOpenShortcuts?: (() => void) | undefined;
  readonly onOpenTour?: (() => void) | undefined;
  readonly onOpenHistory?: (() => void) | undefined;
  readonly onOpenAssistant?: (() => void) | undefined;
}

export interface MinimalEditorActions {
  readonly notice: string | null;
  readonly dismissNotice: () => void;
  readonly zoom: number;
  readonly snapEnabled: boolean;
  readonly consentOpen: boolean;
  readonly selectedClipId: string | null;
  readonly requestImport: () => void;
  readonly confirmImport: () => void;
  readonly cancelImport: () => void;
  readonly runAction: (action: EditorAction) => void;
  readonly runLabel: (label: string) => void;
  readonly stepFrame: (delta: number) => void;
  readonly selectClip: (id: string) => void;
}

export function useMinimalEditorActions(
  callbacks: MinimalEditorCallbacks = {},
): MinimalEditorActions {
  const store = useProjectStore();
  const preferences = useEditorPreferences();
  const [notice, setNotice] = useState<string | null>(null);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [consentOpen, setConsentOpen] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(readRightsConsent);

  // El aviso se retira solo y el temporizador se limpia al desmontar: evita
  // dejar intervalos/colgados vivos cuando el usuario cambia de vista.
  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const showNotice = useCallback((message: string) => {
    const safe = sanitizeForUi(message);
    setNotice(safe);
    store.setNotice(safe);
  }, [store]);

  const importMedia = useCallback(async () => {
    const project = store.getProject();
    const fpsNum = project?.video.frameRate.num ?? 30;
    const fpsDen = project?.video.frameRate.den ?? 1;
    try {
      const outcome = await store.service.importAssets(fpsNum, fpsDen);
      if (!outcome || outcome.assets.length === 0) {
        showNotice(outcome?.warnings[0] ?? 'No se seleccionó ningún archivo.');
        return;
      }
      const count = outcome.assets.length;
      const applied = store.mutate(
        (current) => {
          let next = current;
          for (const asset of outcome.assets) {
            next = addAsset(next, asset);
            next = markAssetReady(next, asset.id, 'allowed');
          }
          return { project: next };
        },
        { notice: `${count} medio(s) importados al proyecto.` },
      );
      if (!applied) {
        showNotice('No se pudo agregar el material al proyecto.');
      } else if (outcome.warnings.length > 0) {
        showNotice(outcome.warnings.join(' · '));
      }
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'La importación falló.');
    }
  }, [store, showNotice]);

  const requestImport = useCallback(() => {
    if (rightsConfirmed) {
      void importMedia();
      return;
    }
    setConsentOpen(true);
  }, [rightsConfirmed, importMedia]);

  const confirmImport = useCallback(() => {
    writeRightsConsent();
    setRightsConfirmed(true);
    setConsentOpen(false);
    void importMedia();
  }, [importMedia]);

  const cancelImport = useCallback(() => setConsentOpen(false), []);

  const stepFrame = useCallback((delta: number) => {
    store.setPlayhead(Math.max(0, store.getPlayhead() + delta));
  }, [store]);

  const selectClip = useCallback((id: string) => {
    store.setSelection({ kind: 'clip', id });
  }, [store]);

  const navigate = useCallback((action: EditorAction): void => {
    const view = ACTION_VIEWS[action];
    if (!view) return;
    if (callbacks.onNavigate) {
      callbacks.onNavigate(view);
      return;
    }
    // Sin composition root (arnés de tests) la operación no puede navegar;
    // se informa en vez de fingir que ocurrió.
    showNotice(`Abrí ${view} desde el menú principal de Olyvia.`);
  }, [callbacks.onNavigate, showNotice]);

  const runAction = useCallback((action: EditorAction): void => {
    switch (action) {
      case 'toggle-play':
        store.setPlaying(!store.getPlaying());
        return;
      case 'step-back':
        stepFrame(-1);
        return;
      case 'step-forward':
        stepFrame(1);
        return;
      case 'undo':
        store.undo();
        return;
      case 'redo':
        store.redo();
        return;
      case 'split': {
        const selection = store.state.selection;
        if (selection.kind !== 'clip') {
          showNotice('Seleccioná un clip en la timeline antes de dividirlo.');
          return;
        }
        const applied = store.mutate((current) => {
          const split = splitClip(current, selection.id, store.getPlayhead());
          if (!split) throw new Error('El cabezal no está dentro del clip seleccionado.');
          return { project: split.project };
        }, { notice: 'Clip dividido en el cabezal.' });
        if (!applied) showNotice('No se pudo dividir el clip.');
        return;
      }
      case 'delete': {
        const selection = store.state.selection;
        if (selection.kind !== 'clip') {
          showNotice('Seleccioná un clip en la timeline antes de borrarlo.');
          return;
        }
        store.mutate((current) => ({ project: deleteClip(current, selection.id) }), {
          notice: 'Clip eliminado.',
        });
        store.setSelection({ kind: 'none' });
        return;
      }
      case 'duplicate': {
        const selection = store.state.selection;
        if (selection.kind !== 'clip') {
          showNotice('Seleccioná un clip en la timeline antes de copiarlo.');
          return;
        }
        const applied = store.mutate((current) => {
          const copy = duplicateClip(current, selection.id);
          if (!copy) throw new Error('No se pudo copiar el clip en esa pista.');
          return { project: copy.project };
        }, { notice: 'Clip copiado a continuación.' });
        if (!applied) showNotice('No se pudo copiar el clip.');
        return;
      }
      case 'marker':
        store.mutate((current) => ({
          project: addMarker(current, store.getPlayhead()).project,
        }), { notice: 'Marcador agregado en el cabezal.' });
        return;
      case 'add-track':
        store.mutate((current) => ({ project: addTrack(current, 'video').project }), {
          notice: 'Pista de video agregada.',
        });
        return;
      case 'snap': {
        const next = !preferences.snapEnabled;
        updateEditorPreferences({ snapEnabled: next });
        showNotice(next ? 'Imán activado.' : 'Imán desactivado.');
        return;
      }
      case 'deselect':
        store.setSelection({ kind: 'none' });
        return;
      case 'zoom-in':
        setZoom((current) => clampZoom(current + ZOOM_STEP));
        return;
      case 'zoom-out':
        setZoom((current) => clampZoom(current - ZOOM_STEP));
        return;
      case 'zoom-fit':
        setZoom(ZOOM_DEFAULT);
        return;
      case 'open-shortcuts':
        callbacks.onOpenShortcuts?.();
        return;
      case 'open-tour':
        callbacks.onOpenTour?.();
        return;
      case 'open-history':
        callbacks.onOpenHistory?.();
        return;
      case 'open-assistant':
        callbacks.onOpenAssistant?.();
        return;
      case 'generate-captions':
        showNotice('Se abrió el generador de subtítulos de Olyvia.');
        navigate(action);
        return;
      case 'capture-frame':
      case 'navigate-text':
      case 'navigate-settings':
      case 'navigate-tracking':
      case 'navigate-record':
      case 'navigate-lab':
      case 'navigate-auto-edit':
      case 'navigate-projects':
      case 'navigate-vfx':
      case 'navigate-captions':
      case 'navigate-motion':
      case 'navigate-color':
      case 'navigate-assets':
        navigate(action);
        return;
    }
  }, [store, preferences.snapEnabled, stepFrame, showNotice, navigate, callbacks]);

  const runLabel = useCallback((label: string): void => {
    const action = resolveAction(label);
    if (action) {
      runAction(action);
      return;
    }
    // UI-002: una etiqueta sin acción mapeada no puede quedar muda — se
    // declara en el aviso en vez de simular que el control funciona.
    showNotice(`«${label}» todavía no tiene una acción en este editor.`);
  }, [runAction, showNotice]);

  const selectedClipId = store.state.selection.kind === 'clip'
    ? store.state.selection.id
    : null;

  return {
    notice,
    dismissNotice: () => setNotice(null),
    zoom,
    snapEnabled: preferences.snapEnabled,
    consentOpen,
    selectedClipId,
    requestImport,
    confirmImport,
    cancelImport,
    runAction,
    runLabel,
    stepFrame,
    selectClip,
  };
}
