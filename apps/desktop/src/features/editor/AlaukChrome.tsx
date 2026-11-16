import { memo, useEffect, useMemo, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import type { EditorModeId } from '../../app/view-routing';
import { Icon } from '../../components/Icon';
import { WindowControls } from '../../components/WindowControls';
import { useProjectClips, useProjectStore } from '../../state/project-store';

/**
 * UN SOLO EDITOR · chrome visual AlaukCut de `EditorWorkspace` en TODOS los
 * modos: barra superior de acciones reales + pie de estado. Misma geometría
 * que `.me-topbar`/`.me-footer` del shell mínimo, pero con clases propias
 * (`.alauk-*`) para no pelear con los layouts del workspace. El toggle de
 * vista sólo se muestra en `timeline`, que es el único modo con la geometría
 * de referencia de tres columnas que ese control alterna.
 *
 * Sólo acciones REALES: cada botón ejecuta una operación existente
 * (navegación, diálogo de atajos, solicitud de exportación del store,
 * cambio de modo). Nada de maqueta.
 *
 * P8-b · «Herramientas»: en modo timeline el ribbon de pestañas queda oculto
 * por la composición de referencia y el rail clásico ya no se muestra. Este
 * botón es la puerta directa al modo «Todo» (mapa de herramientas) DESDE la
 * barra del editor: ninguna herramienta de la app queda sin acceso dentro
 * del editor unificado.
 */

const SKIN_KEY = 'olyvia:editor-skin';

/**
 * Alterna entre la composición de referencia (capturas 146–160) y el chrome
 * completo del editor. La capa de referencia oculta controles que las fotos
 * no muestran (herramientas de preview, árbol de categorías, barra flotante
 * de la timeline); este toggle los devuelve sin recargar para que ninguna
 * función quede inaccesible. La preferencia se guarda en localStorage.
 */
function useEditorSkin(): { readonly fullChrome: boolean; readonly toggle: () => void } {
  const [fullChrome, setFullChrome] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(SKIN_KEY) === 'full';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (fullChrome) {
      document.documentElement.dataset.editorSkin = 'full';
    } else {
      delete document.documentElement.dataset.editorSkin;
    }
    try {
      localStorage.setItem(SKIN_KEY, fullChrome ? 'full' : 'reference');
    } catch {
      // Sin almacenamiento (incógnito / Tauri restringido): el toggle sigue
      // vigente en memoria durante la sesión.
    }
  }, [fullChrome]);

  return { fullChrome, toggle: () => setFullChrome((value) => !value) };
}

function useSaveState(): string {
  const store = useProjectStore();
  const phase = store.state.phase;
  const lastSavedAt = store.state.lastSavedAt;
  return useMemo(() => {
    switch (phase) {
      case 'saved':
        return `✓ Salvo automáticamente: ${new Date(lastSavedAt ?? Date.now()).toLocaleTimeString('pt-BR')}`;
      case 'saving':
        return 'Salvando…';
      case 'dirty':
        return 'Alterações não salvas';
      case 'failed':
        return 'Falha ao salvar';
      default:
        return '';
    }
  }, [phase, lastSavedAt]);
}

