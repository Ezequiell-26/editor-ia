import { useCallback, useEffect, useState } from 'react';
import { StartScreen } from './features/start/StartScreen';
import {
  emitAppReady,
  isBackgroundStartMode,
  onAppShowRequested,
} from './platform/tauri/app';
import { enterEditorWindowMode, setupCompactWindow } from './platform/tauri/window';
import { BrowserModeBanner } from './components/BrowserModeBanner';
import { NAV_VIEWS, type ViewId } from './app/navigation';
import { AppearanceProvider } from './state/AppearanceProvider';
import { createDesktopService, detectNativeRuntime, type DesktopService } from './services/project-service';
import { ProjectProvider } from './state/project-store';
import { McpBridgeRuntime } from './features/assistant/McpBridgeRuntime';
import { useEditorPreferences } from './state/useEditorPreferences';
import { FlowQueueProvider } from './state/FlowQueueProvider';

import { Shell } from './app/Shell';


interface AppProps {
  readonly service?: DesktopService;
  readonly initialShowStart?: boolean;
}

export function App({ service: suppliedService, initialShowStart }: AppProps) {
  const [service] = useState<DesktopService>(() => suppliedService ?? createDesktopService());
  const editorPreferences = useEditorPreferences();
  const deepView = (() => {
    if (typeof window === 'undefined') return null;
    const requested = new URLSearchParams(window.location.search).get('view');
    return requested && NAV_VIEWS.some((view) => view.id === requested)
      ? (requested as ViewId)
      : null;
  })();
  const [showStart, setShowStart] = useState(() => {
    if (typeof initialShowStart === 'boolean') return initialShowStart;
    if (deepView) return false;
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
      return false;
    }
    return true;
  });
  const [initialView, setInitialView] = useState<ViewId>(deepView ?? 'home');
  const [backgroundMode, setBackgroundMode] = useState(false);

  // El modo background arranca MCP sin renderizar StartScreen ni Editor.
  useEffect(() => {
    if (!detectNativeRuntime()) return;
    let active = true;
    void isBackgroundStartMode()
      .then((background) => {
        if (!active || !background) return;
        setBackgroundMode(true);
        setShowStart(false);
      });
    return () => { active = false; };
  }, []);

  // La bandeja puede volver a mostrar la UI sin reiniciar el servidor MCP.
  useEffect(() => {
    if (!detectNativeRuntime()) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    void onAppShowRequested(() => {
      setBackgroundMode(false);
      setShowStart(false);
    }).then((off) => {
      if (active) unlisten = off;
      else off();
    });
    return () => { active = false; unlisten?.(); };
  }, []);

  // Conserva una navegacion MCP solicitada mientras la ventana esta oculta.
  useEffect(() => {
    const onMcpNavigate = (event: Event) => {
      const view = (event as CustomEvent<unknown>).detail;
      if (typeof view === 'string' && NAV_VIEWS.some((item) => item.id === view)) setInitialView(view as ViewId);
    };
    window.addEventListener('olyvia:mcp:navigate', onMcpNavigate);
    return () => window.removeEventListener('olyvia:mcp:navigate', onMcpNavigate);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.emojiStyle = editorPreferences.emojiStyle;
  }, [editorPreferences.emojiStyle]);

  // Aviso al backend que la interfaz ya montó: es la señal para cerrar el
  // splash y mostrar la ventana principal.
  useEffect(() => {
    if (!detectNativeRuntime()) return;
    void emitAppReady();
  }, []);

  const handleEnterApp = useCallback((view: ViewId) => {
    setInitialView(view);
    setShowStart(false);
    enterEditorWindowMode();
  }, []);

  const handleReturnToStart = useCallback(() => {
    setShowStart(true);
    setupCompactWindow();
  }, []);

  return (
    <AppearanceProvider>
      <ProjectProvider service={service}>
        {/* La cola de Flow vive por encima de las vistas: una corrida larga no
            debe cortarse al cambiar de pantalla. */}
        <FlowQueueProvider>
          <McpBridgeRuntime />
          {backgroundMode ? null : showStart ? (
            <StartScreen
              onEnterApp={handleEnterApp}
              banner={
                !service.available ? (
                  <BrowserModeBanner reason={service.unavailableReason} />
                ) : null
              }
            />
          ) : (
            <Shell initialView={initialView} onReturnToStart={handleReturnToStart} />
          )}
        </FlowQueueProvider>
      </ProjectProvider>
    </AppearanceProvider>
  );
}