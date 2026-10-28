# Olyvia · Fase 1: cirugía de navegación y workspaces

> **Para ejecutores:** usar `superpowers:executing-plans` o
> `superpowers:subagent-driven-development`. Cada tarea termina en un
> entregable verificable. No hay commit ni push en esta fase.

**Goal:** reducir el rail de 31 destinos a 9 superficies fijas, dejar 3
workspaces reales (Ingesta, Creador, Studio) y agrupar las herramientas
secundarias en hubs con tabs, sin perder ninguna vista existente ni romper deep
links.

**Architecture:** `navigation.ts` separa el registro completo (`NAV_VIEWS`),
el rail global (`MAIN_NAV_VIEWS`) y el legado avanzado
(`SECONDARY_NAV_VIEWS`). El rail es estable en los tres workspaces; las
píldoras cambian la landing, la vista activa y el contexto. Los tabs de los
hubs reutilizan las vistas existentes con `lazy()` y las mantienen montadas al
cambiar de pestaña. El editor incorpora sus modos como tabs internos y conserva
la timeline. La IA deja de ser un destino: queda el asistente global y la
configuración en Ajustes.

**Tech Stack:** Tauri 2 + Rust, React 19 + TypeScript strict, Vite 5,
Vitest/jsdom, CSS propio.

**Spec:** instrucciones del usuario del 2026-10-28 (feature freeze, Fase 1).

## Resultado de ejecución (2026-10-28)

- `[done]` Rail global de **9 superficies** + botón **Más** con 10
  herramientas avanzadas; AI Hub y MCP ya no son destinos del rail.
- `[done]` **3 workspaces**: Ingesta, Creador y Studio; migración `ai`→`studio`;
  la píldora activa sigue a la vista y cada workspace navega a su landing.
- `[done]` Hubs con tabs y estado preservado: Descargar (Descargar/YouTube/
  Cumplimiento), Creador (Crear/Fábrica/Miniaturas/Localización) y Laboratorio
  (Convertir/Comprimir/Denoise/Upscale/Comparar/Fondo).
- `[done]` Editor con tabs internos Texto/Multicámara/Mezcla/VFX/Motion/Efectos
  y timeline siempre visible.
- `[done]` AI Hub y MCP accesibles desde **Ajustes → IA y MCP**; el asistente
  global (`Ctrl+K`/dock) queda intacto.
- `[done]` “Abrir en Studio” después de importar una descarga.
- **Verificación**: typecheck raíz verde; suite raíz **1352/1352 en 164
  archivos**; escritorio **952/952 en 138**; revisión visual a 1280×720 de
  Descargar, Creador, Laboratorio, Ajustes IA y popover Más.
- **Fase 1B `[done]`**: `view-routing.ts` normaliza las rutas legacy. YouTube/
  Cumplimiento abren Descargar; Fábrica/Miniaturas/Localización abren Creador;
  Convertir/Comprimir/Denoise/Upscale/Comparar/Fondo abren Laboratorio; Texto/
  Multicámara/Mezcla/VFX/Motion/Efectos abren el tab interno del Editor. Las
  rutas standalone duplicadas se retiraron de `App.tsx`; los hubs inicializan
  en el tab pedido y el editor acepta un modo solicitado con request id.
- **Siguiente**: Fase 2 (golden path, recuperación, límites 4–8 y auditoría
  legal). No se reconstruyó ni instaló nada en esta fase.


## Restricciones globales

- Feature freeze: no se agregan funciones de producto; sólo navegación,
  consolidación y accesibilidad.
- No commit, no push, no rebuild/install sin pedido explícito.
- Todos los textos nuevos en español rioplatense.
- Ninguna vista existente se elimina: las rutas siguen funcionando para deep
  links, paleta y menú.
- Radios 8–10 px, paleta cobalto 60-30-10; no introducir degradados nuevos.
- `npm run typecheck` y la suite completa deben quedar verdes.

## Roadmap maestro (Fases 2–4, planes separados)

