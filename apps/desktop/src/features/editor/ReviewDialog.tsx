import { useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '../../state/project-store';
import {
  applyReviewItems,
  buildReviewItems,
  reviewSummary,
  type ReviewItem,
  type ReviewKind,
} from '../../state/review-queue';

/**
 * Revisión por ítem.
 *
 * Antes la automatización se aceptaba entera o se deshacía entera. Este
 * diálogo lista cada decisión —silencio, pausa, ruido, zoom, nivelado— y deja
 * aceptar o rechazar de a una antes de tocar la timeline. El análisis corre al
 * abrir; nada se aplica hasta confirmar.
 */

const GROUPS: readonly { kind: ReviewKind; title: string; hint: string }[] = [
  { kind: 'silence', title: 'Silencios', hint: 'Tramos bajo el umbral medido' },
  { kind: 'pause', title: 'Pausas entre frases', hint: 'Aire entre subtítulos' },
  { kind: 'denoise', title: 'Reducción de ruido', hint: 'Nivel medido por clip' },
  { kind: 'zoom', title: 'Zoom en los cortes', hint: 'Alterna entrada y salida' },
  { kind: 'level', title: 'Nivelado', hint: 'Objetivo de loudness y limitador' },
];

export function ReviewDialog({ onClose }: { readonly onClose: () => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const [items, setItems] = useState<readonly ReviewItem[] | null>(null);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void (async () => {
      try {
        const built = await buildReviewItems(project, (assetId) =>
          store.service.audioPeaks(assetId),
        );
        if (cancelled) return;
        setItems(built);
        setAccepted(new Set(built.map((item) => item.id)));
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'no pude analizar el proyecto');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // El análisis se rearma sólo si cambia el proyecto; `store` es estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const grouped = useMemo(() => {
    const map = new Map<ReviewKind, ReviewItem[]>();
    for (const item of items ?? []) {
      const list = map.get(item.kind) ?? [];
      list.push(item);
      map.set(item.kind, list);
    }
    return map;
  }, [items]);

  function toggle(id: string): void {
    setAccepted((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(kind: ReviewKind, on: boolean): void {
    setAccepted((current) => {
      const next = new Set(current);
      for (const item of grouped.get(kind) ?? []) {
        if (on) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  }

  function apply(): void {
    if (!project || !items) return;
    setBusy(true);
    setError(null);
    const next = applyReviewItems(project, items, accepted);
    const ok = store.update(() => next, {
      notice: `Revisión: ${reviewSummary(items, accepted)}`,
    });
    setBusy(false);
    if (ok) onClose();
    else setError('los cambios no dejaron el proyecto en un estado válido; no se aplicó nada');
  }

  return (
    <div className="review-dialog">
      {items === null && !error ? <p className="fine-print">Analizando el proyecto…</p> : null}
      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}
      {items !== null && items.length === 0 ? (
        <p className="fine-print">
          No hay nada que revisar: no encontré silencios, pausas ni ajustes pendientes.
        </p>
      ) : null}
      {items !== null && items.length > 0 ? (
        <>
          <p className="fine-print">
            Desmarcá lo que no quieras aplicar. Nada se toca hasta confirmar.
          </p>
          <div className="review-groups">
            {GROUPS.map((group) => {
              const list = grouped.get(group.kind) ?? [];
              if (list.length === 0) return null;
              const allOn = list.every((item) => accepted.has(item.id));
              return (
                <section key={group.kind} className="review-group">
                  <header>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={allOn}
                        aria-label={`Aceptar todos: ${group.title}`}
                        onChange={(event) => toggleGroup(group.kind, event.target.checked)}
                      />
                      <span>
                        {group.title} <span className="fine-print">· {group.hint}</span>
                      </span>
                    </label>
                    <span className="review-count">{list.length}</span>
                  </header>
                  <ul>
                    {list.map((item) => (
                      <li key={item.id}>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={accepted.has(item.id)}
                            aria-label={`${item.label}: ${item.detail}`}
                            onChange={() => toggle(item.id)}
                          />
                          <span>
                            {item.label} <span className="fine-print">· {item.detail}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          <footer className="actions compact">
            <span className="fine-print">{reviewSummary(items, accepted)}</span>
            <button type="button" className="small ghost" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="small primary"
              disabled={busy || accepted.size === 0}
              onClick={apply}
            >
              {busy ? 'Aplicando…' : `Aplicar ${accepted.size}`}
            </button>
          </footer>
        </>
      ) : null}
    </div>
  );
}
