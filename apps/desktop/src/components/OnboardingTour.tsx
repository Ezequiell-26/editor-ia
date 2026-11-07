import { useCallback, useEffect, useRef, useState } from'react';
import type { ViewId } from'../app/navigation';
import type { PipelineStageId } from'../app/pipeline';
import { WORKSPACE_STEPS } from'../app/workspace-map';
import { Icon } from'./Icon';
import { useDialogFocus } from'../hooks/useDialogFocus';

export const TOUR_COMPLETED_KEY ='olyvia.tour.completed.v1';

export interface TourStep {
  readonly id: string;
  readonly targetSelector: string;
  readonly fallbackSelector?: string;
  readonly view?: ViewId;
  readonly title: string;
  readonly subtitle: string;
  readonly content: string;
  readonly highlights: readonly string[];
  readonly proTip?: string;
}

/**
 * Ancla visual de cada etapa del recorrido único. Las vistas se resuelven con
 * `WORKSPACE_STEPS` (app/workspace-map.ts): el tour no define pasos propios,
 * sólo dice qué elemento de pantalla conviene iluminar en cada etapa.
 */
const TOUR_TARGETS: Readonly<
  Record<PipelineStageId, { readonly target: string; readonly fallback?: string }>
> = {
  project: { target:'.projects-view .project-toolbar', fallback:'.projects-view' },
  script: { target:'.script-view .view-toolbar', fallback:'.script-view' },
  media: { target:'.assets-view .view-toolbar', fallback:'.assets-view' },
  voice: { target:'.production-view .view-toolbar', fallback:'.production-view' },
  edit: { target:'[data-tour="timeline"]', fallback:'.timeline-panel' },
  export: { target:'[data-tour="export"]', fallback:'.topbar-export-btn' },
};

/** Los mismos seis pasos que Inicio, Aprender, la guía del editor y el tour. */
const TOUR_STEP_LIST: TourStep[] = WORKSPACE_STEPS.map((step) => {
  const target = TOUR_TARGETS[step.id];
  return {
    id: step.id,
    targetSelector: target.target,
    ...(target.fallback ? { fallbackSelector: target.fallback } : {}),
    view: step.view,
    title: step.label,
    subtitle: step.action,
    content: step.detail,
    highlights: [],
    proTip: step.tip,
  };
});

export const TOUR_STEPS = TOUR_STEP_LIST as [TourStep, ...TourStep[]];

export interface OnboardingTourProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onNavigate?: (view: ViewId) => void;
  readonly currentView?: ViewId;
}

interface TargetRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
}

