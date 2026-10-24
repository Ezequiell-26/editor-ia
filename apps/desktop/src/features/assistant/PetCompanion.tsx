import { useEffect, useRef } from 'react';

/** Estados del pet: se traducen a movimiento y mirada en `olyvia.css`. */
export type PetMood = 'awake' | 'listening' | 'thinking' | 'replying';

interface PetCompanionProps {
  readonly mood: PetMood;
}

/**
 * El pet vive dentro del chat. Es exactamente la foto del peluche recortada
 * con U²-Net (`olyvia-pet.webp`); la vida se agrega con capas encima
 * —párpados, iris y puntos de la burbuja— y animaciones CSS. No hay una
 * mascota dibujada aparte.
 */
export function PetCompanion({ mood }: PetCompanionProps) {
  const rootRef = useRef<HTMLSpanElement | null>(null);

  // La mirada sigue al puntero en coordenadas normalizadas. Se escribe en
  // variables CSS (no en estado) para no re-renderizar en cada movimiento.
  useEffect(() => {
    let frame = 0;
    function handleMove(event: PointerEvent): void {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const root = rootRef.current;
        if (!root) return;
        const rect = root.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height * 0.52;
        const lookX = Math.max(-1, Math.min(1, (event.clientX - centerX) / 260));
        const lookY = Math.max(-1, Math.min(1, (event.clientY - centerY) / 260));
        root.style.setProperty('--pet-look-x', lookX.toFixed(3));
        root.style.setProperty('--pet-look-y', lookY.toFixed(3));
      });
    }
    window.addEventListener('pointermove', handleMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', handleMove);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <span
      ref={rootRef}
      className={`pet-avatar is-${mood}`}
      aria-hidden="true"
      title="Olyvia"
    >
      <span className="pet-aura" />
      <span className="pet-stage">
        <img className="pet-photo" src="/olyvia-pet.webp" alt="" draggable={false} />
        <svg className="pet-face" viewBox="0 0 1101 1254" focusable="false">
          <defs>
            <radialGradient id="olyvia-iris" cx="46%" cy="38%" r="62%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="42%" stopColor="#e4fcff" />
              <stop offset="76%" stopColor="#6fe7ff" />
              <stop offset="100%" stopColor="#2f9bff" />
            </radialGradient>
          </defs>
          <g className="pet-lids">
            <path d="M 305 641 Q 356 699 409 641" />
            <path d="M 560 594 Q 612 650 666 594" />
          </g>
          <g className="pet-look">
            <g className="pet-gaze">
              <circle cx="356" cy="612" r="20" fill="url(#olyvia-iris)" />
              <circle cx="612" cy="554" r="22" fill="url(#olyvia-iris)" />
            </g>
          </g>
        </svg>
        <span className="pet-dots">
          <i />
          <i />
          <i />
        </span>
      </span>
    </span>
  );
}
