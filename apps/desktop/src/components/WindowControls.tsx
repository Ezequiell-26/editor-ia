import { useEffect, useState } from 'react';
import {
  closeMainWindow,
  isWindowMaximized,
  minimizeMainWindow,
  onWindowResized,
  toggleMaximizeWindow,
} from '../platform/tauri/window';
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
    void isWindowMaximized().then((value) => {
      if (active) setMaximized(value);
    });
    void onWindowResized(() => {
      void isWindowMaximized().then((value) => {
        if (active) setMaximized(value);
      });
    }).then((off) => {
      if (active) unlisten = off;
      else off();
    });
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
        onClick={minimizeMainWindow}
      >
        <Icon name="minus" size={14} />
      </button>
      <button
        type="button"
        className="window-control"
        aria-label={maximized ? 'Restaurar' : 'Maximizar'}
        data-tooltip={maximized ? 'Restaurar' : 'Maximizar'}
        onClick={() => {
          void toggleMaximizeWindow().then(setMaximized);
        }}
      >
        <Icon name={maximized ? 'restore' : 'maximize'} size={13} />
      </button>
      <button
        type="button"
        className="window-control close"
        aria-label="Cerrar ventana"
        data-tooltip="Cerrar ventana"
        onClick={closeMainWindow}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