export function OnboardingTour({ open, onClose, onNavigate, currentView }: OnboardingTourProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [windowDimensions, setWindowDimensions] = useState({
    width: typeof window !=='undefined'? window.innerWidth : 1200,
    height: typeof window !=='undefined'? window.innerHeight : 800,
  });
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const step = TOUR_STEPS[stepIndex] ?? TOUR_STEPS[0];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === TOUR_STEPS.length - 1;

  // Si el paso pide una vista particular y no estamos ahí, navegar suavemente
  useEffect(() => {
    if (!open) return;
    if (step.view && onNavigate && currentView !== step.view) {
      onNavigate(step.view);
    }
  }, [open, stepIndex, step.view, onNavigate, currentView]);

  // Medir el elemento objetivo en pantalla
  const updateTargetRect = useCallback(() => {
    if (!open) return;

    let element = document.querySelector<HTMLElement>(step.targetSelector);
    if (!element && step.fallbackSelector) {
      element = document.querySelector<HTMLElement>(step.fallbackSelector);
    }

    if (element) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setTargetRect({
          x: Math.max(0, rect.left),
          y: Math.max(0, rect.top),
          width: rect.width,
          height: rect.height,
          visible: true,
        });
        return;
      }
    }

    // Elemento no encontrado o no visible
    setTargetRect(null);
  }, [open, step.targetSelector, step.fallbackSelector]);

  // Actualizar rect en cambios de paso y resize
  useEffect(() => {
    if (!open) return;

    const handleResize = () => {
      setWindowDimensions({ width: window.innerWidth, height: window.innerHeight });
      updateTargetRect();
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', updateTargetRect, true);

    // Intentar ubicar el elemento de inmediato y tras un frame
    updateTargetRect();
    const handle = window.setTimeout(updateTargetRect, 80);
    const secondHandle = window.setTimeout(updateTargetRect, 250);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', updateTargetRect, true);
      window.clearTimeout(handle);
      window.clearTimeout(secondHandle);
    };
  }, [open, stepIndex, updateTargetRect]);

  // Manejo de foco y Escape
  useDialogFocus({
    containerRef: dialogRef,
    active: open,
    onClose: handleClose,
  });

  function handleClose(): void {
    if (dontShowAgain) {
      try {
        window.localStorage.setItem(TOUR_COMPLETED_KEY,'true');
      } catch {
        // Ignorar si el storage no está disponible
      }
    }
    onClose();
  }

  function handleNext(): void {
    if (isLastStep) {
      // Completar tour
      try {
        window.localStorage.setItem(TOUR_COMPLETED_KEY,'true');
      } catch {
        // Ignorar
      }
      onClose();
    } else {
      setStepIndex((curr) => curr + 1);
    }
  }

  function handlePrev(): void {
    setStepIndex((curr) => Math.max(0, curr - 1));
  }

  function handleSkip(): void {
    handleClose();
  }

  if (!open) return null;

  // Cálculo de posición de la tarjeta flotante
  const cardWidth = Math.min(440, windowDimensions.width - 32);
  const padding = 12;

  let cardStyle: React.CSSProperties;

  if (targetRect && targetRect.visible) {
    const targetCenterX = targetRect.x + targetRect.width / 2;
    const targetBottom = targetRect.y + targetRect.height;
    const targetTop = targetRect.y;

    // Calcular si colocar la tarjeta abajo o arriba del objetivo
    const spaceBelow = windowDimensions.height - targetBottom;
    const spaceAbove = targetTop;

    let top: number;
    if (spaceBelow >= 340 || spaceBelow >= spaceAbove) {
      // Poner abajo
      top = Math.min(windowDimensions.height - 360, targetBottom + padding);
    } else {
      // Poner arriba
      top = Math.max(padding, targetTop - 360 - padding);
    }

    // Centrar horizontalmente respecto al objetivo, cuidando bordes de ventana
    let left = targetCenterX - cardWidth / 2;
    left = Math.max(padding, Math.min(windowDimensions.width - cardWidth - padding, left));

    cardStyle = {
      top: `${top}px`,
      left: `${left}px`,
    };
  } else {
    // Si no hay target visible, centrar en pantalla
    cardStyle = {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }

  return (
    <div
      className="tour-overlay-container"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      {/* SVG Spotlight Mask */}
      <svg
        className="tour-svg-backdrop"
        width={windowDimensions.width}
        height={windowDimensions.height}
        viewBox={`0 0 ${windowDimensions.width} ${windowDimensions.height}`}
        aria-hidden="true"
      >
        <defs>
          <mask id="tour-spotlight-mask">
            {/* Fondo blanco completo (visible) */}
            <rect x="0"y="0"width="100%"height="100%"fill="white"/>
            {/* Recorte negro donde está el objetivo (transparente) */}
            {targetRect && targetRect.visible && (
              <rect
                x={targetRect.x - 4}
                y={targetRect.y - 4}
                width={targetRect.width + 8}
                height={targetRect.height + 8}
                rx="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        {/* Capa oscurecedora con máscara */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(3, 7, 18, 0.78)"
          mask="url(#tour-spotlight-mask)"
        />
      </svg>

      {/* Ring iluminado alrededor del objetivo */}
      {targetRect && targetRect.visible && (
        <div
          className="tour-spotlight-ring"
          style={{
            top: `${targetRect.y - 4}px`,
            left: `${targetRect.x - 4}px`,
            width: `${targetRect.width + 8}px`,
            height: `${targetRect.height + 8}px`,
          }}
          aria-hidden="true"
        />
      )}

      {/* Tarjeta interactiva del paso */}
      <div
        className="tour-card"
        style={cardStyle}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-title"
      >
        <header className="tour-card-header">
          <div>
            <span className="tour-step-badge">
              <span>Paso {stepIndex + 1} de {TOUR_STEPS.length}</span>
            </span>
            <h2 id="tour-step-title"className="tour-card-title">
              {step.title}
            </h2>
            <p className="tour-card-subtitle">{step.subtitle}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Cerrar tour (Esc)"
            data-tooltip="Cerrar tour"
            onClick={handleClose}
          >
            <Icon name="close"size={15} />
          </button>
        </header>

        <div className="tour-card-content">
          <p style={{ margin: '0 0 10px'}}>{step.content}</p>

          {step.highlights.length > 0 && (
            <ul className="tour-highlights-list">
              {step.highlights.map((item, idx) => (
                <li key={idx} className="tour-highlight-item">
                  <span className="tour-highlight-bullet" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}

          {step.proTip && (
            <div className="tour-protip-box"style={{ marginTop: '12px'}}>
              <Icon name="info"size={16} />
              <span>{step.proTip}</span>
            </div>
          )}
        </div>

        <div className="tour-card-footer">
          <div className="tour-progress-dots"role="tablist"aria-label="Pasos del tour">
            {TOUR_STEPS.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-label={`Ir al paso ${idx + 1}: ${s.title}`}
                aria-selected={idx === stepIndex}
                className={`tour-dot${idx === stepIndex ? 'active': ''}`}
                onClick={() => setStepIndex(idx)}
              />
            ))}
          </div>

          <div className="tour-card-buttons">
            <button
              type="button"
              className="ghost"
              style={{ fontSize: '12px', padding: '6px 10px'}}
              onClick={handleSkip}
            >
              Saltar
            </button>
            {!isFirstStep && (
              <button
                type="button"
                className="secondary"
                style={{ fontSize: '12px', padding: '6px 12px'}}
                onClick={handlePrev}
              >
                Anterior
              </button>
            )}
            <button
              type="button"
              className="primary"
              style={{ fontSize: '12px', padding: '6px 14px'}}
              onClick={handleNext}
            >
              {isLastStep ? '¡Empezar a editar!': 'Siguiente'}
            </button>
          </div>
        </div>

        <label className="tour-dont-show-again">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          <span>No volver a mostrar el tour automáticamente</span>
        </label>
      </div>
    </div>
  );
}
