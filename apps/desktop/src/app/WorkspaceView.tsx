import {
  AiHubView,
  AssetsPanel,
  AutoEditView,
  CreatorHubView,
  DirectorView,
  DownloadsHubView,
  EditorWorkspace,
  HomeView,
  LearnView,
  McpView,
  MediaLabView,
  NodeGraphView,
  ProductionView,
  ScriptView,
  SettingsHome,
} from './view-registry';
import { ProjectHome } from '../features/projects/ProjectHome';
import type { ViewId } from './navigation';
import { editorModeForView, type EditorModeId } from './view-routing';

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
}

export function WorkspaceView({ id, toolActive, toolView, toolTab, toolRequest, hasProject, navigate, editorRequest, clearTool, handleModeChange, openTour, openShortcuts, hubTab, hubRequest, editorMode }: WorkspaceViewProps) {
      // T1 · UN SOLO EDITOR: con proyecto abierto, los 7 hosts y los 12 alias
      // a hubs se montan como PANEL del modo «Todo» (timeline siempre visible).
      if (toolActive && toolView !== null) {
        return (
          <EditorWorkspace
            onNavigate={navigate}
            initialMode="tools"
            modeRequest={editorRequest}
            toolView={toolView}
            {...(toolTab ? { toolTab } : {})}
            toolRequest={toolRequest}
            onClearTool={clearTool}
            onModeChange={handleModeChange}
            onOpenTour={openTour}
            onOpenShortcuts={openShortcuts}
          />
        );
      }
      // F2: las seis vistas de flujo tienen un modo propio dentro del editor.
      // Sin proyecto siguen siendo pantallas independientes con su empty-state.
      const embeddedMode = hasProject && id !== 'editor' ? editorModeForView(id) : undefined;
      if (embeddedMode) {
        return (
          <EditorWorkspace
            onNavigate={navigate}
            initialMode={embeddedMode}
            modeRequest={editorRequest}
            onModeChange={handleModeChange}
            onOpenTour={openTour}
            onOpenShortcuts={openShortcuts}
          />
        );
      }
      switch (id) {
        case 'home':
          return <HomeView onNavigate={navigate} />;
        case 'projects':
          return <ProjectHome onNavigate={navigate} />;
        case 'director':
          return <DirectorView onNavigate={navigate} />;
        case 'auto-edit':
          return <AutoEditView onNavigate={navigate} />;
        case 'production':
          return <ProductionView onNavigate={navigate} />;
        case 'creator':
          return (
            <CreatorHubView
              onNavigate={navigate}
              initialTab={hubTab ?? undefined}
              requestId={hubRequest}
            />
          );
        case 'editor':
          return (
            <EditorWorkspace
              onNavigate={navigate}
              initialMode={editorMode}
              modeRequest={editorRequest}
              onModeChange={handleModeChange}
              onOpenTour={openTour}
              onOpenShortcuts={openShortcuts}
            />
          );
        case 'lab':
          return (
            <MediaLabView
              onNavigate={navigate}
              initialTab={hubTab ?? undefined}
              requestId={hubRequest}
            />
          );
        case 'script':
          return <ScriptView onNavigate={navigate} />;
        case 'assets':
          return <AssetsPanel onNavigate={navigate} />;
        case 'download':
          return (
            <DownloadsHubView
              onNavigate={navigate}
              initialTab={hubTab ?? undefined}
              requestId={hubRequest}
            />
          );
        case 'ai-hub':
          return <AiHubView onNavigate={navigate} />;
        case 'learn':
          return (
            <LearnView
              onNavigate={navigate}
              onOpenTour={openTour}
              onOpenShortcuts={openShortcuts}
            />
          );
        case 'mcp':
          return <McpView />;
        case 'nodes':
          return <NodeGraphView onNavigate={navigate} />;
        case 'settings':
          return <SettingsHome />;
        default:
          // Una ViewId sin caso renderiza nada en silencio: avisar en
          // consola para que la regresión sea visible en desarrollo.
          console.warn(`[Olyvia] renderView sin caso para la vista «${id}»`);
          return null;
      }
    }
