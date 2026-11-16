// @vitest-environment jsdom
/**
 * Auditoría axe-core de las vistas shell principales.
 *
 * Corre axe sobre el DOM real montado por React Testing Library con el
 * servicio falso (`createFakeService`), igual que `App.test.tsx`. Las reglas
 * que jsdom no puede evaluar (color-contrast, scroll/focus por layout) están
 * documentadas y deshabilitadas en `src/test/axe.ts`.
 *
 * El criterio del suite: cero violaciones `critical` y `serious` no
 * registradas en `KNOWN_ISSUES`. Cualquier violación nueva de cualquier
 * impacto se reporta por consola; las critical/serious rompen el test.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { App } from '../App';
import { StartScreen } from '../features/start/StartScreen';
import { ExportDialog } from '../features/editor/ExportDialog';
import { AppearanceProvider } from '../state/AppearanceProvider';
import { ProjectProvider } from '../state/project-store';
import { FlowQueueProvider } from '../state/FlowQueueProvider';
import { addAsset, addClipFromAsset, ensureDelivery } from '../state/project-actions';
import { createFakeService, readyAsset } from '../test/fake-service';
import { formatViolations, runAxe, type AxeViolation } from '../test/axe';

const NOW = '2026-11-13T00:00:00.000Z';

/**
 * Violaciones conocidas pendientes de corrección (axe id → motivo).
 * Sacar la entrada al arreglar; agregar sólo con evidencia de que el fix
 * es grande o depende de layout real (jsdom no lo puede medir).
 */
const KNOWN_ISSUES: Readonly<Record<string, string>> = {};

function isKnown(violation: AxeViolation): boolean {
  return violation.id in KNOWN_ISSUES;
}

function unexpected(violations: readonly AxeViolation[]): AxeViolation[] {
  return violations.filter((violation) => !isKnown(violation));
}

function assertNoBlockers(violations: readonly AxeViolation[], vista: string): void {
  const fresh = unexpected(violations);
  // eslint-disable-next-line no-console
  console.log(`\n=== axe · ${vista} ===\n${formatViolations(fresh)}`);
  const blockers = fresh.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(
    blockers,
    `Violaciones critical/serious en ${vista}:\n${formatViolations(blockers)}`,
  ).toEqual([]);
}

async function nav(label: string): Promise<void> {
  const navigation = screen.getByRole('navigation', { name: /vistas/i });
  const find = () => within(navigation).queryByRole('button', { name: label });
  if (!find()) {
    const more = within(navigation).queryByRole('button', { name: /Más herramientas/i });
    if (more) fireEvent.click(more);
  }
  const button = await waitFor(() => {
    const found = find();
    if (!found) throw new Error(`nav: no aparece el botón «${label}»`);
    return found;
  });
  fireEvent.click(button);
}

async function createProject(name = 'Obra a11y'): Promise<void> {
  await nav('Proyectos');
  // «Proyectos» es un panel lazy dentro del editor: hay que esperarlo.
  const input = await within(screen.getByRole('main')).findByRole('textbox', { name: /nombre/i });
  fireEvent.change(input, { target: { value: name } });
  fireEvent.click(await screen.findByRole('button', { name: /Crear y elegir ubicación/i }));
  await waitFor(
    () => {
      expect(document.querySelector('.timeline-surface')).toBeTruthy();
    },
    { timeout: 8000 },
  );
}

function renderApp() {
  const service = createFakeService();
  render(<App service={service} />);
  return service;
}

function projectWithClip(): { project: ProjectDocument; service: ReturnType<typeof createFakeService> } {
  const base = ensureDelivery(createEmptyProject('Export a11y', NOW));
  const asset = readyAsset();
  const project = addClipFromAsset(addAsset(base, asset), asset, {
    atFrame: 0,
    durationFrames: 90,
  }).project;
  return { project, service: createFakeService() };
}

