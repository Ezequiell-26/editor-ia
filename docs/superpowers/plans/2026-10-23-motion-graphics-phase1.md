# Motion Graphics Studio — Fase 1: implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un estudio nativo de motion graphics (título, lower-third, end card y stat callout) con preview editable, clips gráficos en la timeline y render real por ASS/FFmpeg, sin Remotion ni runtimes nuevos.

**Architecture:** El catálogo TS valida props y produce un `MotionPlan` neutral. La preview React y el renderer Rust consumen el mismo plan: el renderer convierte capas en eventos ASS y los quema antes de los subtítulos. El proyecto persiste sólo `MotionItem` + clip `graphic`; el plan se deriva al renderizar.

**Tech Stack:** React 19 + TypeScript, Zod, Vitest, Tauri 2, Rust, FFmpeg/libass, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-motion-graphics-mit-design.md`

## Global Constraints

- **No hacer commit ni push sin pedido explícito del usuario.** Los checkpoints del plan son verificaciones, no commits.
- No agregar Remotion ni dependencias de runtime nuevas; Fase 1 usa sólo React, Zod, Tauri y FFmpeg ya presentes.
- No ejecutar Node/Chromium para renderizar. El ASS se genera en Rust y se quema con FFmpeg.
- Mantener el formato de proyecto v1; no agregar claves raíz ni campos obligatorios nuevos.
- Todo texto que llega a ASS se escapa; todo número se valida finito y dentro de rango.
- Un clip `graphic` sin plan válido debe fallar el render con un mensaje claro; nunca omitirse.
- Trabajar en `feat/motion-graphics` y preservar los cambios locales del arreglo de `markers`.

---

### Task 1: Catálogo de plantillas y MotionPlan

**Files:**
- Create: `apps/desktop/src/features/motion/templates.ts`
- Create: `apps/desktop/src/features/motion/plan.ts`
- Create: `apps/desktop/src/features/motion/motion.test.ts`

**Interfaces:**
- Produce: `MotionPlan`, `MotionLayer`, `MotionTemplate`, `buildMotionPlan`, `buildProjectMotionPlans`, `templateById`, `MotionPlanError`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/features/motion/motion.test.ts
import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import {
  buildMotionPlan,
  buildProjectMotionPlans,
  lowerThirdTemplate,
  MotionPlanError,
  titleCardTemplate,
} from './plan';
import { templateById } from './templates';

const NOW = '2026-01-01T00:00:00.000Z';
const context = {
  width: 1920,
  height: 1080,
  fpsNum: 30,
  fpsDen: 1,
  durationFrames: 90,
};

describe('motion plan', () => {
  it('construye un lower third con fondo y dos textos', () => {
    const plan = buildMotionPlan(
      lowerThirdTemplate,
      { name: 'Ana Pérez', role: 'Editora', accent: '#7dd3c0', side: 'left', animation: 'slide-left' },
      context,
    );
    expect(plan.layers.filter((layer) => layer.kind === 'text')).toHaveLength(2);
    expect(plan.layers.some((layer) => layer.kind === 'rect')).toBe(true);
    for (const layer of plan.layers) {
      expect(layer.x).toBeGreaterThanOrEqual(0);
      expect(layer.x + layer.width).toBeLessThanOrEqual(1.0001);
      expect(layer.y).toBeGreaterThanOrEqual(0);
      expect(layer.y + layer.height).toBeLessThanOrEqual(1.0001);
    }
  });

  it('rechaza un color inválido sin inventar una plantilla', () => {
    expect(() =>
      buildMotionPlan(
        lowerThirdTemplate,
        { name: 'Ana', role: '', accent: 'rojo', side: 'left', animation: 'fade' },
        context,
      ),
    ).toThrow(MotionPlanError);
  });

  it('envuelve un título largo en varias líneas y respeta el límite', () => {
    const plan = buildMotionPlan(
      titleCardTemplate,
      {
        title: 'Una historia larga sobre edición de video que necesita varias líneas para entrar',
        subtitle: 'Prueba',
        background: '#0f172a',
        accent: '#7dd3c0',
        align: 'left',
        animation: 'slide-up',
      },
      context,
    );
    const texts = plan.layers.filter((layer) => layer.kind === 'text');
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.length).toBeLessThanOrEqual(6);
  });

  it('indexa planes por clip y reporta un motion faltante', () => {
    const project = createEmptyProject('Motion', NOW);
    const track = {
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'graphic' as const,
      label: 'G1',
      order: 0,
      muted: false,
      hidden: false,
      locked: false,
    };
    project.timeline.tracks.push(track);
    project.motion.push({
      id: '00000000-0000-4000-8000-000000000002',
      template: { id: 'lower-third', version: '1.0.0', source: 'bundled' },
      props: { name: 'Ana', role: '', accent: '#7dd3c0', side: 'left', animation: 'fade' },
    });
    project.timeline.clips.push({
      id: '00000000-0000-4000-8000-000000000003',
      trackId: track.id,
      kind: 'graphic',
      label: 'Placa',
      startFrame: 0,
      durationFrames: 90,
      source: { type: 'graphic', motionId: project.motion[0]!.id },
    });
    const bundle = buildProjectMotionPlans(project);
    expect(bundle.plans['00000000-0000-4000-8000-000000000003']).toBeDefined();
    expect(bundle.errors).toEqual([]);

    project.timeline.clips[0]!.source = {
      type: 'graphic',
      motionId: '00000000-0000-4000-8000-000000000099',
    };
    const broken = buildProjectMotionPlans(project);
    expect(broken.errors[0]).toMatch(/no existe/i);
  });

  it('expone las cuatro plantillas con versión', () => {
    for (const id of ['title-card', 'lower-third', 'end-card', 'stat-callout']) {
      expect(templateById(id)?.version).toBe('1.0.0');
    }
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run apps/desktop/src/features/motion/motion.test.ts`