| Fase | Resultado | Gate |
|---|---|---|
| 2 | Golden path estable + recuperación + límites 4–8 + auditoría legal | 10/10 corridas reales; sin pérdida de proyecto |
| 3 | `LicenseTier` Free/Pro, trial 14 días, activación y compatibilidad de proyectos | Free abre proyectos Pro sin pérdida |
| 4 | Instalador firmado, updater, licencia y desinstalación limpia | VM limpia: instalar → probar → activar → desinstalar |

Cada fase tendrá su propio plan ejecutable cuando se cierre la anterior. Este
documento sólo detalla la Fase 1.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/app/navigation.ts` | `ViewId` + `lab`, `MAIN_NAV_VIEWS`, `SECONDARY_NAV_VIEWS`, `NAV_VIEWS` completo |
| `src/app/workspaces.ts` | 3 workspaces, mapeo vista→workspace, migración `ai`→`studio` |
| `src/components/Sidebar.tsx` | Rail principal + botón “Más” con vistas avanzadas |
| `src/components/HubTabs.tsx` | Tabs accesibles reutilizables |
| `src/features/download/DownloadsHubView.tsx` | Descargar + YouTube + Cumplimiento |
| `src/features/creator/CreatorHubView.tsx` | Crear + Fábrica + Miniaturas + Localización |
| `src/features/lab/MediaLabView.tsx` | Convertir, Comprimir, Denoise, Upscale, Comparar, Fondo |
| `src/components/AppShell.tsx` | 3 píldoras, rail filtrado y `moreViews` |
| `src/App.tsx` | Ruta `lab`, hubs, Ajustes→IA/MCP, precarga |
| `src/features/settings/SettingsHome.tsx` | Accesos “Abrir AI Hub” y “Servidores MCP” |
| `src/styles/commercial.css` | Estilos de tabs, popover “Más” y paneles |

---

## Task 1: Registro de navegación y vistas principales

**Files:**
- Modify: `src/app/navigation.ts`
- Test: `src/app/navigation.test.ts` (crear)

**Interfaces:**
- Produce: `MAIN_NAV_VIEWS: readonly NavView[]` con 9 ids en orden.
- Produce: `SECONDARY_NAV_VIEWS: readonly NavView[]` sin main, `ai-hub` ni `mcp`.
- Produce: `ViewId` incluye `'lab'`.

- [ ] **Step 1: escribir el test que falla**

```ts
// src/app/navigation.test.ts
import { describe, expect, it } from 'vitest';
import {
  MAIN_NAV_VIEWS,
  NAV_VIEWS,
  SECONDARY_NAV_VIEWS,
  type ViewId,
} from './navigation';

describe('registro de navegación', () => {
  it('expone nueve superficies principales en el orden acordado', () => {
    expect(MAIN_NAV_VIEWS.map((view) => view.id)).toEqual([
      'home',
      'download',
      'creator',
      'projects',
      'editor',
      'lab',
      'production',
      'learn',
      'settings',
    ]);
  });

  it('mantiene todas las vistas existentes y excluye IA/MCP del legado', () => {
    const all = new Set<ViewId>(NAV_VIEWS.map((view) => view.id));
    for (const id of ['youtube', 'compliance', 'factory', 'convert', 'ai-hub', 'mcp']) {
      expect(all.has(id as ViewId)).toBe(true);
    }
    expect(SECONDARY_NAV_VIEWS.map((view) => view.id)).toContain('assets');
    expect(SECONDARY_NAV_VIEWS.map((view) => view.id)).not.toContain('ai-hub');
    expect(SECONDARY_NAV_VIEWS.map((view) => view.id)).not.toContain('mcp');
  });
});
```

- [ ] **Step 2: correr y ver el fallo**

Run: `npx vitest run src/app/navigation.test.ts`
Expected: FAIL porque `MAIN_NAV_VIEWS` y `SECONDARY_NAV_VIEWS` no existen.

- [ ] **Step 3: implementar**

Agregar `'lab'` a `ViewId` y a `NAV_VIEWS`:

```ts
{ id: 'lab', label: 'Laboratorio', hint: 'Conversión, compresión, ruido, upscale, comparación y fondo en un solo lugar', group: 'herramientas' },
```

Después del array `NAV_VIEWS`:

```ts
const MAIN_IDS = new Set<ViewId>([
  'home', 'download', 'creator', 'projects', 'editor', 'lab', 'production', 'learn', 'settings',
]);

