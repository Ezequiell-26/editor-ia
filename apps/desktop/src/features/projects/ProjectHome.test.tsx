// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createEmptyProject } from '@editor-ia/project-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import {
  INITIAL_FLOW,
  createNativeProjectService,
  describeFlow,
  safeDisplayLabel,
  sanitizeForUi,
  transition,
  type NativeInvoke,
  type OpenedProject,
  type ProjectService,
} from '../../services/project-service';

const SECRET_DIR = 'C:\\Users\\ofici\\proyectos-privados';
const SECRET_FULL = `${SECRET_DIR}\\corte.editoria.json`;

function opened(name = 'Corte de prueba'): OpenedProject {
  return { project: createEmptyProject(name), label: 'corte.editoria.json' };
}

type FakeService = ProjectService & { calls: { create: number; open: number; save: number } };

function fakeService(overrides: Partial<ProjectService> = {}): FakeService {
  const calls = { create: 0, open: 0, save: 0 };
  const impl: ProjectService = {
    available: true,
    unavailableReason: null,
    createProject: async (name: string) => opened(name),
    openProject: async () => opened(),
    saveProject: async (project) => opened(project.name),
    ...overrides,
  };
  return {
    ...impl,
    createProject: (name: string) => {
      calls.create += 1;
      return impl.createProject(name);
    },
    openProject: () => {
      calls.open += 1;
      return impl.openProject();
    },
    saveProject: (project) => {
      calls.save += 1;
      return impl.saveProject(project);
    },
    calls,
  };
}

function main(): HTMLElement {
  return screen.getByRole('main');
}

function status(): string {
  return (within(main()).getByRole('status').textContent ?? '').trim();
}

function renameTo(value: string): void {
  fireEvent.change(within(main()).getByRole('textbox', { name: /nombre/i }), {
    target: { value },
  });
}

function click(label: RegExp): void {
  const button = within(main()).getByRole('button', { name: label });
  fireEvent.click(button);
}