Expected: FAIL because `./plan` and `./templates` do not exist.

- [ ] **Step 3: Implement the catalog**

`templates.ts` defines the four templates, their Zod props, defaults, UI fields and layer builders. Use these exact shared types:

```ts
import { z } from 'zod';

export const MOTION_ANIMATIONS = ['none', 'fade', 'slide-up', 'slide-left', 'pop'] as const;
export type MotionAnimationKind = (typeof MOTION_ANIMATIONS)[number];

export interface MotionAnimation {
  readonly kind: MotionAnimationKind;
  readonly inFrames?: number;
  readonly outFrames?: number;
  /** Distancia normalizada 0..1 para slide-up/slide-left. */
  readonly distance?: number;
}

export interface MotionTextLayer {
  readonly kind: 'text';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSizePx: number;
  readonly weight: number;
  readonly color: string;
  readonly align: 'left' | 'center' | 'right';
  readonly animation: MotionAnimation;
}

export interface MotionRectLayer {
  readonly kind: 'rect';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly opacity: number;
  readonly animation: MotionAnimation;
}

export type MotionLayer = MotionTextLayer | MotionRectLayer;

export interface MotionPlan {
  readonly version: 1;
  readonly width: number;
  readonly height: number;
  readonly fps: { readonly num: number; readonly den: number };
  readonly durationFrames: number;
  readonly layers: readonly MotionLayer[];
}

export interface MotionContext {
  readonly width: number;
  readonly height: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
  readonly durationFrames: number;
}

export interface MotionField {
  readonly id: string;
  readonly label: string;
  readonly kind: 'text' | 'textarea' | 'color' | 'select' | 'number';
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly min?: number;
  readonly max?: number;
}

export interface MotionTemplate {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly description: string;
  readonly category: 'título' | 'identidad' | 'cierre' | 'dato';
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly fields: readonly MotionField[];
  readonly propsSchema: z.ZodTypeAny;
  buildLayers(props: Record<string, unknown>, context: MotionContext): MotionLayer[];
}
```

Helpers:
- `hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)`.
- `animationSchema = z.enum(MOTION_ANIMATIONS).default('fade')`.
- `wrapText(text, maxChars, maxLines = 6): string[]`: split on spaces and explicit newlines, never exceed `maxLines`, append `…` if truncated.
- `textLayers(...)`: one layer per line with `y + index * lineHeight`.
- `rectLayer(...)`.

The four templates must have these exact defaults and fields:

| id | defaults | fields |
| --- | --- | --- |
| `title-card` | `{title:'Tu próxima historia', subtitle:'Editor IA', background:'#0f172a', accent:'#7dd3c0', align:'left', animation:'slide-up'}` | title, subtitle, background, accent, align, animation |
| `lower-third` | `{name:'Nombre Apellido', role:'Rol o especialidad', accent:'#7dd3c0', side:'left', animation:'slide-left'}` | name, role, accent, side, animation |
| `end-card` | `{title:'Gracias por ver', cta:'Suscribite para más', background:'#0f172a', accent:'#7dd3c0', animation:'fade'}` | title, cta, background, accent, animation |
| `stat-callout` | `{value:'+120%', label:'más retención', accent:'#7dd3c0', animation:'pop'}` | value, label, accent, animation |

Layer geometry (normalized; title card on 16:9):
- `title-card`: full background rect `(0,0,1,1)` opacity 0.94; accent bar `(0.08,0.40,0.12,0.008)`; title lines at `x=0.08`, `y=0.44`, `width=0.84`, `fontSizePx=92`, weight 700; subtitle at `x=0.08`, `y=0.74`, `fontSizePx=38`, color `#cbd5e1`.
- `lower-third`: background `(0.06,0.66,0.60,0.20)` opacity 0.9; accent bar `(0.06,0.66,0.012,0.20)`; name at `x=0.10,y=0.69,width=0.52,fontSizePx=56,weight=700`; role at `y=0.79,fontSizePx=28,color=#cbd5e1`. If `side === 'right'`, mirror x: `1 - x - width`.
- `end-card`: full background opacity 0.96; title centered at `x=0.12,y=0.38,width=0.76,fontSizePx=84,align='center'`; CTA at `y=0.62,fontSizePx=36,color=accent`.
- `stat-callout`: background `(0.08,0.28,0.44,0.40)` opacity 0.88; accent bar `(0.08,0.28,0.008,0.40)`; value at `x=0.12,y=0.33,width=0.36,fontSizePx=110,weight=700,color=accent`; label at `y=0.60,fontSizePx=30,color=#e2e8f0`.

- [ ] **Step 4: Implement `plan.ts`**

