/**
 * Sesión de proyecto para el servidor MCP: lee y escribe el archivo del
 * proyecto con validación de schema, escritura atómica y detección de cambios
 * externos. No mantiene estado compartido con la app; si el archivo cambió
 * desde la lectura, rechaza la escritura en vez de pisar trabajo.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  createEmptyProject,
  parseProject,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import { ensureDelivery } from '../../desktop/src/state/project-actions';

const MAX_PROJECT_BYTES = 32 * 1024 * 1024;

export class ProjectMcpError extends Error {
  readonly code: 'NOT_FOUND' | 'INVALID' | 'CONFLICT' | 'PATH' | 'LIMIT';
  constructor(code: ProjectMcpError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export interface ProjectBaseline {
  mtimeMs: number;
  size: number;
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!!rel && !rel.startsWith('..') && !rel.includes(`..${sep}`));
}

export class ProjectSession {
  readonly workspace: string;
  readonly projectPath: string;
  private document: ProjectDocument | null = null;
  private baseline: ProjectBaseline | null = null;
  private lastConflict: string | null = null;

  constructor(workspace: string, projectPath: string) {
    this.workspace = realpathSync(resolve(workspace));
    this.projectPath = resolve(projectPath);
    if (!isAbsolute(this.projectPath)) {
      throw new ProjectMcpError('PATH', 'la ruta del proyecto debe ser absoluta');
    }
    this.assertInsideWorkspace(this.projectPath);
  }

  private assertInsideWorkspace(target: string): void {
    const parent = existsSync(target) ? dirname(realpathSync(target)) : dirname(target);
    const root = this.workspace;
    if (!within(root, target) && !within(root, parent)) {
      throw new ProjectMcpError(
        'PATH',
        'el proyecto debe vivir dentro del workspace configurado',
      );
    }
  }

  get project(): ProjectDocument | null {
    return this.document;
  }

  get conflict(): string | null {
    return this.lastConflict;
  }

  hasProject(): boolean {
    return this.document !== null;
  }

  load(): ProjectDocument {
    if (!existsSync(this.projectPath)) {
      throw new ProjectMcpError('NOT_FOUND', `no existe el proyecto ${this.projectPath}`);
    }
    const stat = statSync(this.projectPath);
    if (stat.size > MAX_PROJECT_BYTES) {
      throw new ProjectMcpError('LIMIT', 'el proyecto supera 32 MB');
    }
    const raw = readFileSync(this.projectPath, 'utf8');
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new ProjectMcpError('INVALID', 'el proyecto no es JSON legible');
    }
    const parsed = parseProject(json);
    if (!parsed.ok) {
      const first = parsed.issues[0];
      throw new ProjectMcpError(
        'INVALID',
        `proyecto inválido${first ? ` (${first.path}: ${first.message})` : ''}`,
      );
    }
    this.document = parsed.project;
    this.baseline = { mtimeMs: stat.mtimeMs, size: stat.size };
    this.lastConflict = null;
    return parsed.project;
  }

  create(name: string, options: {
    width?: number;
    height?: number;
    fps?: number;
  } = {}): ProjectDocument {
    if (existsSync(this.projectPath)) {
      throw new ProjectMcpError('CONFLICT', 'el archivo ya existe; abrí el proyecto en vez de crearlo');
    }
    const trimmed = name.trim();
    if (!trimmed) throw new ProjectMcpError('INVALID', 'el proyecto necesita un nombre');
    this.assertInsideWorkspace(this.projectPath);
    const project = createEmptyProject(trimmed);
    const next: ProjectDocument = ensureDelivery({
      ...project,
      video: {
        ...project.video,
        ...(options.width ? { width: Math.round(options.width) } : {}),
        ...(options.height ? { height: Math.round(options.height) } : {}),
        ...(options.fps
          ? { frameRate: { num: Math.round(options.fps * 1000), den: 1000 } }
          : {}),
      },
    });
    const parsed = parseProject(next);
    if (!parsed.ok) {
      const first = parsed.issues[0];
      throw new ProjectMcpError(
        'INVALID',
        `proyecto inválido${first ? ` (${first.path}: ${first.message})` : ''}`,
      );
    }
    this.write(parsed.project);
    this.document = parsed.project;
    return parsed.project;
  }

  /** Aplica una edición validada y la persiste; devuelve el proyecto nuevo. */
  mutate(update: (project: ProjectDocument) => ProjectDocument): ProjectDocument {
    if (!this.document) {
      throw new ProjectMcpError('NOT_FOUND', 'no hay un proyecto abierto en el servidor MCP');
    }
    this.checkExternalChange();
    const next = update(structuredClone(this.document));
    const parsed = parseProject(next);
    if (!parsed.ok) {
      const first = parsed.issues[0];
      throw new ProjectMcpError(
        'INVALID',
        `la edición dejaría el proyecto inválido${first ? ` (${first.path}: ${first.message})` : ''}`,
      );
    }
    this.write(parsed.project);
    this.document = parsed.project;
    return parsed.project;
  }

  save(): ProjectDocument {
    if (!this.document) {
      throw new ProjectMcpError('NOT_FOUND', 'no hay un proyecto abierto en el servidor MCP');
    }
    this.checkExternalChange();
    this.write(this.document);
    return this.document;
  }

  private checkExternalChange(): void {
    if (!this.baseline || !existsSync(this.projectPath)) return;
    const stat = statSync(this.projectPath);
    if (stat.mtimeMs !== this.baseline.mtimeMs || stat.size !== this.baseline.size) {
      this.lastConflict =
        'el proyecto cambió en disco desde que el servidor MCP lo leyó; volvé a abrirlo o guardá desde la app antes de editar';
      throw new ProjectMcpError('CONFLICT', this.lastConflict);
    }
  }

  private write(project: ProjectDocument): void {
    mkdirSync(dirname(this.projectPath), { recursive: true });
    const json = `${JSON.stringify(project, null, 2)}\n`;
    if (Buffer.byteLength(json, 'utf8') > MAX_PROJECT_BYTES) {
      throw new ProjectMcpError('LIMIT', 'el proyecto supera 32 MB');
    }
    const temp = `${this.projectPath}.mcp-${randomUUID()}.tmp`;
    const fd = openSync(temp, 'w');
    try {
      writeSync(fd, json);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, this.projectPath);
    const stat = statSync(this.projectPath);
    this.baseline = { mtimeMs: stat.mtimeMs, size: stat.size };
    this.lastConflict = null;
  }
}