export const AlaukTopBar = memo(function AlaukTopBar({
  onNavigate,
  onOpenShortcuts,
  onAutoEdit,
  onOpenTools,
  onOpenPalette,
  showSkinToggle = true,
}: {
  readonly onNavigate: (id: ViewId) => void;
  readonly onOpenShortcuts?: (() => void) | undefined;
  /** «Edição automática» de AlaukCut → modo auto-edit del mismo editor. */
  readonly onAutoEdit?: (() => void) | undefined;
  /** «Herramientas» → modo «Todo» del MISMO editor (mapa de herramientas). */
  readonly onOpenTools?: (() => void) | undefined;
  /** Paleta de comandos (Ctrl+K) — la topbar global se oculta en este modo. */
  readonly onOpenPalette?: (() => void) | undefined;
  /** Sólo `timeline` tiene la geometría de referencia que alterna este control. */
  readonly showSkinToggle?: boolean;
}) {
  const store = useProjectStore();
  const project = store.state.project;
  const saveState = useSaveState();
  const skin = useEditorSkin();

  return (
    <div className="alauk-topbar" role="toolbar" aria-label="Barra del editor">
      <div className="alauk-topbar-left">
        <button
          type="button"
          className="alauk-projects-btn"
          onClick={() => onNavigate('projects')}
          title="Volver a projetos"
        >
          <Icon name="folder" size={11} /> Projetos
        </button>
        {saveState ? <span className="alauk-save-state">{saveState}</span> : null}
      </div>
      <span className="alauk-topbar-project">{project?.name ?? ''}</span>
      <div className="alauk-topbar-right">
        {/* Acciones globales que vivían en la topbar del AppShell: al ser
            ésa la única barra visible en modo timeline, sus funciones
            esenciales (deshacer/rehacer/guardar/buscar/ajustes/ventana)
            se conservan acá — ninguna queda huérfana. */}
        <button
          type="button"
          className="alauk-icon-btn"
          aria-label="Deshacer"
          title="Deshacer · Ctrl+Z"
          onClick={store.undo}
          disabled={!store.canUndo}
        >
          <Icon name="undo" size={13} />
        </button>
        <button
          type="button"
          className="alauk-icon-btn"
          aria-label="Rehacer"
          title="Rehacer · Ctrl+Shift+Z"
          onClick={store.redo}
          disabled={!store.canRedo}
        >
          <Icon name="redo" size={13} />
        </button>
        <button
          type="button"
          className="alauk-icon-btn"
          aria-label="Guardar"
          title={store.state.phase === 'saving' ? 'Guardando…' : 'Guardar · Ctrl+S'}
          onClick={() => void store.saveNow()}
          disabled={!project || store.state.phase === 'saving'}
        >
          <Icon name="save" size={13} />
        </button>
        {onOpenPalette ? (
          <button
            type="button"
            className="alauk-icon-btn"
            aria-label="Buscar o ejecutar un comando"
            title="Buscar · Ctrl+K"
            onClick={onOpenPalette}
          >
            <Icon name="search" size={13} />
          </button>
        ) : null}
        {onOpenTools ? (
          <button
            type="button"
            className="alauk-text-btn"
            onClick={onOpenTools}
            title="Todas las herramientas dentro del editor"
          >
            <Icon name="layers" size={12} /> Herramientas
          </button>
        ) : null}
        {onAutoEdit ? (
          <button type="button" className="alauk-text-btn" onClick={onAutoEdit} title="Análisis y montaje automático">
            <Icon name="sparkles" size={12} /> Edição automática
          </button>
        ) : null}
        {onOpenShortcuts ? (
          <button type="button" className="alauk-text-btn" onClick={onOpenShortcuts} title="Atalhos de teclado">
            <Icon name="keyboard" size={12} /> Atalhos
          </button>
        ) : null}
        <button
          type="button"
          className="alauk-export"
          onClick={() => store.requestExport()}
          title="Exportar"
        >
          <Icon name="download" size={12} /> Exportar
        </button>
        {showSkinToggle ? (
          <button
            type="button"
            className="alauk-icon-btn"
            aria-label={skin.fullChrome ? 'Activar vista de referencia' : 'Mostrar todos los controles del editor'}
            aria-pressed={skin.fullChrome}
            title={
              skin.fullChrome
                ? 'Volver a la vista de referencia (capturas 146–160)'
                : 'Mostrar todos los controles del editor (vista completa)'
            }
            onClick={skin.toggle}
          >
            <Icon name="grid" size={13} />
          </button>
        ) : null}
        <button
          type="button"
          className="alauk-icon-btn"
          aria-label="Ajustes"
          title="Ajustes"
          onClick={() => onNavigate('settings')}
        >
          <Icon name="settings" size={13} />
        </button>
        <WindowControls />
      </div>
    </div>
  );
});

export const AlaukFooter = memo(function AlaukFooter() {
  const store = useProjectStore();
  const clips = useProjectClips();
  const assets = store.state.project?.assets ?? [];
  const saveState = useSaveState();

  return (
    <div className="alauk-footer">
      <span className="alauk-footer-status">
        {assets.length} {assets.length === 1 ? 'material' : 'materiales'} ·{' '}
        {clips.length} {clips.length === 1 ? 'clip' : 'clips'}
      </span>
      {saveState ? <span className="alauk-footer-save">{saveState}</span> : null}
    </div>
  );
});
