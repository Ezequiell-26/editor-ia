import { useEffect, useRef, useState } from 'react';
import type { ViewId } from '../app/navigation';
import { WORKSPACE_STEP_COUNT, WORKSPACE_STEPS } from '../app/workspace-map';
import { detectNativeRuntime } from '../services/project-service';
import { loadProfile } from '../state/profile';
import { useProjectStore } from '../state/project-store';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { Icon } from './Icon';
import { PandaGuide } from './PandaGuide';

const WELCOME_KEY = 'editor-ia.welcome.v1';

/**
 * Los consejos de Pando NO definen pasos propios: el primero es el saludo y
 * los siguientes narran las mismas seis etapas de `WORKSPACE_STEPS`. Así la
 * primera ejecución muestra el recorrido único y no una quinta variante.
 */
const PANDA_SLIDES = [
  {
    title: 'Hola, soy Pando.',
    detail: 'Te acompaño por la app. Elegí una opción y seguimos juntos.',
  },
  ...WORKSPACE_STEPS.map((step, index) => ({
    title: `Paso ${index + 1}: ${step.label}`,
    detail: step.tip,
  })),
] as const;

function seen(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_KEY) === 'seen';
  } catch {
    return true;
  }
}

export function WelcomeDialog({
  onNavigate,
  onOpenTour,
}: {
  readonly onNavigate: (id: ViewId) => void;
  /** Abre el tour guiado: recorre las mismas seis etapas con spotlight. */
  readonly onOpenTour?: () => void;
}) {
  const store = useProjectStore();
  const [open, setOpen] = useState(() => detectNativeRuntime() && !seen());
  const [tip, setTip] = useState(0);
  const profile = loadProfile();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Trampa de foco (auditoría de accesibilidad, H1/H2): guarda el disparador,
  // enfoca el primer control del panel, atrapa Tab y cierra con Escape
  // (guardando "vista" como el resto de los cierres). El componente vive
  // montado aunque el diálogo no esté en pantalla: `active` lo cubre.
  useDialogFocus({
    containerRef: dialogRef,
    active: open,
    onClose: close,
  });

  useEffect(() => {
    if (!open) return;
    const handle = window.setInterval(() => {
      setTip((current) => (current + 1) % PANDA_SLIDES.length);
    }, 6500);
    return () => window.clearInterval(handle);
  }, [open]);

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

  const tipCopy = PANDA_SLIDES[tip] ?? PANDA_SLIDES[0];

  function startTour(): void {
    close();
    onOpenTour?.();
  }

  return (
    <div className="app-modal-backdrop welcome-backdrop">
      <div
        className="app-modal welcome-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
      >
        <div className="welcome-panda">
          <PandaGuide message={tipCopy.title} detail={tipCopy.detail} />
          <button
            type="button"
            className="icon-button"
            aria-label="Siguiente consejo de Pando"
            title="Siguiente consejo"
            onClick={() => setTip((current) => (current + 1) % PANDA_SLIDES.length)}
          >
            <Icon name="chevron" size={15} />
          </button>
        </div>
        <p className="eyebrow">Bienvenido, {profile.name}</p>
        <h2 id="welcome-title">Crear video no tiene que ser complicado</h2>
        <p className="welcome-copy">
          Olyvia hace el trabajo pesado: analiza, corta, limpia la voz, subtitula y arma el
          montaje. Vos elegís el formato, los recursos y el destino. Todo queda en tu equipo.
        </p>
        <ol className="welcome-journey" aria-label="El recorrido de producción">
          {WORKSPACE_STEPS.map((step, index) => (
            <li key={step.id}>
              <span className="welcome-journey-num" aria-hidden="true">
                {index + 1}
              </span>
              <strong>{step.label}</strong>
            </li>
          ))}
        </ol>
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
              <span>
                {WORKSPACE_STEP_COUNT} pasos del recorrido y guía de cada herramienta
              </span>
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
        {onOpenTour ? (
          <button type="button" className="link-button welcome-tour-link" onClick={startTour}>
            <Icon name="learn" size={13} />
            Ver el recorrido guiado, paso a paso
          </button>
        ) : null}
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
