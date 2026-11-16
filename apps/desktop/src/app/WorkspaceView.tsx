import { EditorWorkspace } from './view-registry';
import type { ViewId } from './navigation';
import { EDITOR_TOOL_HOSTS, editorModeForView, type EditorModeId } from './view-routing';

export interface WorkspaceViewProps {
  readonly id: ViewId;
  readonly toolActive: boolean;
  readonly toolView: ViewId | null;
  readonly toolTab: string | null;
  readonly toolRequest: number;
  readonly hasProject: boolean;
  readonly navigate: (id: ViewId) => void;
  readonly editorRequest: number;
  readonly clearTool: () => void;
  readonly handleModeChange: (mode: EditorModeId) => void;
  readonly openTour: () => void;
  readonly openShortcuts: () => void;
  readonly hubTab: string | null;
  readonly hubRequest: number;
  readonly editorMode: EditorModeId;
  /** Paleta de comandos global — la reenvía el chrome AlaukCut del editor. */
  readonly openPalette?: () => void;
}

/**
 * UN SOLO EDITOR: ya no existe una pantalla standalone por herramienta.
 * Toda `ViewId` termina montada dentro de `EditorWorkspace` — como modo de
 * flujo, como panel del modo «Todo» o como tab de editor — con o sin
 * proyecto abierto. Enmienda 2026-11-14: `settings` también se unificó;
 * ya NO hay excepciones de ventana flotante ni superficie propia.
 *
 * UN SOLO MONTAJE: todas las ramas de edición devuelven el MISMO fragmento
 * con `EditorWorkspace` en la primera posición. Antes la rama `editor`
 * devolvía un fragmento y las de herramienta el elemento suelto: React veía
 * tipos de raíz distintos y desmontaba/remontaba el editor entero (Preview,
 * Timeline, motores) al navegar. Con raíz idéntica la instancia de
 * `EditorWorkspace` — y todo lo que cuelga de ella — sobrevive a cualquier
 * cambio de vista/herramienta.
 */
export function WorkspaceView({ id, toolActive, toolView, toolTab, toolRequest, navigate, editorRequest, clearTool, handleModeChange, openTour, openShortcuts, hubTab, editorMode, openPalette }: WorkspaceViewProps) {
      // Panel de herramientas dentro del editor (modo «Todo»). `settings`
      // también resuelve acá: es un host de herramientas más.
      const toolPanel = toolActive && toolView !== null;

      // Las seis vistas de flujo tienen un modo propio dentro del editor.
      const embeddedMode = id !== 'editor' ? editorModeForView(id) : undefined;

      const initialMode: EditorModeId = toolPanel
        ? 'tools'
        : embeddedMode ?? (id === 'editor' ? editorMode : 'tools');
      const resolvedToolView = toolPanel
        ? toolView
        : embeddedMode === undefined && id !== 'editor' && EDITOR_TOOL_HOSTS.has(id)
          ? id
          : undefined;
      const resolvedToolTab = toolPanel ? toolTab : embeddedMode === undefined && id !== 'editor' ? hubTab : undefined;

      // P7 · UN SOLO EDITOR: el overlay `MinimalEditor` se retiró del camino
      // de producción — `EditorWorkspace` ES la superficie permanente (su
      // modo timeline ya lleva el chrome AlaukCut). El componente queda en
      // el repo sólo para el arnés de verificación de la réplica. La raíz
      // sigue siendo el fragmento para no cambiar la reconciliación.
      return (
        <>
          <EditorWorkspace
            onNavigate={navigate}
            initialMode={initialMode}
            modeRequest={editorRequest}
            {...(resolvedToolView ? { toolView: resolvedToolView } : {})}
            {...(resolvedToolTab ? { toolTab: resolvedToolTab } : {})}
            toolRequest={toolRequest}
            onClearTool={clearTool}
            onModeChange={handleModeChange}
            onOpenTour={openTour}
            onOpenShortcuts={openShortcuts}
            {...(openPalette ? { onOpenPalette: openPalette } : {})}
          />
        </>
      );
    }
