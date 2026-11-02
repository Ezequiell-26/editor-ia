import { lazy, Suspense, useState } from 'react';

const loadPopover = () =>
  import('./EmojiPickerPopover').then((module) => ({ default: module.EmojiPickerPopover }));

let popoverPromise: Promise<unknown> | null = null;

/**
 * Precarga el chunk diferido del catálogo de emojis (~719 kB) para que
 * esté disponible de inmediato al hacer click.
 */
export function preloadEmojiPicker(): Promise<unknown> {
  if (!popoverPromise) {
    popoverPromise = loadPopover();
  }
  return popoverPromise;
}

const EmojiPickerPopover = lazy(loadPopover);

export interface EmojiPickerButtonProps {
  readonly onPick: (emoji: string) => void;
  readonly label?: string;
}

/**
 * Disparador ligero de selector de emojis.
 *
 * El catálogo Unicode completo (~240 kB fuente / ~719 kB min) y el diálogo
 * viven en un chunk diferido (`EmojiPickerPopover`) que sólo se descarga al
 * pasar el cursor, enfocar o hacer click en el botón.
 */
export function EmojiPickerButton({ onPick, label = 'Insertar emoji' }: EmojiPickerButtonProps) {
  const [open, setOpen] = useState(false);

  function handleOpen() {
    preloadEmojiPicker();
    setOpen((current) => !current);
  }

  return (
    <span className="emoji-picker">
      <button
        type="button"
        className="emoji-trigger"
        aria-label={label}
        aria-expanded={open}
        title="Insertar emoji"
        onMouseEnter={preloadEmojiPicker}
        onFocus={preloadEmojiPicker}
        onClick={handleOpen}
      >
        <span aria-hidden="true" style={{ fontFamily: 'var(--emoji-font)' }}>
          😀
        </span>
      </button>
      {open ? (
        <Suspense fallback={null}>
          <EmojiPickerPopover onPick={onPick} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </span>
  );
}