function deferred<T>(): { promise: Promise<T>; release: (value: T) => void } {
  let release: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

afterEach(cleanup);

describe('transiciones del flujo', () => {
  it('create y open pasan por loading y terminan en saved limpio', () => {
    const loading = transition(INITIAL_FLOW, { type: 'start', op: 'create' });
    expect(loading.phase).toBe('loading');
    const saved = transition(loading, { type: 'loaded', op: 'create', name: 'Corte' });
    expect(saved.phase).toBe('saved');
    expect(saved.hasUnsavedChanges).toBe(false);
    expect(saved.projectName).toBe('Corte');
  });

  it('editar despues de saved da dirty y guardar conserva el cambio pendiente', () => {
    const saved = transition(INITIAL_FLOW, { type: 'loaded', op: 'open', name: 'Corte' });
    const dirty = transition(saved, { type: 'edited' });
    expect(dirty.phase).toBe('dirty');
    expect(dirty.hasUnsavedChanges).toBe(true);
    const saving = transition(dirty, { type: 'start', op: 'save' });
    expect(saving.phase).toBe('saving');
    expect(saving.hasUnsavedChanges).toBe(true);
    const done = transition(saving, { type: 'loaded', op: 'save', name: 'Corte' });
    expect(done.phase).toBe('saved');
    expect(done.hasUnsavedChanges).toBe(false);
  });

  it('un guardado que falla queda failed CON el cambio pendiente intacto', () => {
    const saving = transition(INITIAL_FLOW, { type: 'start', op: 'save' });
    const failed = transition(saving, { type: 'failed', op: 'save', reason: 'disco lleno' });
    expect(failed.phase).toBe('failed');
    expect(failed.hasUnsavedChanges).toBe(true);
    expect(failed.reason).toBe('disco lleno');
  });

  it('un open fallido no inventa cambios y una cancelacion vuelve a idle', () => {
    const loading = transition(INITIAL_FLOW, { type: 'start', op: 'open' });
    expect(
      transition(loading, { type: 'failed', op: 'open', reason: 'JSON roto' }).hasUnsavedChanges,
    ).toBe(false);
    expect(transition(loading, { type: 'cancelled' }).phase).toBe('idle');
  });

  it('describeFlow muestra los seis estados con una frase distinta cada uno', () => {
    const loaded = transition(INITIAL_FLOW, { type: 'loaded', op: 'open', name: 'Corte' });
    expect(describeFlow(INITIAL_FLOW)).toMatch(/Sin proyecto abierto/i);
    expect(describeFlow(transition(INITIAL_FLOW, { type: 'start', op: 'create' }))).toMatch(
      /Creando proyecto/i,
    );
    expect(describeFlow(transition(loaded, { type: 'edited' }))).toMatch(/Cambios sin guardar/i);
    expect(describeFlow(transition(loaded, { type: 'start', op: 'save' }))).toMatch(
      /Guardando proyecto/i,
    );
    expect(describeFlow(loaded)).toMatch(/Proyecto abierto/i);
    expect(
      describeFlow(transition(loaded, { type: 'failed', op: 'save', reason: 'disco lleno' })),
    ).toMatch(/Fall[oó]/i);
  });
});

describe('ProjectHome conectado al borde de proyecto', () => {
  it('crea un proyecto con el adapter de test y muestra loading y saved', async () => {
    const { promise, release } = deferred<OpenedProject>();
    const service = fakeService({ createProject: () => promise });
    render(<App service={service} />);
    expect(status()).toMatch(/Sin proyecto abierto/i);

    renameTo('Corte de prueba');
    click(/Crear proyecto/i);
    expect(status()).toMatch(/Creando proyecto/i);

    release(opened('Corte de prueba'));
    await waitFor(() => expect(status()).toMatch(/Proyecto creado/i));
    expect(status()).toMatch(/Corte de prueba/i);
    expect(service.calls.create).toBe(1);
  });

  it('abrir muestra el nombre del proyecto y dirty al renombrar', async () => {
    const service = fakeService();
    render(<App service={service} />);
    click(/Abrir proyecto/i);
    await waitFor(() => expect(status()).toMatch(/Proyecto abierto/i));
    expect(status()).toMatch(/Corte de prueba/i);

    renameTo('Otro nombre');
    expect(status()).toMatch(/Cambios sin guardar/i);
    expect(service.calls.open).toBe(1);
  });

  it('guardar muestra saving y despues guardado con el nombre editado', async () => {
    const { promise, release } = deferred<OpenedProject>();
    const service = fakeService({ saveProject: () => promise });
    render(<App service={service} />);
    click(/Abrir proyecto/i);
    await waitFor(() => expect(within(main()).getByRole('button', { name: /Guardar/i })).toBeTruthy());
    renameTo('Renombre');
    click(/Guardar/i);
    expect(status()).toMatch(/Guardando proyecto/i);

    release(opened('Renombre'));
    await waitFor(() => expect(status()).toMatch(/Guardado/i));
    expect(status()).toMatch(/Renombre/i);
    expect(service.calls.save).toBe(1);
  });

  it('un guardado fallido muestra failed sin fingir guardado y conserva los cambios', async () => {
    const service = fakeService({
      saveProject: async () => {
        throw new Error(`EEXIST: cannot write ${SECRET_FULL}`);
      },
    });
    render(<App service={service} />);
    click(/Abrir proyecto/i);
    await waitFor(() => expect(status()).toMatch(/Proyecto abierto/i));
    renameTo('Renombre');
    click(/Guardar/i);

    await waitFor(() => expect(status()).toMatch(/Fall[oó]/i));
    expect(status()).toMatch(/sin guardar/i);
    expect(status()).not.toMatch(/Guardado/i);
  });

  it('ningun estado filtra la ruta absoluta ni la carpeta del usuario', async () => {
    const service = fakeService({
      openProject: async () => {
        throw new Error(`permiso denegado al leer ${SECRET_DIR}\\otro.editoria.json`);
      },
    });
    render(<App service={service} />);
    click(/Abrir proyecto/i);
    await waitFor(() => expect(status()).toMatch(/Fall[oó]/i));
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('C:\\Users\\ofici');
    expect(text).not.toContain('proyectos-privados');
  });

  it('safeDisplayLabel y sanitizeForUi dejan solo el nombre del archivo', () => {
    expect(safeDisplayLabel(SECRET_FULL)).toBe('corte.editoria.json');
    expect(safeDisplayLabel('/home/obra/corte.editoria.json')).toBe('corte.editoria.json');
    expect(sanitizeForUi(`error en ${SECRET_FULL}`)).not.toContain('proyectos-privados');
    expect(sanitizeForUi('el archivo no existe')).toBe('el archivo no existe');
  });

  it('cancelar el dialogo vuelve a idle sin mostrar un error', async () => {
    const service = fakeService({ openProject: async () => null });
    render(<App service={service} />);
    click(/Abrir proyecto/i);
    await waitFor(() => expect(status()).toMatch(/Sin proyecto abierto/i));
    expect(status()).not.toMatch(/Fall[oó]/i);
  });

  it('un nombre vacio lo rechaza el cliente y no llega al borde', async () => {
    const service = fakeService();
    render(<App service={service} />);
    click(/Crear proyecto/i);
    await waitFor(() => expect(status()).toMatch(/Fall[oó]/i));
    expect(status()).toMatch(/nombre/i);
    expect(service.calls.create).toBe(0);
  });

  it('sin runtime nativo los controles estan inhabilitados y la pantalla lo dice', () => {
    render(<App />);
    const buttons = within(main()).queryAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(
        (button as HTMLButtonElement).disabled,
        `${button.textContent ?? ''} deberia estar inhabilitado`,
      ).toBe(true);
    }
    expect(main().textContent).toMatch(/tarea 4/i);
  });
});

describe('adapter nativo sobre invoke de Tauri', () => {
  it('usa los nombres de comando que la tarea 4 debe implementar y deja solo el archivo', async () => {
    const seen: string[] = [];
    const invoke: NativeInvoke = async (command) => {
      seen.push(command);
      return { project: createEmptyProject('Obra'), path: SECRET_FULL };
    };
    const service = createNativeProjectService(invoke);
    const result = await service.createProject('Obra');
    expect(seen).toEqual(['create_project']);
    expect(result.project.name).toBe('Obra');
    expect(result.label).toBe('corte.editoria.json');
  });

  it('un documento invalido o de otra version no se cuela a la UI', async () => {
    const invoke: NativeInvoke = async () => ({
      project: { schemaVersion: 99, id: 'x' },
      path: SECRET_FULL,
    });
    const service = createNativeProjectService(invoke);
    await expect(service.createProject('Obra')).rejects.toThrow(/version/i);
  });

  it('un dialogo cancelado devuelve null, no un error', async () => {
    const invoke: NativeInvoke = async () => null;
    expect(await createNativeProjectService(invoke).openProject()).toBeNull();
  });
});
