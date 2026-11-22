import { useCallback, useEffect, useRef, useState } from 'react';
import { createEmptyProject } from '@editor-ia/project-schema';
import { emitAppReady, isBackgroundStartMode, onAppShowRequested } from './platform/tauri/app';
import { enterEditorWindowMode, setupCompactWindow } from './platform/tauri/window';
import { NAV_VIEWS, type ViewId } from './app/navigation';
import { AppearanceProvider } from './state/AppearanceProvider';
import { BrowserModeBanner } from './components/BrowserModeBanner';
import { createDesktopService, detectNativeRuntime, type DesktopService } from './services/project-service';
import { ProjectProvider, useProjectStore } from './state/project-store';
import { McpBridgeRuntime } from './features/assistant/McpBridgeRuntime';
import { StartScreen } from './features/start/StartScreen';
import { useEditorPreferences } from './state/useEditorPreferences';
import { FlowQueueProvider } from './state/FlowQueueProvider';
import { useDualMonitorLink } from './state/dual-link';
import { suggestAiProjectName, useAiOnly } from './state/ai-mode';

import { Shell } from './app/Shell';


interface AppProps {
  readonly service?: DesktopService;
  readonly initialShowStart?: boolean;
}

/** Enlace con la ventana del monitor dual; hook dentro del provider. */
/**
 * El proyecto inicial nace en memoria para que el monitor aparezca de
 * inmediato, pero importar medios y correr el piloto exigen una sesión real
 * en disco. La creamos en segundo plano una sola vez, sin diálogo nativo.
 */
function AiDiskProjectBootstrap({ enabled }: { readonly enabled: boolean }) {
  const store = useProjectStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    if (!enabled || !storeRef.current.service.available) return;
    if (storeRef.current.state.opened) return;
    let disposed = false;
    void storeRef.current
      .createProject({
        name: suggestAiProjectName(),
        width: 1920,
        height: 1080,
        fpsNum: 30,
        fpsDen: 1,
      })
      .then((ok) => {
        if (!ok && !disposed) {
          storeRef.current.setNotice(
            'No se pudo crear el proyecto en disco: la IA no puede importar medios hasta guardar.',
          );
        }
      });
    return () => {
      disposed = true;
    };
  }, [enabled]);

  return null;
}

function DualMonitorLinkHost() {
  useDualMonitorLink();
  return null;
}

export function App({ service: suppliedService, initialShowStart }: AppProps) {
  const [service] = useState<DesktopService>(() => suppliedService ?? createDesktopService());
  const aiOnly = useAiOnly();
  // La superficie IA necesita un monitor real desde el primer frame: sin un
  // documento abierto el preview mostraba sólo un mensaje y la IA no podía
  // construir el video “delante” del usuario. Este proyecto vive en memoria
  // (sin ruta ni autoguardado) hasta que el usuario abra/guarde uno.
  const [initialProject] = useState(() =>
    aiOnly ? createEmptyProject('Proyecto IA', new Date().toISOString()) : null,
  );
  const editorPreferences = useEditorPreferences();
  const deepView = (() => {
    if (typeof window === 'undefined') return null;
    const requested = new URLSearchParams(window.location.search).get('view');
    return requested && NAV_VIEWS.some((view) => view.id === requested)
      ? (requested as ViewId)
      : null;
  })();
  // El arranque muestra el launcher (StartScreen) salvo deep link `?view=`,
  // modo background o test. Desde ahí se entra al ÚNICO editor; el launcher
  // crea/abre el proyecto y `Shell` resuelve cualquier vista a un panel del
  // mismo `EditorWorkspace`.
  const [showStart, setShowStart] = useState(() => {
    if (typeof initialShowStart === 'boolean') return initialShowStart;
    // Superficie IA-only: la app abre directo en el editor con el chat al lado.
    // Crear/abrir un proyecto se hace desde el propio chat.
    if (aiOnly) return false;
    if (deepView) return false;
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
      return false;
    }
    return true;
  });
  const [initialView, setInitialView] = useState<ViewId>(deepView ?? 'editor');
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
      })
      .catch(() => {});
    return () => {
      active = false;
    };
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
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  // Conserva una navegacion MCP solicitada mientras la ventana esta oculta.
  // El arranque en background ya no desmonta el editor: la ventana la oculta
  // el backend (`show_main_window` / tray), no un `return null` de React.
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

  // Una sola geometría de ventana: la del editor. Ya no hay modo «compacto»
  // de launcher ni transición entre dos formas de ventana.
  useEffect(() => {
    if (showStart || backgroundMode) return;
    enterEditorWindowMode();
  }, [showStart, backgroundMode]);

  const handleEnterApp = useCallback((view: ViewId) => {
    setInitialView(view);
    setShowStart(false);
  }, []);

  const handleReturnToStart = useCallback(() => {
    setShowStart(true);
    setupCompactWindow();
  }, []);

  return (
    <AppearanceProvider>
      <ProjectProvider
        service={service}
        {...(initialProject ? { initial: { project: initialProject } } : {})}
      >
        <AiDiskProjectBootstrap enabled={aiOnly} />
        {/* Publica proyecto + transporte al monitor dual si está abierto
            (`previa_dupla`); no hace nada hasta que la dual dice «hello». */}
        <DualMonitorLinkHost />
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
            /* ÚNICA PANTALLA: `Shell` -> `WorkspaceView` -> `EditorWorkspace`.
               No hay launcher activo ni rama que renderice null. */
            <Shell initialView={initialView} onReturnToStart={handleReturnToStart} />
          )}
        </FlowQueueProvider>
      </ProjectProvider>
    </AppearanceProvider>
  );
}
