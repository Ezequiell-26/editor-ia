import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AppShell } from './components/AppShell';
import { WelcomeDialog } from './components/WelcomeDialog';
import type { ViewId } from './app/navigation';
import { ProjectHome } from './features/projects/ProjectHome';
import { ProductionView } from './features/production/ProductionView';
import { FactoryView } from './features/factory/FactoryView';
import { DirectorView } from './features/director/DirectorView';
import { EditorWorkspace } from './features/editor/EditorWorkspace';
import { ScriptView } from './features/script/ScriptView';
import { AssetsPanel } from './features/assets/AssetsPanel';
import { ConvertView } from './features/convert/ConvertView';
import { LearnView } from './features/learn/LearnView';
import { McpView } from './features/mcp/McpView';
import { SettingsHome } from './features/settings/SettingsHome';
import { AppearanceProvider } from './state/AppearanceProvider';
import { duplicateClip, totalFrames } from './state/project-actions';
import {
  createDesktopService,
  detectNativeRuntime,
  type DesktopService,
} from './services/project-service';
import { ProjectProvider, useProjectStore } from './state/project-store';

interface AppProps {
  readonly service?: DesktopService;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}

function Shell() {
  const [activeId, setActiveId] = useState<ViewId>('projects');
  const store = useProjectStore();
  const project = store.state.project;
  const storeRef = useRef(store);
  storeRef.current = store;
  const saveNow = store.saveNow;

  useEffect(() => {
    document.title = project ? `${project.name} — Editor IA` : 'Editor IA';
  }, [project]);

  useEffect(() => {
    if (!detectNativeRuntime()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const appWindow = getCurrentWindow();
    void appWindow
      .onCloseRequested(async (event) => {
        const snapshot = storeRef.current.state;
        if (!snapshot.project) {
          return;
        }
        if (snapshot.phase !== 'dirty' && snapshot.phase !== 'failed') {
          if (snapshot.phase === 'saving') {
            event.preventDefault();
            storeRef.current.setNotice('El proyecto se está guardando; esperá un instante y cerrá de nuevo.');
          }
          return;
        }
        event.preventDefault();
        const saved = await saveNow();
        if (saved && !disposed) {
          await appWindow.destroy();
        }
      })
      .then((off) => {
        if (disposed) {
          off();
        } else {
          unlisten = off;
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [saveNow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (command && key === 's') {
        event.preventDefault();
        if (event.shiftKey) {
          void store.saveAs();
        } else {
          void store.saveNow();
        }
        return;
      }
      if (command && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          store.redo();
        } else {
          store.undo();
        }
        return;
      }
      if (command && key === 'o') {
        event.preventDefault();
        void store.openProject().then((ok) => {
          if (ok) setActiveId('editor');
        });
        return;
      }
      if (command && key === 'e') {
        if (!project?.timeline.clips.length) return;
        event.preventDefault();
        setActiveId('editor');
        store.requestExport();
        return;
      }
      if (command && key === 'd') {
        const selection = store.state.selection;
        if (selection.kind !== 'clip') return;
        event.preventDefault();
        const copy = store.mutate((current) => {
          const result = duplicateClip(current, selection.id);
          if (!result) throw new Error('no se pudo duplicar el clip');
          return result;
        });
        if (copy) {
          store.setSelection({ kind: 'clip', id: copy.clipId });
          store.setPlayhead(Math.min(store.state.playheadFrame, totalFrames(copy.project)));
        }
        return;
      }
      if (event.key === 'Escape') {
        store.setSelection({ kind: 'none' });
        return;
      }
      if (event.code === 'Space') {
        if (!project) return;
        event.preventDefault();
        store.setPlaying(!store.state.playing);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [project, store]);

  const navigate = useCallback((id: ViewId) => {
    setActiveId(id);
  }, []);

  const content = (() => {
    switch (activeId) {
      case 'projects':
        return <ProjectHome onNavigate={navigate} />;
      case 'director':
        return <DirectorView onNavigate={navigate} />;
      case 'production':
        return <ProductionView onNavigate={navigate} />;
      case 'factory':
        return <FactoryView onNavigate={navigate} />;
      case 'editor':
        return <EditorWorkspace onNavigate={navigate} />;
      case 'script':
        return <ScriptView onNavigate={navigate} />;
      case 'assets':
        return <AssetsPanel onNavigate={navigate} />;
      case 'convert':
        return <ConvertView onNavigate={navigate} />;
      case 'learn':
        return <LearnView onNavigate={navigate} />;
      case 'mcp':
        return <McpView />;
      case 'settings':
        return <SettingsHome />;
    }
  })();

  return (
    <>
      <AppShell
        activeId={activeId}
        onSelect={navigate}
        content={content}
        flush={
          activeId === 'editor' ||
          activeId === 'script' ||
          activeId === 'assets' ||
          activeId === 'production' ||
          activeId === 'factory' ||
          activeId === 'director' ||
          activeId === 'convert' ||
          activeId === 'mcp'
        }
      />
      <WelcomeDialog onNavigate={navigate} />
    </>
  );
}

export function App({ service = createDesktopService() }: AppProps) {
  return (
    <AppearanceProvider>
      <ProjectProvider service={service}>
        <Shell />
      </ProjectProvider>
    </AppearanceProvider>
  );
}
