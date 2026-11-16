import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Selector de fuente buscable (paridad de `lista_fontes.js` de AlaukCut):
 * normaliza acentos para filtrar, rankea prefijo > palabra > substring,
 * renderiza cada opción en su propia familia y navega con teclado.
 */

export function normalizeFontQuery(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export type RankedFont = { readonly font: string; readonly score: number };

export function rankFonts(query: string, fonts: readonly string[]): RankedFont[] {
  const q = normalizeFontQuery(query);
  const ranked: RankedFont[] = [];
  for (const font of fonts) {
    const name = normalizeFontQuery(font);
    if (!name) continue;
    let score = -1;
    if (!q) score = 1;
    else if (name.startsWith(q)) score = 0;
    else if (name.split(/\s+/).some((word) => word.startsWith(q))) score = 1;
    else if (name.includes(q)) score = 2;
    if (score >= 0) ranked.push({ font, score });
  }
  ranked.sort((a, b) => a.score - b.score || a.font.localeCompare(b.font));
  return ranked;
}

const MAX_VISIBLE = 60;

export function FontPicker({
  value,
  fonts,
  onChange,
  placeholder,
}: {
  readonly value: string;
  readonly fonts: readonly string[];
  readonly onChange: (font: string) => void;
  readonly placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const options = useMemo(
    () => rankFonts(query, fonts).slice(0, MAX_VISIBLE),
    [query, fonts],
  );

  function pick(font: string): void {
    onChange(font);
    setQuery(font);
    setOpen(false);
    setActiveIndex(0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      const option = options[activeIndex];
      if (open && option) {
        event.preventDefault();
        pick(option.font);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    }
  }

  return (
    <div className="font-picker">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="font-picker-list"
        aria-activedescendant={
          open && options[activeIndex] ? `font-opt-${activeIndex}` : undefined
        }
        maxLength={120}
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />
      {open && options.length > 0 ? (
        <div className="font-picker-list" role="listbox" id="font-picker-list" ref={listRef}>
          {options.map((option, index) => (
            <button
              key={option.font}
              type="button"
              role="option"
              id={`font-opt-${index}`}
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'font-picker-option active' : 'font-picker-option'}
              style={{ fontFamily: `'${option.font.replace(/'/g, "\\'")}', sans-serif` }}
              // pointerdown + preventDefault: elegir antes del blur del input.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => pick(option.font)}
            >
              {option.font}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