```ts
import type { ProjectDocument } from '@editor-ia/project-schema';
import type { MotionPlan, MotionTemplate, MotionContext } from './templates';
import { templateById } from './templates';

export class MotionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MotionPlanError';
  }
}

export function buildMotionPlan(
  template: MotionTemplate,
  props: Record<string, unknown>,
  context: MotionContext,
): MotionPlan {
  const parsed = template.propsSchema.safeParse(props);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new MotionPlanError(
      first ? `${first.path.join('.')}: ${first.message}` : 'props inválidas',
    );
  }
  const layers = template.buildLayers(parsed.data as Record<string, unknown>, context).slice(0, 16);
  return {
    version: 1,
    width: context.width,
    height: context.height,
    fps: { num: context.fpsNum, den: context.fpsDen },
    durationFrames: context.durationFrames,
    layers,
  };
}

export interface MotionPlanBundle {
  readonly plans: Record<string, MotionPlan>;
  readonly errors: string[];
}

export function buildProjectMotionPlans(project: ProjectDocument): MotionPlanBundle {
  const plans: Record<string, MotionPlan> = {};
  const errors: string[] = [];
  for (const clip of project.timeline.clips) {
    if (clip.kind !== 'graphic') continue;
    const motion = project.motion.find((item) => item.id === clip.source.motionId);
    if (!motion) {
      errors.push(`Clip ${clip.label ?? clip.id}: el motion item no existe`);
      continue;
    }
    const template = templateById(motion.template.id);
    if (!template) {
      errors.push(`Clip ${clip.label ?? clip.id}: plantilla ${motion.template.id} desconocida`);
      continue;
    }
    try {
      plans[clip.id] = buildMotionPlan(template, motion.props, {
        width: project.video.width,
        height: project.video.height,
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        durationFrames: clip.durationFrames,
      });
    } catch (error) {
      errors.push(
        `Clip ${clip.label ?? clip.id}: ${error instanceof Error ? error.message : 'props inválidas'}`,
      );
    }
  }
  return { plans, errors };
}

export function motionPlanForClip(
  project: ProjectDocument,
  clipId: string,
): MotionPlan | null {
  return buildProjectMotionPlans(project).plans[clipId] ?? null;
}
```

Export `lowerThirdTemplate` and `titleCardTemplate` as constants (and the other two) from `templates.ts`; re-export them from `plan.ts` for the tests and UI convenience.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run apps/desktop/src/features/motion/motion.test.ts`

Expected: PASS (5 tests).

---

### Task 2: Acciones de proyecto para clips gráficos

**Files:**
- Modify: `apps/desktop/src/state/project-actions.ts`
- Modify: `apps/desktop/src/state/project-actions.test.ts`

**Interfaces:**
- Produce: `addMotionGraphic(project, input)` and `updateMotionProps(project, motionId, props)`.

- [ ] **Step 1: Write the failing tests**

```ts
it('agrega un motion item y un clip graphic en una pista nueva', () => {
  const added = addMotionGraphic(base(), {
    templateId: 'lower-third',
    templateVersion: '1.0.0',
    props: { name: 'Ana', role: 'Editora', accent: '#7dd3c0', side: 'left', animation: 'fade' },
    durationFrames: 60,
    atFrame: 0,
  });
  const project = validated(added.project);
  const track = project.timeline.tracks.find((item) => item.id === added.trackId);
  const clip = project.timeline.clips.find((item) => item.id === added.clipId);
  expect(track?.kind).toBe('graphic');
  expect(clip).toMatchObject({
    kind: 'graphic',
    trackId: added.trackId,
    startFrame: 0,
    durationFrames: 60,
    source: { type: 'graphic', motionId: added.motionId },
  });
  expect(project.motion.find((item) => item.id === added.motionId)?.props.name).toBe('Ana');
});

