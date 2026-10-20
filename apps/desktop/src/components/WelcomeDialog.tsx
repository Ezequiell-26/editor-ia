import { useState } from 'react';
import type { ViewId } from '../app/navigation';
import { detectNativeRuntime } from '../services/project-service';
import { loadProfile } from '../state/profile';
import { useProjectStore } from '../state/project-store';
import { Icon } from './Icon';

const WELCOME_KEY = 'editor-ia.welcome.v1';

function seen(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_KEY) === 'seen';
  } catch {
    return true;
  }
}

export function WelcomeDialog({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const [open, setOpen] = useState(() => detectNativeRuntime() && !seen());
  const profile = loadProfile();

  if (!open) return null;

  function close(): void {
    try {
      window.localStorage.setItem(WELCOME_KEY, 'seen');
    } catch {
      // Without storage the dialog may reappear; it never blocks the app.
    }
    setOpen(false);
  }

  function go(view: ViewId): void {
    close();
    onNavigate(view);
  }

  return (
    <div className="app-modal-backdrop welcome-backdrop">
      <div className="app-modal welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <div className="welcome-mark" aria-hidden="true">
          <Icon name="sparkles" size={24} />
        </div>
        <p className="eyebrow">Bienvenido, {profile.name}</p>
        <h2 id="welcome-title">Crear video no tiene que ser complicado</h2>
        <p className="welcome-copy">
          Editor IA hace el trabajo pesado: analiza, corta, limpia la voz, subtitula y arma el
          montaje. Vos elegís el formato, los recursos y el destino. Todo queda en tu equipo.
        </p>
        <div className="welcome-options">
          <button type="button" className="welcome-option primary-option" onClick={() => go('projects')}>
            <Icon name="plus" size={20} />
            <span>
              <strong>Crear mi primer video</strong>
              <span>Nombre, formato y fps en un paso</span>
            </span>
          </button>
          <button type="button" className="welcome-option" onClick={() => go('learn')}>
            <Icon name="learn" size={20} />
            <span>
              <strong>Ver el tutorial completo</strong>
              <span>Cinco pasos y guía de cada herramienta</span>
            </span>
          </button>
          <button
            type="button"
            className="welcome-option"
            onClick={() => {
              close();
              void store.openProject().then((ok) => {
                if (ok) onNavigate('editor');
              });
            }}
          >
            <Icon name="projects" size={20} />
            <span>
              <strong>Abrir un proyecto</strong>
              <span>Retomá un .editoria.json existente</span>
            </span>
          </button>
        </div>
        <div className="welcome-foot">
          <span>Podés volver a esta guía desde Ayuda → Tutorial completo.</span>
          <button type="button" className="ghost" onClick={close}>
            Empezar por mi cuenta
          </button>
        </div>
      </div>
    </div>
  );
}
