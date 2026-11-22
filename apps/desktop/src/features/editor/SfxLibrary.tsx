import { useEffect, useRef, useState } from 'react';
import type { SfxItem } from '../../services/contracts';
import { useProjectStore } from '../../state/project-store';
import { addSfxToTimeline } from '../../state/sfx-actions';
import { Icon } from '../../components/Icon';

/**
 * Biblioteca de efectos de sonido (paridad `sons.js` de AlaukCut):
 * ▶ preview una vez + click en la tarjeta → importa el WAV al proyecto y
 * lo monta como clip de audio en el playhead. Los archivos son WAV
 * sintetizados por `scripts/generate-sfx.mjs` (sin samples de terceros).
 */
/**
 * Agrupa los items por `group` conservando el orden de aparición (los
 * grupos se ordenan por primera aparición, como el catálogo). Sin grupos
 * devuelve una sola entrada con clave '' → la UI la pinta plana.
 */
export function groupSfxItems(
  items: readonly SfxItem[],
): readonly (readonly [string, readonly SfxItem[]])[] {
  const groups = new Map<string, SfxItem[]>();
  for (const item of items) {
    const key = item.group ?? '';
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return [...groups.entries()];
}

export function SfxLibrary() {
  const store = useProjectStore();
  const [items, setItems] = useState<readonly SfxItem[] | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void store.service
      .sfxLibrary()
      .then((library) => {
        if (!cancelled) setItems(library);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [store.service]);

  function stopPreview(): void {
    audioRef.current?.pause();
    audioRef.current = null;
    setPreviewing(null);
  }

  function preview(item: SfxItem): void {
    if (previewing === item.id) {
      stopPreview();
      return;
    }
    stopPreview();
    const url = store.service.absoluteFileUrl(item.path);
    if (!url) {
      store.setNotice(`No se pudo resolver la ruta de ${item.label}.`);
      return;
    }
    const audio = new Audio(url);
    audio.volume = 0.9;
    audio.addEventListener('ended', () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPreviewing(null);
      }
    });
    audioRef.current = audio;
    setPreviewing(item.id);
    void audio.play().catch(() => {
      audioRef.current = null;
      setPreviewing(null);
    });
  }

  async function addToTimeline(item: SfxItem): Promise<void> {
    if (busy) return;
    setBusy(item.id);
    try {
      await addSfxToTimeline(store, item, store.getPlayhead());
    } catch (failure) {
      store.setNotice(
        failure instanceof Error ? failure.message : `no se pudo agregar ${item.label}`,
      );
    } finally {
      setBusy(null);
    }
  }

  if (items === null) {
    return <p className="empty-inline">Cargando efectos de sonido…</p>;
  }
  if (items.length === 0) {
    return (
      <p className="empty-inline">
        La biblioteca de efectos no está disponible en esta instalación.
      </p>
    );
  }
  // Grupos colapsables (paridad `som-grupo` de `sons.js`): las tarjetas se
  // ordenan por `item.group` conservando el orden del catálogo; los items
  // sin grupo caen en «General». Sin grupos (catálogo viejo) la lista
  // queda plana como antes.
  const groups = groupSfxItems(items);
  const grouped = groups.length > 1 || groups.some(([key]) => key !== '');
  const renderCard = (item: SfxItem) => (
    <div
      key={item.id}
      className="sfx-card"
      title={`${item.description} — click para montar en el playhead`}
    >
      <button
        type="button"
        className={`som-play small ghost${previewing === item.id ? ' tocando' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          preview(item);
        }}
        aria-label={`Escuchar ${item.label}`}
        title="Escuchar una vez"
      >
        {previewing === item.id ? '■' : '▶'}
      </button>
      <div
        className="sfx-info"
        role="button"
        tabIndex={0}
        onClick={() => void addToTimeline(item)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void addToTimeline(item);
          }
        }}
      >
        <strong>{item.label}</strong>
        <span>
          {item.durationSeconds.toFixed(1)}s · {item.description}
        </span>
      </div>
      <button
        type="button"
        className="small ghost"
        disabled={busy === item.id}
        onClick={() => void addToTimeline(item)}
      >
        {busy === item.id ? (
          <Icon name="refresh" size={11} />
        ) : (
          '+ Agregar'
        )}
      </button>
    </div>
  );
  return (
    <div className="sfx-list">
      {grouped
        ? groups.map(([group, groupItems]) => (
            <details key={group || 'general'} className="sfx-group" open>
              <summary>
                {group || 'General'}{' '}
                <span className="sfx-group-count">{groupItems.length}</span>
              </summary>
              <div className="sfx-group-items">{groupItems.map(renderCard)}</div>
            </details>
          ))
        : items.map(renderCard)}
    </div>
  );
}