it('actualiza props de un motion item y rechaza un id ausente', () => {
  const added = addMotionGraphic(base(), {
    templateId: 'title-card',
    templateVersion: '1.0.0',
    props: { title: 'Hola' },
    durationFrames: 30,
    atFrame: 0,
  });
  const updated = updateMotionProps(added.project, added.motionId, { title: 'Chau' });
  expect(updated.motion.find((item) => item.id === added.motionId)?.props.title).toBe('Chau');
  expect(() => updateMotionProps(updated, '00000000-0000-4000-8000-000000000099', {})).toThrow(
    ProjectActionError,
  );
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run apps/desktop/src/state/project-actions.test.ts -t "motion"`

Expected: FAIL because `addMotionGraphic` is not exported.

- [ ] **Step 3: Implement**

Import `MotionItem` from `@editor-ia/project-schema`. Add after `addAdjustmentLayer`:

```ts
export function addMotionGraphic(
  project: ProjectDocument,
  input: {
    readonly templateId: string;
    readonly templateVersion: string;
    readonly props: Readonly<Record<string, unknown>>;
    readonly durationFrames: number;
    readonly atFrame: number;
    readonly trackId?: string;
    readonly label?: string;
  },
): { project: ProjectDocument; motionId: string; clipId: string; trackId: string; startFrame: number } {
  const durationFrames = Math.max(1, Math.round(input.durationFrames));
  const next = cloneProject(project);
  let track = input.trackId
    ? next.timeline.tracks.find((item) => item.id === input.trackId)
    : next.timeline.tracks.find((item) => item.kind === 'graphic' && !item.locked);
  if (input.trackId) {
    if (!track || track.kind !== 'graphic') {
      throw new ProjectActionError('la pista elegida no es una pista gráfica');
    }
    if (track.locked) throw new ProjectActionError('la pista gráfica está bloqueada');
  } else if (!track) {
    const created = addTrack(next, 'graphic', 'G1');
    next.timeline = created.project.timeline;
    track = next.timeline.tracks.find((item) => item.id === created.trackId);
    if (!track) throw new ProjectActionError('no se pudo crear la pista gráfica');
  }
  const startFrame = findGap(
    intervalsForTrack(next, track.id),
    Math.max(0, Math.round(input.atFrame)),
    durationFrames,
  );
  const motionId = newId();
  const clipId = newId();
  const motion: MotionItem = {
    id: motionId,
    template: {
      id: input.templateId,
      version: input.templateVersion,
      source: 'bundled',
    },
    props: { ...input.props },
  };
  next.motion.push(motion);
  next.timeline.clips.push({
    id: clipId,
    trackId: track.id,
    kind: 'graphic',
    label: input.label?.trim() || `Gráfico · ${input.templateId}`,
    startFrame,
    durationFrames,
    source: { type: 'graphic', motionId },
  });
  touch(next);
  return { project: next, motionId, clipId, trackId: track.id, startFrame };
}

export function updateMotionProps(
  project: ProjectDocument,
  motionId: string,
  props: Readonly<Record<string, unknown>>,
): ProjectDocument {
  const next = cloneProject(project);
  const motion = next.motion.find((item) => item.id === motionId);
  if (!motion) throw new ProjectActionError('el motion item no existe');
  motion.props = { ...props };
  touch(next);
  return next;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/desktop/src/state/project-actions.test.ts -t "motion"`

Expected: PASS.

---

### Task 3: Vista Motion, preview y navegación

**Files:**
- Create: `apps/desktop/src/features/motion/MotionPreview.tsx`
- Create: `apps/desktop/src/features/motion/MotionForm.tsx`
- Create: `apps/desktop/src/features/motion/MotionView.tsx`
- Create: `apps/desktop/src/features/motion/MotionView.test.tsx`
- Modify: `apps/desktop/src/app/navigation.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/Sidebar.tsx`
- Modify: `apps/desktop/src/components/Icon.tsx`
- Modify: `apps/desktop/src/App.test.tsx`
- Modify: `apps/desktop/src/styles/app.css`

**Interfaces:**
- `MotionPreview({ plan, progress })`
- `MotionForm({ template, props, onChange })`
- `MotionView({ onNavigate })`

- [ ] **Step 1: Write the failing UI test**

In `MotionView.test.tsx`, use the same fake service/store pattern as `App.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { createFakeService } from '../../test/fake-service';

afterEach(cleanup);

describe('vista Motion', () => {
  it('agrega un título a la timeline', async () => {
    render(<App service={createFakeService()} />);
    fireEvent.click(screen.getByRole('button', { name: /Crear proyecto/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /nombre/i }), {
      target: { value: 'Motion QA' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Crear y elegir ubicación/i }));
    fireEvent.click(
      within(screen.getByRole('navigation', { name: /vistas/i })).getByRole('button', {
        name: 'Motion',
      }),
    );
    expect(await screen.findByRole('heading', { name: /Motion/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Título de apertura/i }));
    fireEvent.click(screen.getByRole('button', { name: /Agregar a la timeline/i }));
    expect(await screen.findByText(/Gráfico agregado/i)).toBeTruthy();
  });
});
```

Import `within` from `@testing-library/react`. Use a fake project creation flow if the existing App test's `createProject` is easier; duplicate the setup here, no placeholders.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run apps/desktop/src/features/motion/MotionView.test.tsx`

Expected: FAIL because the view/nav do not exist.

- [ ] **Step 3: Add navigation, icon and lazy route**

- `navigation.ts`: add `'motion'` to `ViewId`; add `{ id:'motion', label:'Motion', hint:'Motion graphics · Títulos, lower-thirds y cierres con render local', group:'herramientas' }` after `ai-hub`; add `'motion'` to `PIPELINE_HIDDEN_VIEWS`.
- `App.tsx`: add `loadMotion` (lazy import), `const MotionView = lazy(loadMotion)`, `motion: loadMotion` in `VIEW_PRELOADERS`, and `case 'motion': return <MotionView onNavigate={navigate} />;`.
- `Sidebar.tsx`: `motion: 'motion'`.
- `Icon.tsx`: add `'motion'` to `IconName`; render a 24px SVG with a rectangle and two text bars:
```tsx
'motion': (
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M7 10h10M7 14h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </>
),
```
- `App.test.tsx`: add `'Motion'` to the expected navigation list after `'AI Hub'`.

- [ ] **Step 4: Implement the preview and form**

`MotionPreview.tsx` uses percentages and container-query font sizing. Add `layerVisual` in `plan.ts` or a local helper:

```tsx
import type { MotionLayer, MotionPlan } from './templates';

function easeOut(value: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, value)), 3);
}

export function layerVisual(layer: MotionLayer, progress: number, durationFrames: number) {
  const animation = layer.animation;
  const frames = Math.max(1, animation.inFrames ?? Math.round(durationFrames * 0.12));
  const intro = Math.min(1, Math.max(0, (progress * durationFrames) / frames));
  const outroFrames = animation.outFrames ?? 0;
  const outro = outroFrames > 0
    ? Math.min(1, Math.max(0, ((1 - progress) * durationFrames) / outroFrames))
    : 1;
  const opacity = Math.min(easeOut(intro), outro);
  const distance = animation.distance ?? 0.05;
  if (animation.kind === 'slide-up') {
    return { opacity, transform: `translateY(${(1 - easeOut(intro)) * distance * 100}%)` };
  }
  if (animation.kind === 'slide-left') {
    return { opacity, transform: `translateX(${(1 - easeOut(intro)) * distance * 100}%)` };
  }
  if (animation.kind === 'pop') {
    const scale = 0.7 + 0.3 * easeOut(intro);
    return { opacity, transform: `scale(${scale})` };
  }
  return { opacity, transform: 'none' };
}

export function MotionPreview({ plan, progress }: { plan: MotionPlan; progress: number }) {
  return (
    <div
      className="motion-preview"
      style={{ aspectRatio: `${plan.width} / ${plan.height}`, containerType: 'inline-size' }}
      aria-label="Previsualización de motion graphics"
    >
      {plan.layers.map((layer, index) => {
        const visual = layerVisual(layer, progress, plan.durationFrames);
        const common = {
          position: 'absolute' as const,
          left: `${layer.x * 100}%`,
          top: `${layer.y * 100}%`,
          width: `${layer.width * 100}%`,
          height: `${layer.height * 100}%`,
          opacity: visual.opacity,
          transform: visual.transform,
        };
        if (layer.kind === 'rect') {
          return <div key={index} style={{ ...common, background: layer.color, borderRadius: 8 }} />;
        }
        return (
          <div
            key={index}
            style={{
              ...common,
              color: layer.color,
              fontFamily: layer.fontFamily,
              fontSize: `${(layer.fontSizePx / plan.width) * 100}cqw`,
              fontWeight: layer.weight,
              textAlign: layer.align,
              lineHeight: 1.15,
              whiteSpace: 'pre-wrap',
            }}
          >
            {layer.text}
          </div>
        );
      })}
    </div>
  );
}
```

`MotionForm.tsx` renders `template.fields`:
- text/textarea/color/select/number; values from `props[field.id]`; on change use `onChange({...props, [id]: value})`. For number, `Number(event.target.value)`; for color, input type color with a default `#ffffff`.

- [ ] **Step 5: Implement `MotionView.tsx`**

Use `useProjectStore`, `useState` for template id, props, duration seconds, preview progress. Build the plan with `buildMotionPlan(template, props, { width: project.video.width, ... durationFrames })` inside a try/catch; show the error instead of the plan. `add` uses `store.mutate` with `addMotionGraphic`; capture ids outside the recipe; on success `store.setSelection({ kind:'clip', id: clipId })`, set a notice “Gráfico agregado: <label>”, and `onNavigate('editor')`. Disable the button when there is no project or the plan is invalid. The layout has a gallery of four template buttons, the form, the preview, a range for progress, a duration number (1–30 s) and the add button.

- [ ] **Step 6: Add styles**

Add `.motion-view`, `.motion-layout`, `.motion-gallery`, `.motion-template`, `.motion-stage`, `.motion-preview`, `.motion-form`, `.motion-fields` to `app.css`. Use the existing flat/headerless tokens (`--color-border`, `--color-surface`, `--color-text-muted`); no gradients/glows.

- [ ] **Step 7: Run tests**

Run: `npx vitest run apps/desktop/src/features/motion/MotionView.test.tsx apps/desktop/src/App.test.tsx`

Expected: PASS, including the updated navigation list.

---

### Task 4: Preview e Inspector del clip gráfico

**Files:**
- Modify: `apps/desktop/src/features/editor/Preview.tsx`
- Create: `apps/desktop/src/features/motion/MotionClipInspector.tsx`
- Modify: `apps/desktop/src/features/editor/Inspector.tsx`
- Modify: `apps/desktop/src/features/motion/motion.test.ts` (layer visual test)

**Interfaces:**
- `MotionPreview` and `layerVisual` from Task 3.
- `MotionClipInspector({ clip, motion })`.

- [ ] **Step 1: Write a failing layer test**

```ts
it('calcula fade y slide sin salir de rango', () => {
  const layer = {
    kind: 'text' as const,
    x: 0.1, y: 0.1, width: 0.5, height: 0.1,
    text: 'Hola', fontFamily: 'Segoe UI', fontSizePx: 48, weight: 600,
    color: '#ffffff', align: 'left' as const,
    animation: { kind: 'fade' as const, inFrames: 10, outFrames: 10 },
  };
  expect(layerVisual(layer, 0.5, 60).opacity).toBeGreaterThan(0.9);
  expect(layerVisual({ ...layer, animation: { kind: 'slide-up', distance: 0.1 } }, 0.1, 60).transform).toContain('translateY');
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run apps/desktop/src/features/motion/motion.test.ts`

Expected: FAIL because `layerVisual` is not exported yet (it is added in Task 3; if already added, this test passes and is a regression guard).

- [ ] **Step 3: Replace `GraphicLayer` in Preview**

Pass `playheadFrame` to `GraphicLayer`. Find the motion item and template, build the plan with the clip duration, compute `progress = (playheadFrame - clip.startFrame) / Math.max(1, clip.durationFrames)`, and render:
```tsx
<div style={transformStyle(clip, project, playheadFrame)}>
  <MotionPreview plan={plan} progress={progress} />
</div>
```
If the motion/template/plan is invalid, render `<div className="graphic-placeholder">Gráfico inválido: {message}</div>`; never return `null`.

- [ ] **Step 4: Implement `MotionClipInspector`**

Given a graphic clip and its `MotionItem`, find the template; render `MotionForm` with the item props. On change:
```tsx
try {
  store.mutate((current) => ({ project: updateMotionProps(current, motion.id, nextProps) }));
  setError(null);
} catch (error) {
  setError(error instanceof Error ? error.message : 'props inválidas');
}
```
Show the template name, version and a link-free note “Se renderiza al exportar”. If the motion/template is missing, show a clear error.

- [ ] **Step 5: Integrate in `Inspector.tsx`**

Import `MotionClipInspector`. In `ClipInspector`, after the source meta branch, when `clip.kind === 'graphic'` and `source.type === 'graphic'`, render the inspector with the found motion item. Keep the common duration/track controls.

- [ ] **Step 6: Run tests**

Run: `npx vitest run apps/desktop/src/features/motion/motion.test.ts apps/desktop/src/App.test.tsx`

Expected: PASS.

---

### Task 5: API de render con planes (TS)

**Files:**
- Modify: `apps/desktop/src/services/project-service.ts`
- Modify: `apps/desktop/src/test/fake-service.ts`
- Modify: `apps/desktop/src/features/editor/ExportDialog.tsx`
- Modify: `apps/desktop/src/features/factory/FactoryView.tsx`
- Modify: `apps/desktop/src/state/orchestrator.ts`
- Modify: `apps/desktop/src/services/project-service.test.ts` and `apps/desktop/src/test/fake-service.ts` type checks.

**Interfaces:**
- `MotionPlans = Record<string, unknown>`.
- `startRender(profileId, includeCaptions, motionPlans?)`
- `startRenderTo(profileId, outputPath, includeCaptions, motionPlans?)`
- `renderProjectVariant({..., motionPlans?})`.

- [ ] **Step 1: Write the failing service test**

In `project-service.test.ts`, assert the native call receives the plans:
```ts
it('envía los planes de motion al render', async () => {
  const invoke = vi.fn().mockResolvedValue({ jobId: 'job-1', profileName: 'YouTube 1080p' });
  const service = createNativeServiceForTest(invoke);
  await service.startRender('profile-1', true, { 'clip-1': { version: 1 } });
  expect(invoke).toHaveBeenCalledWith('start_render', {
    profileId: 'profile-1',
    includeCaptions: true,
    motionPlans: { 'clip-1': { version: 1 } },
  });
});
```
Use the existing test helper in that file for the native invoke; if none exists, mock `window.__TAURI_INTERNALS__.invoke` before creating the service. Keep the existing style.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run apps/desktop/src/services/project-service.test.ts -t "planes de motion"`

Expected: FAIL because the signature/commands do not accept plans.

- [ ] **Step 3: Implement the service and calls**

- Add `motionPlans?: Record<string, unknown>` to both signatures and pass `motionPlans` in the invoke payload.
- Add the same optional field to `renderProjectVariant` input and invoke payload.
- In `ExportDialog.tsx`, compute `const motionBundle = buildProjectMotionPlans(currentProject);` before each start and pass `motionBundle.plans`. If `motionBundle.errors.length > 0`, set `error` to the first error and do not start. Apply this in `start()` and `startBatch()`, and in the batch queue worker where `startRenderTo` is called.
- In `FactoryView.tsx`, compute the bundle from `assembled` and pass `motionPlans: buildProjectMotionPlans(assembled).plans` to `renderProjectVariant`.
- In `orchestrator.ts`, pass `motionPlans` from the in-memory `project` when it is available; if the orchestrator only has a path, add a `motionPlans` field to the dependency input and pass `{}` is not acceptable: document the limitation in the render command and fail with a clear error if a graphic clip exists. Do not silently omit graphics.

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/desktop/src/services/project-service.test.ts apps/desktop/src/state/orchestrator.test.ts`

Expected: PASS.

---

### Task 6: Rust — validación, ASS e integración de render

**Files:**
- Create: `apps/desktop/src-tauri/src/render/motion.rs`
- Modify: `apps/desktop/src-tauri/src/render/mod.rs`
- Modify: `apps/desktop/src-tauri/src/render/ffmpeg.rs`
- Modify: `apps/desktop/src-tauri/src/commands/render.rs`
- Modify: Rust tests in `render/motion.rs`, `render/ffmpeg.rs`, `commands/render.rs`.

**Interfaces:**
- `build_motion_ass(MotionAssInput) -> Result<String, ProjectError>`.
- `BuildPlanInput` adds `motion_ass: Option<&str>`.

- [ ] **Step 1: Write failing unit tests**

In `render/motion.rs`:
```rust
#[test]
fn genera_eventos_con_texto_escapado_y_animacion() {
    let project = project_with_graphic();
    let plans = serde_json::json!({
        "clip-g": {
            "version": 1, "width": 1920, "height": 1080,
            "fps": {"num": 30, "den": 1}, "durationFrames": 60,
            "layers": [
                {"kind":"rect","x":0.1,"y":0.7,"width":0.5,"height":0.15,"color":"#0f172a","opacity":0.9,"animation":{"kind":"fade","inFrames":10}},
                {"kind":"text","x":0.12,"y":0.72,"width":0.4,"height":0.08,"text":"Ana {Editora}","fontFamily":"Segoe UI","fontSizePx":48,"weight":700,"color":"#ffffff","align":"left","animation":{"kind":"slide-up","inFrames":10,"distance":0.04}}
            ]
        }
    });
    let ass = build_motion_ass(MotionAssInput {
        project: &project, plans: &plans, render_width: 1920, render_height: 1080,
        project_width: 1920, project_height: 1080, project_fps: 30.0,
    }).expect("ass");
    assert!(ass.contains("Ana  Editora"));
    assert!(ass.contains("\\fad("));
    assert!(ass.contains("\\move("));
}

#[test]
fn rechaza_plan_faltante_y_capas_invalidas() {
    let project = project_with_graphic();
    let error = build_motion_ass(MotionAssInput { project: &project, plans: &serde_json::json!({}), render_width: 1920, render_height: 1080, project_width: 1920, project_height: 1080, project_fps: 30.0 }).err().expect("error");
    assert!(error.message.contains("plan de motion"));
}
```

Use a test project with a graphic clip and a visible graphic track. Mirror the existing test fixture style in `ffmpeg.rs`.

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/rust-env.mjs -- cargo test -p editor-ia-desktop motion -- --nocapture`

Expected: FAIL because `render::motion` does not exist.

- [ ] **Step 3: Implement `render/motion.rs`**

The module must:
- Parse `plans` as an object keyed by clip id.
- Iterate visible graphic clips (enabled, track kind `graphic`, not hidden) sorted by track order/start.
- For each clip, require a plan; validate `version == 1`, width/height/fps, duration, layers ≤ 16.
- Validate every layer `kind`, finite numbers in `[0,1]`, color `#rrggbb`, text length ≤ 500, rect opacity 0..1.
- Build an ASS header with `PlayResX/Y`.
- For text, create a style per layer: font, scaled size, color, bold, alignment 7; event with `\an7\pos(x,y)\fad(...)` and `\move`/`\fscx` for animations; escape `{`, `}`, `\`, newlines.
- For rect, build a drawing event: `{\an7\pos(x,y)\p1\c...&\alpha&HAA&\fad(...)}m 0 0 l W 0 l W H l 0 H{\p0}`.
- Use track order as ASS `Layer` (clamped 0..9).
- Return a clear `ProjectError(RenderFailed, "el clip gráfico ... no tiene un plan de motion válido")` when missing/invalid.

Keep helpers `ass_color`/`ass_time` from `subtitles.rs` public and reuse them.

- [ ] **Step 4: Integrate in `ffmpeg.rs`**

- Add `pub motion_ass: Option<&'a str>` to `BuildPlanInput`; update every construction in tests with `motion_ass: None`.
- In the visual clip loop, replace the graphic refusal with `continue` after checking the plan exists. The ASS builder is responsible for the graphic content.
- Before the captions block, write and chain the motion ASS:
```rust
let mut final_video_label = graded_label.clone();
if let Some(motion_ass) = input.motion_ass.filter(|value| !value.is_empty()) {
    std::fs::write(input.temp_dir.join("motion.ass"), motion_ass).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo preparar el motion graphics del render")
    })?;
    filters.push(format!("[{final_video_label}]ass=motion.ass[motion]"));
    final_video_label = "motion".to_owned();
}
if ass.is_empty() {
    filters.push(format!("[{final_video_label}]format=yuv420p[vout]"));
} else {
    // existing captions.ass write...
    filters.push(format!("[{final_video_label}]ass=captions.ass,format=yuv420p[vout]"));
}
```
- Add a unit test that `build_plan` with a graphic clip and `motion_ass: Some("...")` includes `ass=motion.ass` and does not fail. Keep the old refusal test for the case with no plan: move the error to the command layer or return a clear error when a graphic clip exists and `motion_ass` is None/empty.

- [ ] **Step 5: Update the render command**

- Add `motion_plans: Option<Value>` to `start_render`, `start_render_to` and `start_render_with_output`.
- Before `build_plan`, compute:
```rust
let project_width = project["video"]["width"].as_u64().unwrap_or(1920) as u32;
let project_height = project["video"]["height"].as_u64().unwrap_or(1080) as u32;
let project_fps = project["video"]["frameRate"]["num"].as_u64().unwrap_or(30) as f64
    / project["video"]["frameRate"]["den"].as_u64().unwrap_or(1).max(1) as f64;
let motion_ass = match motion_plans {
    Some(plans) => render::motion::build_motion_ass(MotionAssInput {
        project: &project, plans: &plans, render_width: profile.width, render_height: profile.height,
        project_width, project_height, project_fps,
    })?,
    None => {
        let has_graphic = project["timeline"]["clips"].as_array().map(|clips| clips.iter().any(|clip| clip["kind"] == "graphic" && clip["enabled"].as_bool() != Some(false))).unwrap_or(false);
        if has_graphic {
            return Err(ProjectError::message(ProjectErrorCode::RenderFailed, "hay clips gráficos sin plan de motion; volvé a exportar desde el editor"));
        }
        String::new()
    }
};
```
- Pass `motion_ass: Some(&motion_ass)` to `build_plan`. On error, remove the temp dir and return.
- Update `render_project_variant` in `commands/render.rs` if it builds a plan; add the same optional `motion_plans` parameter and pass it. Do not silently drop graphics.

- [ ] **Step 6: Run unit tests**

Run: `node scripts/rust-env.mjs -- cargo test -p editor-ia-desktop motion -- --nocapture`

Expected: PASS.

Run: `node scripts/rust-test.mjs`

Expected: all Rust tests pass (with the new test count).

---

### Task 7: Skill Motion y operador determinista

**Files:**
- Modify: `apps/desktop/src/features/ai-hub/ai-hub.ts`
- Modify: `apps/desktop/src/features/ai-hub/operator.ts`
- Modify: `apps/desktop/src/features/ai-hub/AiHubView.tsx`
- Modify: `apps/desktop/src/features/ai-hub/operator.test.ts`
- Modify: `apps/desktop/src/features/ai-hub/ai-hub.test.ts` (if it asserts the skill count)

**Interfaces:**
- New `AiSkillCategory` `motion`; skill `motion-brief` targeting `motion`.
- New operator action `{ kind:'motion'; templateId; text; secondary? }`.

- [ ] **Step 1: Write the failing parser tests**

```ts
it('crea títulos y lower thirds sin IA', () => {
  expect(parseOperatorCommand('crear titulo Hola mundo', views)).toMatchObject({
    kind: 'motion',
    templateId: 'title-card',
    text: 'Hola mundo',
  });
  expect(parseOperatorCommand('crear lower third Ana Perez, Editora', views)).toMatchObject({
    kind: 'motion',
    templateId: 'lower-third',
    text: 'Ana Perez',
    secondary: 'Editora',
  });
  expect(parseOperatorCommand('crear cierre Gracias', views)).toMatchObject({
    kind: 'motion',
    templateId: 'end-card',
    text: 'Gracias',
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run apps/desktop/src/features/ai-hub/operator.test.ts`

Expected: FAIL because the action does not exist.

- [ ] **Step 3: Implement the parser and skill**

- Add `motion` to `AiSkillCategory`; `categoryLabel` returns 'Motion'.
- Add `motion-brief` to `AI_SKILLS`:
  - name: 'Motion graphics'
  - summary: 'Título, lower-third, cierre o dato con props listos para render.'
  - target: 'motion'
  - output: 'JSON con templateId, props y durationSeconds'
  - prompt: `Elegí una plantilla de motion graphics para el brief. Plantillas: title-card, lower-third, end-card, stat-callout. Devolvé JSON: {"templateId": string, "props": object, "durationSeconds": number, "reason": string}. Usá sólo props documentadas; no inventes campos.`
- Add parsing before the generic create regex:
```ts
const title = text.match(/^(?:crear|hacer|generar)\s+(?:un\s+)?(?:titulo|title|placa de apertura)\s+(.+)$/);
if (title) return { kind: 'motion', templateId: 'title-card', text: title[1]!.trim() };
const lower = text.match(/^(?:crear|hacer|generar)\s+(?:un\s+)?(?:lower third|lower-third|placa|nombre)\s+(.+)$/);
if (lower) {
  const [name, ...role] = lower[1]!.split(/\s*[,;]\s*/);
  return { kind: 'motion', templateId: 'lower-third', text: name!.trim(), secondary: role.join(', ').trim() || undefined };
}
const end = text.match(/^(?:crear|hacer|generar)\s+(?:un\s+)?(?:cierre|end card|endcard|outro)\s+(.+)$/);
if (end) return { kind: 'motion', templateId: 'end-card', text: end[1]!.trim() };
const stat = text.match(/^(?:crear|hacer|generar)\s+(?:un\s+)?(?:dato|stat|estadistica|estadística)\s+(.+)$/);
if (stat) {
  const [value, ...label] = stat[1]!.split(/\s*[,;]\s*/);
  return { kind: 'motion', templateId: 'stat-callout', text: value!.trim(), secondary: label.join(', ').trim() || undefined };
}
```
- Update `OperatorAction` union and `OPERATOR_HELP`.
- In `AiHubView.runOperator`, handle `motion`:
  - If no project, reply 'Abrí o creá un proyecto para agregar un gráfico.'
  - Build props based on template:
    - title-card: `{title: action.text, subtitle:'', background:'#0f172a', accent:'#7dd3c0', align:'left', animation:'slide-up'}`
    - lower-third: `{name: action.text, role: action.secondary ?? '', accent:'#7dd3c0', side:'left', animation:'slide-left'}`
    - end-card: `{title: action.text, cta:'', background:'#0f172a', accent:'#7dd3c0', animation:'fade'}`
    - stat-callout: `{value: action.text, label: action.secondary ?? '', accent:'#7dd3c0', animation:'pop'}`
  - Use `addMotionGraphic(project, { templateId, templateVersion:'1.0.0', props, durationFrames: Math.round(3*fpsOf(project)), atFrame: store.state.playheadFrame })` inside `store.mutate`; capture ids; select the clip and navigate to editor; reply 'Gráfico agregado: ...'.
- `targetLabel` in `AiHubView` add `case 'motion': return 'Motion';`.
- `sendBrief` for motion: store `localStorage.setItem('editoria.motion.brief', brief)` and navigate to motion; the MotionView may show a hint with the brief. Add a `useEffect` in MotionView to read that key and display it, without auto-generating.

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/desktop/src/features/ai-hub`

Expected: PASS.

---

### Task 8: Verificación real, documentación y QA

**Files:**
- Modify: `README.md`
- Modify: `docs/TUTORIAL.md`
- Modify: `THIRD-PARTY-NOTICES.md` (only to record that no new third-party runtime was added)
- Modify: `docs/superpowers/specs/2026-10-23-motion-graphics-mit-design.md` if an implementation detail changed.

- [ ] **Step 1: Run all TypeScript checks**

Run: `npm run typecheck`

Expected: PASS.

Run: `npx vitest run`

Expected: all tests pass.

- [ ] **Step 2: Run Rust tests and formatting**

Run: `node scripts/rust-test.mjs`

Expected: all tests pass.

Run: `node scripts/rust-env.mjs -- cargo fmt --check`

Expected: PASS.

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Real render integration**

Create a synthetic project with a 2 s testsrc2 base and a `title-card` clip using the app (or a test fixture), export through the real command, then verify:
```bash
ffprobe -v error -show_entries format=duration -show_entries stream=width,height,r_frame_rate -of json salida.mp4
```
Extract a frame in the title area and confirm it is not identical to the base:
```bash
ffmpeg -y -ss 1 -i salida.mp4 -frames:v 1 frame.png
```
Use the `image` crate or `ffmpeg` signalstats to assert the accent color appears. Record the exact command/result in the final report. If the ASS path fails, fix it; do not claim success.

- [ ] **Step 5: Visual QA in the real app**

Open the dev app, create a project, go to Motion, add a title and a lower-third, edit props in the Inspector, play the preview, export, and inspect the result. Capture screenshots. Verify no console errors and no `INVALID_PROJECT`.

- [ ] **Step 6: Documentation**

Add to `README.md`:
- A “Motion Graphics nativo” section: four templates, preview, render ASS before captions, no Node/Remotion.
- A limitation: motion is burned on top; not for graphics under video tracks.
- Test counts measured in this pass.
Add to `docs/TUTORIAL.md` a short “Motion” workflow: choose template, fill props, add to timeline, edit in Inspector, export.
Do not claim MCP/Revideo are implemented; they remain phase 3.

- [ ] **Step 7: Final checkpoint**

Run `git status --short` and report the exact files changed. Do not commit or push.

---

## Self-review notes

- Spec coverage: Fase 1 covers catalog, plan, UI, preview, Inspector, ASS render, tests and docs. Fase 2 (skill/operator) is included as Task 7. Fase 3 (MCP/Revideo) is intentionally out of this plan and documented as pending.
- No Remotion, no new runtime, no schema changes.
- The only new error path is a render failure for a graphic clip without a plan; no silent skip.
- The plan does not include commit steps because the user has not authorized commits.
