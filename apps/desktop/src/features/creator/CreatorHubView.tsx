import { lazy, Suspense, useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { HubTabs, type HubTab } from '../../components/HubTabs';

const CreatorView = lazy(() =>
  import('./CreatorView').then((module) => ({ default: module.CreatorView })),
);
const FactoryView = lazy(() =>
  import('../factory/FactoryView').then((module) => ({ default: module.FactoryView })),
);
const ThumbnailView = lazy(() =>
  import('../thumbnails/ThumbnailView').then((module) => ({ default: module.ThumbnailView })),
);
const LocalizationView = lazy(() =>
  import('../localization/LocalizationView').then((module) => ({
    default: module.LocalizationView,
  })),
);

type CreatorTab = 'creator' | 'factory' | 'thumbnails' | 'localization';

const TABS: readonly (HubTab & { id: CreatorTab })[] = [
  { id: 'creator', label: 'Crear', hint: 'Hooks, formatos y CTA', icon: 'sparkles' },
  { id: 'factory', label: 'Fábrica', hint: 'Variantes en lote desde un brief', icon: 'factory' },
  { id: 'thumbnails', label: 'Miniaturas', hint: 'Carátulas para YouTube y redes', icon: 'thumbnails' },
  { id: 'localization', label: 'Localización', hint: 'Subtítulos y traducción', icon: 'globe' },
];

/**
 * Creador: el flujo de salida de contenido comparte superficie con la fábrica,
 * las miniaturas y la localización. Cada pestaña conserva su estado al volver.
 */
export function CreatorHubView({
  onNavigate,
  initialTab,
  requestId = 0,
}: {
  readonly onNavigate: (id: ViewId) => void;
  readonly initialTab?: string | undefined;
  readonly requestId?: number;
}) {
  const initial: CreatorTab = TABS.some((tab) => tab.id === initialTab)
    ? (initialTab as CreatorTab)
    : 'creator';
  const [active, setActive] = useState<CreatorTab>(initial);
  const [visited, setVisited] = useState<ReadonlySet<CreatorTab>>(
    () => new Set<CreatorTab>([initial]),
  );

  const requested = TABS.some((tab) => tab.id === initialTab)
    ? (initialTab as CreatorTab)
    : null;

  useEffect(() => {
    if (!requested) return;
    setActive(requested);
    setVisited((current) =>
      current.has(requested) ? current : new Set(current).add(requested),
    );
  }, [requested, requestId]);

  function select(id: CreatorTab): void {
    setActive(id);
    setVisited((current) => (current.has(id) ? current : new Set(current).add(id)));
  }

  function route(id: ViewId): void {
    if (id === 'creator' || id === 'factory' || id === 'thumbnails' || id === 'localization') {
      select(id);
      return;
    }
    onNavigate(id);
  }

  return (
    <section className="view hub-view" aria-label="Creador">
      <HubTabs
        tabs={TABS}
        active={active}
        onChange={(id) => select(id as CreatorTab)}
        ariaLabel="Herramientas de creador"
      />
      {visited.has('creator') ? (
        <div className="hub-panel" role="tabpanel" hidden={active !== 'creator'}>
          <Suspense fallback={null}>
            <CreatorView onNavigate={route} />
          </Suspense>
        </div>
      ) : null}
      {visited.has('factory') ? (
        <div className="hub-panel" role="tabpanel" hidden={active !== 'factory'}>
          <Suspense fallback={null}>
            <FactoryView onNavigate={route} />
          </Suspense>
        </div>
      ) : null}
      {visited.has('thumbnails') ? (
        <div className="hub-panel" role="tabpanel" hidden={active !== 'thumbnails'}>
          <Suspense fallback={null}>
            <ThumbnailView onNavigate={route} />
          </Suspense>
        </div>
      ) : null}
      {visited.has('localization') ? (
        <div className="hub-panel" role="tabpanel" hidden={active !== 'localization'}>
          <Suspense fallback={null}>
            <LocalizationView onNavigate={route} />
          </Suspense>
        </div>
      ) : null}
    </section>
  );
}
