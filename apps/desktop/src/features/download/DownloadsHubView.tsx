import { lazy, Suspense, useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { HubTabs, type HubTab } from '../../components/HubTabs';

const DownloadView = lazy(() =>
  import('./DownloadView').then((module) => ({ default: module.DownloadView })),
);
const YouTubeAnalyzerView = lazy(() =>
  import('../youtube/YouTubeAnalyzerView').then((module) => ({
    default: module.YouTubeAnalyzerView,
  })),
);
const ComplianceView = lazy(() =>
  import('../compliance/ComplianceView').then((module) => ({
    default: module.ComplianceView,
  })),
);

type DownloadsTab = 'download' | 'youtube' | 'compliance';

const TABS: readonly (HubTab & { id: DownloadsTab })[] = [
  { id: 'download', label: 'Descargar', hint: 'Bajar video, audio, fotos y carruseles', icon: 'download' },
  { id: 'youtube', label: 'YouTube', hint: 'Analizar canales, miniaturas y rendimiento', icon: 'globe' },
  { id: 'compliance', label: 'Cumplimiento', hint: 'Reglas de monetización y derechos por red', icon: 'shield' },
];

/**
 * Ingesta: la descarga, el análisis de canales y el preflight de reglas viven
 * en la misma superficie. Las pestañas visitadas quedan montadas para no
 * perder una cola activa ni el análisis en curso.
 */
export function DownloadsHubView({
  onNavigate,
  initialTab,
  requestId = 0,
}: {
  readonly onNavigate: (id: ViewId) => void;
  readonly initialTab?: string | undefined;
  readonly requestId?: number;
}) {
  const initial: DownloadsTab = TABS.some((tab) => tab.id === initialTab)
    ? (initialTab as DownloadsTab)
    : 'download';
  const [active, setActive] = useState<DownloadsTab>(initial);
  const [visited, setVisited] = useState<ReadonlySet<DownloadsTab>>(
    () => new Set<DownloadsTab>([initial]),
  );

  const requested = TABS.some((tab) => tab.id === initialTab)
    ? (initialTab as DownloadsTab)
    : null;

  useEffect(() => {
    if (!requested) return;
    setActive(requested);
    setVisited((current) =>
      current.has(requested) ? current : new Set(current).add(requested),
    );
  }, [requested, requestId]);

  function select(id: DownloadsTab): void {
    setActive(id);
    setVisited((current) => (current.has(id) ? current : new Set(current).add(id)));
  }

  function route(id: ViewId): void {
    if (id === 'download' || id === 'youtube' || id === 'compliance') {
      select(id);
      return;
    }
    onNavigate(id);
  }

  return (
    <section className="view hub-view" aria-label="Ingesta">
      <HubTabs
        tabs={TABS}
        active={active}
        onChange={(id) => select(id as DownloadsTab)}
        ariaLabel="Herramientas de ingesta"
      />
      {visited.has('download') ? (
        <div className="hub-panel" role="tabpanel" hidden={active !== 'download'}>
          <Suspense fallback={null}>
            <DownloadView onNavigate={route} />
          </Suspense>
        </div>
      ) : null}
      {visited.has('youtube') ? (
        <div className="hub-panel" role="tabpanel" hidden={active !== 'youtube'}>
          <Suspense fallback={null}>
            <YouTubeAnalyzerView />
          </Suspense>
        </div>
      ) : null}
      {visited.has('compliance') ? (
        <div className="hub-panel" role="tabpanel" hidden={active !== 'compliance'}>
          <Suspense fallback={null}>
            <ComplianceView onNavigate={route} />
          </Suspense>
        </div>
      ) : null}
    </section>
  );
}
