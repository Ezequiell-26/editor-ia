import { useEffect, useRef, useState } from 'react';
import { NAV_VIEWS, type NavView, type ViewId } from '../app/navigation';
import { resolveViewRoute } from '../app/view-routing';
import { Icon } from './Icon';

/**
 * Puerta visible a las herramientas NO de edición cuando el editor corre en
 * superficie IA-only. Los modos de edición se resuelven con `resolveViewRoute`
 * (la misma fuente que usa el menú «Más») y se excluyen: el editor IA no
 * reintroduce botones de edición.
 */
const UTILITY_VIEWS: readonly NavView[] = NAV_VIEWS.filter(
  (view) => view.id !== 'editor' && resolveViewRoute(view.id).editorMode === undefined,
);

const UTILITY_GROUPS = [
  { id: 'herramientas', label: 'Herramientas' },
  { id: 'ruta', label: 'Flujo de trabajo' },
  { id: 'inicio', label: 'Inicio' },
  { id: 'ayuda', label: 'Ayuda' },
] as const;

export function UtilityToolsMenu({ onSelect }: { readonly onSelect: (view: ViewId) => void }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // El drawer es `position: fixed` porque `.editor-grid` recorta con
  // `overflow: hidden`; se ancla al botón para seguirlo si la barra se mueve.
  const toggle = (): void => {
    setOpen((value) => {
      if (!value && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setAnchor({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
      }
      return !value;
    });
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return (
    <div className="topbar-ai-tools" ref={rootRef}>
      <button
        type="button"
        className="topbar-ai-tools-btn"
        aria-label="Herramientas"
        aria-expanded={open}
        aria-haspopup="menu"
        ref={buttonRef}
        onClick={toggle}
      >
        <Icon name="grid" size={14} />
        <span>Herramientas</span>
      </button>
      {open ? (
        <div
          className="ai-tools-drawer"
          role="menu"
          aria-label="Herramientas de Olyvia"
          style={anchor ? { top: anchor.top, right: anchor.right } : undefined}
        >
          {UTILITY_GROUPS.map((group) => {
            const items = UTILITY_VIEWS.filter((view) => view.group === group.id);
            if (items.length === 0) return null;
            return (
              <div className="ai-tools-group" key={group.id}>
                <span className="ai-tools-group-label">{group.label}</span>
                {items.map((view) => (
                  <button
                    type="button"
                    role="menuitem"
                    className="ai-tools-item"
                    key={view.id}
                    onClick={() => {
                      setOpen(false);
                      onSelect(view.id);
                    }}
                  >
                    <strong>{view.label}</strong>
                    <small>{view.hint}</small>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
