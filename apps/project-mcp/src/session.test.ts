import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectMcpError, ProjectSession } from './session';
import { createMcpTools } from './tools';

const dirs: string[] = [];

function workspace(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'editoria-mcp-test-'));
  dirs.push(dir);
  return { dir, file: join(dir, 'proyecto.editoria.json') };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('sesión MCP del proyecto', () => {
  it('crea, guarda y vuelve a leer un proyecto validado', () => {
    const { dir, file } = workspace();
    const session = new ProjectSession(dir, file);
    const project = session.create('Proyecto MCP', { width: 1280, height: 720, fps: 25 });
    expect(project.name).toBe('Proyecto MCP');
    expect(project.video.width).toBe(1280);
    expect(project.video.height).toBe(720);
    expect(project.video.frameRate.num / project.video.frameRate.den).toBe(25);
    expect(existsSync(file)).toBe(true);
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    expect(onDisk.name).toBe('Proyecto MCP');

    const reopened = new ProjectSession(dir, file);
    expect(reopened.load().video.width).toBe(1280);
  });

  it('rechaza crear sobre un archivo existente', () => {
    const { dir, file } = workspace();
    const session = new ProjectSession(dir, file);
    session.create('Uno');
    expect(() => session.create('Dos')).toThrow(ProjectMcpError);
  });

  it('detecta cambios externos antes de escribir', () => {
    const { dir, file } = workspace();
    const session = new ProjectSession(dir, file);
    session.create('Conflicto');
    const raw = readFileSync(file, 'utf8');
    writeFileSync(file, `${raw}\n`, 'utf8');
    expect(() => session.mutate((project) => project)).toThrow(/cambió en disco/);
  });

  it('rechaza rutas fuera del workspace', () => {
    const { dir, file } = workspace();
    const outside = join(file, '..', '..', 'afuera.editoria.json');
    expect(() => new ProjectSession(dir, outside)).toThrow(/workspace/);
  });

  it('rechaza un proyecto inválido', () => {
    const { dir, file } = workspace();
    writeFileSync(file, '{"name":"roto"}', 'utf8');
    const session = new ProjectSession(dir, file);
    expect(() => session.load()).toThrow(ProjectMcpError);
  });

  it('reutiliza las herramientas del asistente para agregar y dividir', async () => {
    const { dir, file } = workspace();
    const session = new ProjectSession(dir, file);
    session.create('Herramientas', { fps: 30 });
    const { tools } = createMcpTools(session);
    const motion = tools.find((tool) => tool.name === 'motion_add')!;
    const added = await motion.run({ templateId: 'title-card', text: 'Hola' });
    expect(added.ok).toBe(true);
    const timeline = tools.find((tool) => tool.name === 'timeline_list')!;
    const listed = await timeline.run({});
    const clips = (listed.data as { clips: Array<{ id: string; startFrame: number }> }).clips;
    expect(clips).toHaveLength(1);
    const split = tools.find((tool) => tool.name === 'clip_split')!;
    const result = await split.run({ clipId: clips[0]!.id, frame: 15 });
    expect(result.ok).toBe(true);
    const after = await timeline.run({});
    expect((after.data as { clips: unknown[] }).clips).toHaveLength(2);
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    expect(onDisk.timeline.clips).toHaveLength(2);
  });

  it('valida los argumentos de las herramientas reutilizadas', async () => {
    const { dir, file } = workspace();
    const session = new ProjectSession(dir, file);
    session.create('Validación');
    const { tools } = createMcpTools(session);
    const split = tools.find((tool) => tool.name === 'clip_split')!;
    const outcome = await split.run({ frame: 'x' });
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain('entero');
  });
});