beforeAll(() => {
  // jsdom no implementa canvas; axe lo consulta para detectar iconos
  // ligadura. Devolver null evita el ruido "Not implemented" en stderr.
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  }
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('auditoría axe · StartScreen', () => {
  it('no tiene violaciones critical/serious', async () => {
    const service = createFakeService();
    render(
      <AppearanceProvider>
        <ProjectProvider service={service}>
          <FlowQueueProvider>
            <StartScreen onEnterApp={() => {}} />
          </FlowQueueProvider>
        </ProjectProvider>
      </AppearanceProvider>,
    );
    await screen.findByRole('button', { name: /Abrir actualizador de la app/i });
    const audit = await runAxe();
    assertNoBlockers(unexpected(audit.violations), 'StartScreen');
  });
});

describe('auditoría axe · shell (Inicio dentro del editor)', () => {
  it('la vista Inicio dentro del editor no tiene violaciones critical/serious', async () => {
    renderApp();
    // UN SOLO EDITOR: Inicio ya no es la pantalla de arranque, es un host
    // del modo «Todo». Se navega a él y se audita el mismo shell.
    await nav('Inicio');
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.textContent).toContain('Estudio Web'), {
      timeout: 10_000,
    });
    expect(document.querySelectorAll('.editor-workspace.alaukcut-chrome')).toHaveLength(1);
    const audit = await runAxe();
    assertNoBlockers(unexpected(audit.violations), 'shell · Inicio dentro del editor');
  });
});

describe('auditoría axe · editor (Timeline + Preview)', () => {
  it('el editor con proyecto no tiene violaciones critical/serious', async () => {
    renderApp();
    await createProject();
    // El editor monta timeline, preview e inspector; esperamos la superficie.
    await waitFor(() => expect(document.querySelector('.preview-panel')).toBeTruthy(), {
      timeout: 10000,
    });
    const audit = await runAxe();
    assertNoBlockers(unexpected(audit.violations), 'editor · Timeline+Preview');
  });
});

describe('auditoría axe · ExportDialog', () => {
  it('el diálogo de exportación no tiene violaciones critical/serious', async () => {
    const { project, service } = projectWithClip();
    render(
      <ProjectProvider
        service={service}
        initial={{
          project,
          opened: {
            project,
            label: 'export.editoria.json',
            path: 'C:\\tester\\export.editoria.json',
            root: 'C:\\tester',
          },
        }}
      >
        <ExportDialog open onClose={() => {}} />
      </ProjectProvider>,
    );
    const dialog = await screen.findByRole('dialog', {}, { timeout: 8000 });
    await waitFor(() => expect(dialog.textContent).toMatch(/Exportar|Formato/i), {
      timeout: 8000,
    });
    const audit = await runAxe(dialog);
    assertNoBlockers(unexpected(audit.violations), 'ExportDialog');
  });
});

describe('auditoría axe · Ajustes (SettingsHome dentro del editor)', () => {
  it('el panel de Ajustes no tiene violaciones critical/serious', async () => {
    renderApp();
    await nav('Ajustes');
    // Enmienda 2026-11-14: ya no hay diálogo «Configuración» ni ventana
    // flotante; SettingsHome es un panel del modo «Todo» del editor.
    const sections = await screen.findByRole(
      'navigation',
      { name: /Secciones de Ajustes/i },
      { timeout: 10_000 },
    );
    expect(within(sections).getByRole('button', { name: /Apariencia/i })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Configuración' })).toBeNull();
    const audit = await runAxe(sections);
    assertNoBlockers(unexpected(audit.violations), 'Ajustes · SettingsHome en el editor');
  });
});

describe('auditoría axe · MCP', () => {
  it('la vista MCP no tiene violaciones critical/serious', async () => {
    renderApp();
    await nav('MCP');
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.textContent).toMatch(/MCP|servidor/i), {
      timeout: 10000,
    });
    const audit = await runAxe();
    assertNoBlockers(unexpected(audit.violations), 'MCP · McpView');
  });
});
