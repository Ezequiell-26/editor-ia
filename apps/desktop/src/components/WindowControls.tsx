import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { detectNativeRuntime } from '../services/project-service';
import { Icon } from './Icon';

/**
 * Custom window buttons for the borderless window. The close button emits the
 * same close request as the native titlebar, so the unsaved-changes guard in
 * App.tsx still runs.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const native = detectNativeRuntime();

  useEffect(() => {
    if (!native) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    const appWindow = getCurrentWindow();
    const sync = () => {
      void appWindow
        .isMaximized()
        .then((value) => {
          if (active) setMaximized(value);
        })
        .catch(() => {});
    };
    sync();
    void appWindow
      .onResized(sync)
      .then((off) => {
        if (active) unlisten = off;
        else off();
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, [native]);

  if (!native) return null;

  return (
    <div className="window-controls" role="group" aria-label="Controles de ventana">
      <button
        type="button"
        className="window-control"
        aria-label="Minimizar"
        data-tooltip="Minimizar"
        onClick={() => {
          void getCurrentWindow().minimize().catch(() => {});
        }}
      >
        <Icon name="minus" size={14} />
      </button>
      <button
        type="button"
        className="window-control"
        aria-label={maximized ? 'Restaurar' : 'Maximizar'}
        data-tooltip={maximized ? 'Restaurar' : 'Maximizar'}
        onClick={() => {
          void getCurrentWindow()
            .toggleMaximize()
            .then(() => getCurrentWindow().isMaximized())
            .then(setMaximized)
            .catch(() => {});
        }}
      >
        <Icon name={maximized ? 'restore' : 'maximize'} size={13} />
      </button>
      <button
        type="button"
        className="window-control close"
        aria-label="Cerrar ventana"
        data-tooltip="Cerrar ventana"
        onClick={() => {
          void getCurrentWindow().close().catch(() => {});
        }}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
