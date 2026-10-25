import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { updateEditorPreferences } from '../../state/editor-preferences';
import { useEditorPreferences } from '../../state/useEditorPreferences';
import { EMOJI_GROUPS, EMOJI_TOTAL, findEmoji, type EmojiEntry } from './emoji-data';

const RECENT_KEY = 'editoria.emoji-recent.v1';
const MAX_RECENT = 24;

const ALL_ENTRIES: readonly EmojiEntry[] = EMOJI_GROUPS.flatMap((group) => group.emojis);
const ENTRY_BY_EMOJI = new Map(ALL_ENTRIES.map((entry) => [entry.emoji, entry]));

function loadRecent(): readonly string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string').slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function saveRecent(emoji: string): void {
  try {
    const next = [emoji, ...loadRecent().filter((item) => item !== emoji)].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Sin almacenamiento: el selector sigue funcionando en memoria.
  }
}

export interface EmojiPickerButtonProps {
  readonly onPick: (emoji: string) => void;
  readonly label?: string;
}

export function EmojiPickerButton({ onPick, label = 'Insertar emoji' }: EmojiPickerButtonProps) {
  const preferences = useEditorPreferences();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<readonly string[]>(() => loadRecent());
  const [groupId, setGroupId] = useState('smileys-emotion');
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const groups = useMemo(() => {
    const base = EMOJI_GROUPS.filter((group) => group.emojis.length > 0);
    if (recent.length === 0) return base;
    return [
      {
        id: 'recent',
        label: 'Recientes',
        emojis: recent
          .map((emoji) => ENTRY_BY_EMOJI.get(emoji))
          .filter((entry): entry is EmojiEntry => Boolean(entry)),
      },
      ...base,
    ];
  }, [recent]);
  const active = groups.find((group) => group.id === groupId) ?? groups[0];
  const results = query.trim() ? findEmoji(query) : (active?.emojis ?? []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const onPointer = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    const timer = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, [open]);

  function pick(entry: EmojiEntry): void {
    saveRecent(entry.emoji);
    setRecent(loadRecent());
    onPick(entry.emoji);
    setOpen(false);
  }

  return (
    <span className="emoji-picker">
      <button
        type="button"
        className="emoji-trigger"
        aria-label={label}
        aria-expanded={open}
        title="Insertar emoji"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true" style={{ fontFamily: 'var(--emoji-font)' }}>
          😀
        </span>
      </button>
      {open
        ? createPortal(
            <>
              <div className="emoji-backdrop" aria-hidden="true" />
              <div
                className="emoji-popover"
                role="dialog"
                aria-modal="true"
                aria-label="Selector de emojis"
                ref={popoverRef}
              >
          <header className="emoji-head">
            <label className="emoji-search">
              <span className="sr-only">Buscar emoji</span>
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar emoji…"
                aria-label="Buscar emoji"
              />
            </label>
            <div className="emoji-styles" role="group" aria-label="Estilo de emoji">
              <button
                type="button"
                className={preferences.emojiStyle === 'android' ? 'active' : ''}
                aria-pressed={preferences.emojiStyle === 'android'}
                onClick={() => updateEditorPreferences({ emojiStyle: 'android' })}
              >
                Android
              </button>
              <button
                type="button"
                className={preferences.emojiStyle === 'open' ? 'active' : ''}
                aria-pressed={preferences.emojiStyle === 'open'}
                onClick={() => updateEditorPreferences({ emojiStyle: 'open' })}
              >
                Abierto
              </button>
            </div>
          </header>
          {query.trim() ? null : (
            <nav className="emoji-groups" aria-label="Categorías de emojis">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className={group.id === active?.id ? 'active' : ''}
                  aria-pressed={group.id === active?.id}
                  onClick={() => setGroupId(group.id)}
                >
                  {group.label}
                </button>
              ))}
            </nav>
          )}
          <div
            className="emoji-grid"
            style={{ fontFamily: 'var(--emoji-font)' }}
            aria-label={query.trim() ? 'Resultados' : (active?.label ?? 'Emojis')}
          >
            {results.length === 0 ? (
              <p className="emoji-empty">Sin resultados.</p>
            ) : (
              results.map((entry) => (
                <button
                  key={`${entry.emoji}-${entry.name}`}
                  type="button"
                  className="emoji-cell"
                  aria-label={entry.name}
                  title={entry.name}
                  onClick={() => pick(entry)}
                >
                  {entry.emoji}
                </button>
              ))
            )}
          </div>
          <footer className="emoji-foot">
            <span>
              {EMOJI_TOTAL} emojis Unicode {preferences.emojiStyle === 'android' ? 'Android' : 'abierto'}
            </span>
            <span>La preview los muestra en color; el MP4 los quema en monocromo.</span>
          </footer>
              </div>
            </>,
            document.body,
          )
        : null}
    </span>
  );
}
