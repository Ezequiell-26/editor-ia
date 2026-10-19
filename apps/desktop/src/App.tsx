import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AppShell } from './components/AppShell';
import type { ViewId } from './app/navigation';
import { ProjectHome } from './features/projects/ProjectHome';
import { EditorWorkspace } from './features/editor/EditorWorkspace';
import { ScriptView } from './features/script/ScriptView';
import { AssetsPanel } from './features/assets/AssetsPanel';
import { SettingsHome } from './features/settings/SettingsHome';
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
      if (command && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void store.saveNow();
        return;
      }
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          store.redo();
        } else {
          store.undo();
        }
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
      case 'editor':
        return <EditorWorkspace onNavigate={navigate} />;
      case 'script':
        return <ScriptView onNavigate={navigate} />;
      case 'assets':
        return <AssetsPanel onNavigate={navigate} />;
      case 'settings':
        return <SettingsHome />;
    }
  })();

  return (
    <AppShell
      activeId={activeId}
      onSelect={navigate}
      content={content}
      flush={activeId === 'editor' || activeId === 'script' || activeId === 'assets'}
    />
  );
}

export function App({ service = createDesktopService() }: AppProps) {
  return (
    <ProjectProvider service={service}>
      <Shell />
    </ProjectProvider>
  );
}
