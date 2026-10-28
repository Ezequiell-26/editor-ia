import { lazy, Suspense, useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { HubTabs, type HubTab } from '../../components/HubTabs';

const ConvertView = lazy(() =>
  import('../convert/ConvertView').then((module) => ({ default: module.ConvertView })),
);
const CompressView = lazy(() =>
  import('../compress/CompressView').then((module) => ({ default: module.CompressView })),
);
const DenoiseView = lazy(() =>
  import('../denoise/DenoiseView').then((module) => ({ default: module.DenoiseView })),
);
const UpscaleView = lazy(() =>
  import('../ai/UpscaleView').then((module) => ({ default: module.UpscaleView })),
);
const CompareView = lazy(() =>
  import('../compare/CompareView').then((module) => ({ default: module.CompareView })),
);
const RemoveBackgroundView = lazy(() =>
  import('../ai/RemoveBackgroundView').then((module) => ({
    default: module.RemoveBackgroundView,
  })),
);

type LabTab = 'convert' | 'compress' | 'denoise' | 'upscale' | 'compare' | 'background';

const TABS: readonly (HubTab & { id: LabTab })[] = [
  { id: 'convert', label: 'Convertir', hint: 'Transcodificar video, imagen y audio', icon: 'convert' },
  { id: 'compress', label: 'Comprimir', hint: 'Reducir peso sin perder nitidez', icon: 'compress' },
  { id: 'denoise', label: 'Denoise', hint: 'Limpiar ruido visual y sonoro', icon: 'denoise' },
  { id: 'upscale', label: 'Upscale', hint: 'Super-resolución local a 4K', icon: 'upscale' },
  { id: 'compare', label: 'Comparar', hint: 'Antes y después con línea divisoria', icon: 'split' },
  { id: 'background', label: 'Fondo', hint: 'Recorte de silueta con IA local', icon: 'background' },
];

/**
 * Laboratorio de medios: seis utilidades que antes competían en el rail viven
 * en una sola pantalla. Las pestañas visitadas se conservan montadas.
 */
export function MediaLabView({
  onNavigate,
  initialTab,
  requestId = 0,
}: {
  readonly onNavigate: (id: ViewId) => void;
  readonly initialTab?: string | undefined;
  readonly requestId?: number;
}) {
  const initial: LabTab = TABS.some((tab) => tab.id === initialTab)
    ? (initialTab as LabTab)
    : 'convert';
  const [active, setActive] = useState<LabTab>(initial);
  const [visited, setVisited] = useState<ReadonlySet<LabTab>>(
    () => new Set<LabTab>([initial]),
  );

  const requested = TABS.some((tab) => tab.id === initialTab)
    ? (initialTab as LabTab)
    : null;

  useEffect(() => {
    if (!requested) return;
    setActive(requested);
    setVisited((current) =>
      current.has(requested) ? current : new Set(current).add(requested),
    );
  }, [requested, requestId]);

  function select(id: LabTab): void {
    setActive(id);
    setVisited((current) => (current.has(id) ? current : new Set(current).add(id)));
  }

  function route(id: ViewId): void {
    if (
      id === 'convert' ||
      id === 'compress' ||
      id === 'denoise' ||
      id === 'upscale' ||
      id === 'compare' ||
      id === 'background'
    ) {
      select(id);
      return;
    }
    onNavigate(id);
  }

  return (
    <section className="view hub-view" aria-label="Laboratorio de medios">
      <HubTabs
        tabs={TABS}
        active={active}
        onChange={(id) => select(id as LabTab)}
        ariaLabel="Utilidades de medios"
      />
      {visited.has('convert') ? (
        <div className="hub-panel" role="tabpanel" hidden={active !== 'convert'}>
          <Suspense fallback={null}>
            <ConvertView onNavigate={route} />
          </Suspense>
        </div>
      ) : null}
      {visited.has('compress') ? (
        <div className="hub-panel" role="tabpanel" hidden={active !== 'compress'}>
          <Suspense fallback={null}>
            <CompressView onNavigate={route} />
          </Suspense>
        </div>
      ) : null}
      {visited.has('denoise') ? (
        <div className="hub-panel" role="tabpanel" hidden={active !== 'denoise'}>
          <Suspense fallback={null}>
            <DenoiseView onNavigate={route} />
          </Suspense>
        </div>
      ) : null}
      {visited.has('upscale') ? (
        <div className="hub-panel" role="tabpanel" hidden={active !== 'upscale'}>
          <Suspense fallback={null}>
            <UpscaleView onNavigate={route} />
          </Suspense>
        </div>
      ) : null}
      {visited.has('compare') ? (
        <div className="hub-panel" role="tabpanel" hidden={active !== 'compare'}>
          <Suspense fallback={null}>
            <CompareView onNavigate={route} />
          </Suspense>
        </div>
      ) : null}
      {visited.has('background') ? (
        <div className="hub-panel" role="tabpanel" hidden={active !== 'background'}>
          <Suspense fallback={null}>
            <RemoveBackgroundView onNavigate={route} />
          </Suspense>
        </div>
      ) : null}
    </section>
  );
}