export const MAIN_NAV_VIEWS: readonly NavView[] = [
  { id: 'home', label: 'Inicio', hint: 'Estado del estudio y acceso rápido', group: 'inicio' },
  { id: 'download', label: 'Descargar', hint: 'Ingesta, YouTube y cumplimiento', group: 'ruta' },
  { id: 'creator', label: 'Creador', hint: 'Hooks, variantes, miniaturas y localización', group: 'ruta' },
  { id: 'projects', label: 'Proyectos', hint: 'Crear, abrir e importar proyectos', group: 'ruta' },
  { id: 'editor', label: 'Editor', hint: 'Timeline, preview, inspector y modos de edición', group: 'ruta' },
  { id: 'lab', label: 'Laboratorio', hint: 'Utilidades de medios locales', group: 'ruta' },
  { id: 'production', label: 'Producción', hint: 'Entregas, render y automatización', group: 'ruta' },
  { id: 'learn', label: 'Aprender', hint: 'Tutorial y atajos', group: 'ayuda' },
  { id: 'settings', label: 'Ajustes', hint: 'Apariencia, IA, integraciones y datos', group: 'ayuda' },
];

/** Herramientas avanzadas visibles tras “Más”; IA y MCP viven en Ajustes. */
export const SECONDARY_NAV_VIEWS: readonly NavView[] = NAV_VIEWS.filter(
  (view) => !MAIN_IDS.has(view.id) && view.id !== 'ai-hub' && view.id !== 'mcp',
);
```

Agregar `'lab'` a `PIPELINE_HIDDEN_VIEWS`.

- [ ] **Step 4: correr el test**

Run: `npx vitest run src/app/navigation.test.ts`
Expected: PASS.

---

## Task 2: Tres workspaces y migración

**Files:**
- Modify: `src/app/workspaces.ts`
- Test: `src/app/workspaces.test.ts`

**Interfaces:**
- Produce: `WorkspaceId = 'downloads' | 'creator' | 'studio'`.
- `workspaceForView('lab') === 'studio'`.
- `loadWorkspace()` migra `'ai'` a `'studio'`.

- [ ] **Step 1: actualizar el test para que falle**

```ts
expect(WORKSPACES.map((workspace) => workspace.label)).toEqual([
  'Ingesta', 'Creador', 'Studio',
]);
expect(defaultViewFor('downloads', false)).toBe('download');
expect(defaultViewFor('studio', false)).toBe('projects');
expect(defaultViewFor('studio', true)).toBe('editor');
expect(workspaceForView('lab')).toBe('studio');
window.localStorage.setItem('editor-ia.workspace.v1', 'ai');
expect(loadWorkspace()).toBe('studio');
```

Quitar las aserciones de `'ai'` y `'AI Hub'`.

- [ ] **Step 2: correr y ver el fallo**

Run: `npx vitest run src/app/workspaces.test.ts`
Expected: FAIL por los cuatro workspaces y el mapeo.

- [ ] **Step 3: implementar**

- Quitar `'ai'` del tipo y de `WORKSPACES`.
- Cambiar labels a `Ingesta`, `Creador`, `Studio`.
- El rail es global: el workspace sólo cambia la landing y la píldora activa.
- `workspaceForView` mapea `lab` a `studio`; `ai-hub`/`mcp` a `null`.
- `loadWorkspace`:

```ts
const stored = window.localStorage.getItem(STORAGE_KEY);
if (stored === 'ai') return 'studio';
if (stored === 'downloads' || stored === 'creator' || stored === 'studio') return stored;
```

- [ ] **Step 4: correr el test**

Run: `npx vitest run src/app/workspaces.test.ts`
Expected: PASS.

---

## Task 3: Sidebar con “Más” y rail de 9

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consume: `moreViews?: readonly NavView[]`.
- Produce: botón `aria-label="Más herramientas"` con `aria-expanded` y lista de `moreViews`.
- El rail principal conserva `aria-label="Vistas principales"`.

- [ ] **Step 1: actualizar el test del rail**

El primer test de `App.test.tsx` debe esperar exactamente:

```ts
expect(navLabels()).toEqual([
  'Inicio', 'Descargar', 'Creador', 'Proyectos', 'Editor',
  'Laboratorio', 'Producción', 'Aprender', 'Ajustes',
]);
```

Agregar un test:

```ts
it('guarda las herramientas avanzadas detrás de Más', async () => {
  renderApp();
  const nav = screen.getByRole('navigation', { name: /vistas principales/i });
  expect(within(nav).queryByRole('button', { name: 'Guion' })).toBeNull();
  fireEvent.click(within(nav).getByRole('button', { name: /Más herramientas/i }));
  expect(within(nav).getByRole('button', { name: 'Guion' })).toBeTruthy();
  expect(within(nav).getByRole('button', { name: 'AI Hub' })).toBeNull();
  expect(within(nav).getByRole('button', { name: 'MCP' })).toBeNull();
});
```

- [ ] **Step 2: correr y ver el fallo**

Run: `npx vitest run src/App.test.tsx -t "rail|Más"`
Expected: FAIL por los labels actuales de 31 vistas.

- [ ] **Step 3: implementar**

En `Sidebar`:

```tsx
const [moreOpen, setMoreOpen] = useState(false);
```

Agregar el prop `moreViews = []`. Después de los `views.map`, dentro del `<ul>`:

```tsx
{moreViews.length > 0 ? (
  <li className="nav-more">
    <button
      type="button"
      aria-label={moreOpen ? 'Cerrar herramientas avanzadas' : 'Más herramientas'}
      aria-expanded={moreOpen}
      onClick={() => setMoreOpen((open) => !open)}
    >
      <Icon name="grid" className="nav-icon" size={15} />
      <span className="nav-label" aria-hidden="true">Más</span>
    </button>
    {moreOpen ? (
      <ul className="nav-more-list" aria-label="Herramientas avanzadas">
        {moreViews.map((view) => (
          <li key={view.id}>
            <button
              type="button"
              aria-label={view.label}
              onClick={() => {
                setMoreOpen(false);
                onSelect(view.id);
              }}
            >
              <span className="nav-label" aria-hidden="true">{view.label}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : null}
  </li>
) : null}
```

Cerrar al hacer click fuera o Escape con un `useEffect`, igual que el patrón existente de `MenuBar`.

- [ ] **Step 4: correr el test**

Run: `npx vitest run src/App.test.tsx -t "rail|Más"`
Expected: PASS, salvo tests que todavía esperan labels secundarios (se corrigen en Task 7).

---

## Task 4: HubTabs accesibles

**Files:**
- Create: `src/components/HubTabs.tsx`
- Test: `src/components/HubTabs.test.tsx`

**Interfaces:**
- Produce: `<HubTabs tabs={...} active={...} onChange={(id)=>void} ariaLabel={string} />`.
- Produce: `HubTab` con `id: string`, `label: string`, `hint?: string`, `icon?: IconName`.

- [ ] **Step 1: test que falla**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HubTabs } from './HubTabs';

const tabs = [
  { id: 'a', label: 'Primera' },
  { id: 'b', label: 'Segunda' },
  { id: 'c', label: 'Tercera' },
] as const;

it('cambia con click y flechas, sin sacar el foco del tablist', () => {
  const onChange = vi.fn();
  render(<HubTabs tabs={tabs} active="a" onChange={onChange} ariaLabel="Prueba" />);
  const first = screen.getByRole('tab', { name: 'Primera' });
  expect(first.getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab', { name: 'Segunda' }));
  expect(onChange).toHaveBeenCalledWith('b');
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith('b');
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Segunda' }));
});

it('Home/End saltan al primero y al último', () => {
  const onChange = vi.fn();
  render(<HubTabs tabs={tabs} active="b" onChange={onChange} ariaLabel="Prueba" />);
  const active = screen.getByRole('tab', { name: 'Segunda' });
  fireEvent.keyDown(active, { key: 'Home' });
  expect(onChange).toHaveBeenLastCalledWith('a');
  fireEvent.keyDown(active, { key: 'End' });
  expect(onChange).toHaveBeenLastCalledWith('c');
});
```

- [ ] **Step 2: correr y ver el fallo**

Run: `npx vitest run src/components/HubTabs.test.tsx`
Expected: FAIL porque el componente no existe.

- [ ] **Step 3: implementar**

```tsx
import type { KeyboardEvent } from 'react';
import { Icon, type IconName } from './Icon';

export interface HubTab {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon?: IconName;
}

export function HubTabs({
  tabs,
  active,
  onChange,
  ariaLabel,
}: {
  readonly tabs: readonly HubTab[];
  readonly active: string;
  readonly onChange: (id: string) => void;
  readonly ariaLabel: string;
}) {
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[next];
    target?.focus();
    onChange(tabs[next]!.id);
  }

  return (
    <div className="hub-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          data-tooltip={tab.hint}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => move(event, index)}
          className={`hub-tab${active === tab.id ? ' active' : ''}`}
        >
          {tab.icon ? <Icon name={tab.icon} size={14} /> : null}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: correr el test**

Run: `npx vitest run src/components/HubTabs.test.tsx`
Expected: PASS.

---

## Task 5: Laboratorio de medios

**Files:**
- Create: `src/features/lab/MediaLabView.tsx`
- Modify: `src/App.tsx`, `src/components/Sidebar.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consume: `onNavigate`, visits lazy views.
- Produce: tabs `Convertir`, `Comprimir`, `Denoise`, `Upscale`, `Comparar`, `Fondo`.
- Los `onNavigate` de las vistas internas que apunten a otra tab del lab se interceptan.

- [ ] **Step 1: test de integración que falla**

```ts
it('abre el Laboratorio y cambia entre utilidades sin perder la superficie', async () => {
  renderApp();
  nav('Laboratorio');
  const main = screen.getByRole('main');
  expect(await within(main).findByRole('tab', { name: 'Convertir' })).toBeTruthy();
  fireEvent.click(within(main).getByRole('tab', { name: 'Denoise' }));
  await waitFor(() => expect(main.textContent).toContain('Reducir ruido en tiempo real'));
  expect(within(main).getByRole('tab', { name: 'Denoise' }).getAttribute('aria-selected')).toBe('true');
});
```

- [ ] **Step 2: implementar `MediaLabView`**

```tsx
import { lazy, Suspense, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { HubTabs, type HubTab } from '../../components/HubTabs';

const ConvertView = lazy(() =>
  import('../convert/ConvertView').then((m) => ({ default: m.ConvertView })),
);
const CompressView = lazy(() =>
  import('../compress/CompressView').then((m) => ({ default: m.CompressView })),
);
const DenoiseView = lazy(() =>
  import('../denoise/DenoiseView').then((m) => ({ default: m.DenoiseView })),
);
const UpscaleView = lazy(() =>
  import('../ai/UpscaleView').then((m) => ({ default: m.UpscaleView })),
);
const CompareView = lazy(() =>
  import('../compare/CompareView').then((m) => ({ default: m.CompareView })),
);
const RemoveBackgroundView = lazy(() =>
  import('../ai/RemoveBackgroundView').then((m) => ({ default: m.RemoveBackgroundView })),
);

type LabTab = 'convert' | 'compress' | 'denoise' | 'upscale' | 'compare' | 'background';

const TABS: readonly (HubTab & { id: LabTab })[] = [
  { id: 'convert', label: 'Convertir' },
  { id: 'compress', label: 'Comprimir' },
  { id: 'denoise', label: 'Denoise' },
  { id: 'upscale', label: 'Upscale' },
  { id: 'compare', label: 'Comparar' },
  { id: 'background', label: 'Fondo' },
];

export function MediaLabView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const [active, setActive] = useState<LabTab>('convert');
  const [visited, setVisited] = useState<ReadonlySet<LabTab>>(() => new Set<LabTab>(['convert']));

  function select(id: LabTab): void {
    setActive(id);
    setVisited((current) => (current.has(id) ? current : new Set(current).add(id)));
  }

  function route(id: ViewId): void {
    if (id === 'convert' || id === 'compress' || id === 'denoise' || id === 'upscale' || id === 'compare' || id === 'background') {
      select(id);
      return;
    }
    onNavigate(id);
  }

  return (
    <section className="view hub-view" aria-label="Laboratorio de medios">
      <HubTabs tabs={TABS} active={active} onChange={(id) => select(id as LabTab)} ariaLabel="Utilidades de medios" />
      {visited.has('convert') ? <div className="hub-panel" hidden={active !== 'convert'}><Suspense fallback={null}><ConvertView onNavigate={route} /></Suspense></div> : null}
      {visited.has('compress') ? <div className="hub-panel" hidden={active !== 'compress'}><Suspense fallback={null}><CompressView onNavigate={route} /></Suspense></div> : null}
      {visited.has('denoise') ? <div className="hub-panel" hidden={active !== 'denoise'}><Suspense fallback={null}><DenoiseView onNavigate={route} /></Suspense></div> : null}
      {visited.has('upscale') ? <div className="hub-panel" hidden={active !== 'upscale'}><Suspense fallback={null}><UpscaleView onNavigate={route} /></Suspense></div> : null}
      {visited.has('compare') ? <div className="hub-panel" hidden={active !== 'compare'}><Suspense fallback={null}><CompareView onNavigate={route} /></Suspense></div> : null}
      {visited.has('background') ? <div className="hub-panel" hidden={active !== 'background'}><Suspense fallback={null}><RemoveBackgroundView onNavigate={route} /></Suspense></div> : null}
    </section>
  );
}
```

- [ ] **Step 3: conectar en App**

- `const loadLab = () => import('./features/lab/MediaLabView').then(...)`
- `const MediaLabView = lazy(loadLab)`
- `VIEW_PRELOADERS.lab = loadLab`
- `case 'lab': return <MediaLabView onNavigate={navigate} />;`
- Añadir `lab` a `VIEW_ICONS` en `Sidebar` con `'convert'`.

- [ ] **Step 4: correr el test**

Run: `npx vitest run src/App.test.tsx -t "Laboratorio"`
Expected: PASS.

---

## Task 6: Hubs de Descargar y Creador

**Files:**
- Create: `src/features/download/DownloadsHubView.tsx`
- Create: `src/features/creator/CreatorHubView.tsx`
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Descargar: tabs `Descargar`, `YouTube`, `Cumplimiento`.
- Creador: tabs `Crear`, `Fábrica`, `Miniaturas`, `Localización`.
- Las vistas internas se montan al visitarlas y se conservan ocultas.

- [ ] **Step 1: tests de integración**

```ts
it('agrupa YouTube y Cumplimiento dentro de Descargar', async () => {
  renderApp();
  nav('Descargar');
  const main = screen.getByRole('main');
  fireEvent.click(await within(main).findByRole('tab', { name: 'YouTube' }));
  expect(await within(main).findByText(/analizador de canales/i)).toBeTruthy();
  fireEvent.click(within(main).getByRole('tab', { name: 'Cumplimiento' }));
  expect(await within(main).findByText(/Auditoría de preflight/i)).toBeTruthy();
});

it('agrupa la fábrica, miniaturas y localización dentro de Creador', async () => {
  renderApp();
  nav('Creador');
  const main = screen.getByRole('main');
  fireEvent.click(await within(main).findByRole('tab', { name: 'Miniaturas' }));
  await waitFor(() =>
    expect(screen.getByRole('main').textContent).toContain('Miniaturas que se entienden en el feed'),
  );
});
```

- [ ] **Step 2: implementar los hubs**

`DownloadsHubView`:

```tsx
const DownloadView = lazy(() =>
  import('./DownloadView').then((m) => ({ default: m.DownloadView })),
);
const YouTubeAnalyzerView = lazy(() =>
  import('../youtube/YouTubeAnalyzerView').then((m) => ({ default: m.YouTubeAnalyzerView })),
);
const ComplianceView = lazy(() =>
  import('../compliance/ComplianceView').then((m) => ({ default: m.ComplianceView })),
);

export function DownloadsHubView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  // mismo patrón visited/active que MediaLabView
}
```

`CreatorHubView`: misma estructura con `CreatorView`, `FactoryView`,
`ThumbnailView`, `LocalizationView`, interceptando `factory`, `thumbnails`,
`localization` y `creator`.

- [ ] **Step 3: conectar en App**

`case 'download': return <DownloadsHubView onNavigate={navigate} />;`
`case 'creator': return <CreatorHubView onNavigate={navigate} />;`

Mantener los casos de `youtube`, `compliance`, `factory`, etc. para deep
links y paleta.

- [ ] **Step 4: correr los tests**

Run: `npx vitest run src/App.test.tsx -t "agrupa"`
Expected: PASS.

---

## Task 7: IA y MCP salen del rail, entran en Ajustes

**Files:**
- Modify: `src/features/settings/SettingsHome.tsx`
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Produce: `SettingsHome({ onNavigate })`.
- Produce: botones `Abrir AI Hub` y `Servidores MCP`.
- Al navegar desde Ajustes, la ventana flotante se cierra antes de cambiar de vista.

- [ ] **Step 1: test que falla**

```ts
it('llega a AI Hub y MCP desde Ajustes, no desde el rail', async () => {
  renderApp();
  nav('Ajustes');
  const modal = await screen.findByRole('dialog', { name: 'Configuración' });
  fireEvent.click(within(modal).getByRole('button', { name: /Inteligencia artificial/i }));
  fireEvent.click(await within(modal).findByRole('button', { name: /Abrir AI Hub/i }));
  await waitFor(() =>
    expect(screen.getByRole('main').textContent).toContain('Skills compactas para no gastar tokens'),
  );
});
```

- [ ] **Step 2: implementar**

En `SettingsHome`:

```tsx
export function SettingsHome({ onNavigate }: { readonly onNavigate?: (id: ViewId) => void } = {}) { ... }
```

Dentro de la sección `ia`, después de la tarjeta del proveedor:

```tsx
<article className="card">
  <p className="eyebrow">Asistente e integraciones</p>
  <h3>IA y MCP</h3>
  <p className="muted">
    El asistente global se abre con Ctrl+K o el dock flotante. Las skills,
    prompts y el operador local viven en AI Hub; los servidores MCP se
    administran en una pantalla aparte.
  </p>
  <div className="actions">
    <button type="button" className="ghost" onClick={() => onNavigate?.('ai-hub')}>Abrir AI Hub</button>
    <button type="button" className="ghost" onClick={() => onNavigate?.('mcp')}>Servidores MCP</button>
  </div>
</article>
```

En `Shell`:

```tsx
<SettingsWindow onClose={() => setSettingsOpen(false)}>
  <SettingsHome
    onNavigate={(id) => {
      setSettingsOpen(false);
      navigate(id);
    }}
  />
</SettingsWindow>
```

- [ ] **Step 3: correr el test**

Run: `npx vitest run src/App.test.tsx -t "Ajustes"`
Expected: PASS.

---

## Task 8: AppShell con 3 píldoras y “Más”

**Files:**
- Modify: `src/components/AppShell.tsx`
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- `AppShell` acepta `moreViews?: readonly NavView[]`.
- `App` pasa `MAIN_NAV_VIEWS` filtradas por experiencia y `SECONDARY_NAV_VIEWS`.

- [ ] **Step 1: actualizar los tests de workspaces**

`railLabels()` debe usar `MAIN_NAV_VIEWS` y esperar las mismas 9 superficies en
los tres workspaces. El test de Ingesta verifica que la píldora navega a
Descargar; el de Creador, que navega a Creador; ambos conservan el rail global
y el botón `Más herramientas`.
Eliminar el test de la píldora AI Hub; reemplazarlo por:

```ts
it('navegar a AI Hub desde Ajustes no rompe la píldora activa', async () => {
  renderApp();
  nav('Ajustes');
  const modal = await screen.findByRole('dialog', { name: 'Configuración' });
  fireEvent.click(within(modal).getByRole('button', { name: /Inteligencia artificial/i }));
  fireEvent.click(await within(modal).findByRole('button', { name: /Abrir AI Hub/i }));
  await waitFor(() =>
    expect(screen.getByRole('navigation', { name: /espacios de trabajo/i }).textContent).toContain('Studio'),
  );
});
```

- [ ] **Step 2: implementar**

En `App.tsx`:

```ts
const railViews = useMemo(
  () => filterViewsForMode(MAIN_NAV_VIEWS, experienceMode),
  [experienceMode],
);
```

El rail es fijo; `AppShell` no vuelve a filtrar por workspace. Pasar:

```tsx
<AppShell
  activeId={activeId}
  views={railViews}
  moreViews={SECONDARY_NAV_VIEWS}
  ...
/>
```

En `AppShell`, agregar `moreViews` a props y pasarlo a `Sidebar`.
El `MenuBar` recibe el rail global (sólo las 9).

- [ ] **Step 3: correr los tests**

Run: `npx vitest run src/App.test.tsx -t "espacios de trabajo"`
Expected: PASS.

---

## Task 9: CSS de tabs, popover y paneles

**Files:**
- Modify: `src/styles/commercial.css`

- [ ] **Step 1: agregar estilos**

```css
.hub-view { display: grid; gap: 14px; max-width: 1180px; }
.hub-tabs {
  position: sticky; top: 0; z-index: 12; display: flex; gap: 4px;
  padding: 5px; border: 1px solid var(--commercial-border);
  border-radius: 10px; background: rgba(24, 27, 32, 0.9);
  backdrop-filter: blur(8px); overflow-x: auto;
}
.hub-tab {
  display: inline-flex; align-items: center; gap: 6px; border: 0;
  border-radius: 7px; padding: 7px 11px; background: transparent;
  color: var(--commercial-muted); font-size: 11.5px; font-weight: 650;
  white-space: nowrap; cursor: pointer;
}
.hub-tab:hover { color: var(--commercial-text); background: rgba(255,255,255,.04); }
.hub-tab.active {
  color: var(--commercial-text); background: rgba(31, 94, 255, .16);
  box-shadow: inset 0 0 0 1px rgba(31,94,255,.4);
}
.hub-panel[hidden] { display: none !important; }
.hub-panel .view-toolbar { display: none; } /* evita duplicar el título del hub */
.nav-more { position: relative; }
.nav-more-list {
  position: absolute; left: calc(100% + 8px); top: 0; z-index: 40;
  min-width: 190px; max-height: 60vh; overflow: auto; padding: 6px;
  border: 1px solid var(--commercial-border); border-radius: 10px;
  background: rgba(20, 23, 28, .98); box-shadow: 0 18px 40px rgba(0,0,0,.45);
}
.nav-more-list button { justify-content: flex-start; width: 100%; }
```

- [ ] **Step 2: verificar en preview**

Run: `npm run build` y `npm run preview -- --host 127.0.0.1`.
Abrir `?view=download`, `?view=creator`, `?view=lab` y comprobar tabs,
rail y popover a 1366×768.

---

## Task 10: Verificación final de la fase

- [x] `npm run typecheck`
- [x] `npx vitest run` (suite de escritorio, 952/952)
- [x] `npm test` (suite raíz, 1343/1343 en 163 archivos)
- [ ] Revisar que `?view=convert`, `?view=youtube`, `?view=ai-hub` sigan
  abriendo sus vistas (compatibilidad de deep links).
- [x] Actualizar `docs/IMPROVEMENT-QUEUE.md` con números medidos.
- [x] No commit, no push, no instalación.

## Autocrítica del plan

- Cobertura: rail de 9, 3 workspaces, hubs de Descargar/Creador/Laboratorio,
  IA/MCP fuera del rail, progressive disclosure y accesibilidad.
- Fase 1B ejecutada: rutas canónicas, deep links normalizados, hubs y editor
  inicializados en el tab/modo pedido y rutas standalone duplicadas retiradas.
- Próxima fase: hardening del golden path y auditoría legal (Fase 2).
- No hay placeholders: cada tarea tiene test, implementación y comando.
