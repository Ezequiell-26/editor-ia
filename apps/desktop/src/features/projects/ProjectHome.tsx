import { useState } from 'react';
import type { ProjectDocument } from '@editor-ia/project-schema';
import {
  INITIAL_FLOW,
  describeFlow,
  sanitizeForUi,
  transition,
  type OpenedProject,
  type ProjectFlowState,
  type ProjectOp,
  type ProjectService,
} from '../../services/project-service';

interface ProjectHomeProps {
  readonly service: ProjectService;
}

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeForUi(message);
}

export function ProjectHome({ service }: ProjectHomeProps) {
  const [flow, setFlow] = useState<ProjectFlowState>(INITIAL_FLOW);
  const [project, setProject] = useState<ProjectDocument | null>(null);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [name, setName] = useState('');

  const fail = (op: ProjectOp, reason: string): void => {
    setFlow((current) => transition(current, { type: 'failed', op, reason }));
  };

  const adopt = (op: ProjectOp, opened: OpenedProject): void => {
    setProject(opened.project);
    setFileLabel(opened.label);
    setName(opened.project.name);
    setFlow((current) =>
      transition(current, { type: 'loaded', op, name: opened.project.name }),
    );
  };

  async function createProject(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      fail('create', 'el proyecto necesita un nombre');
      return;
    }
    setFlow((current) => transition(current, { type: 'start', op: 'create' }));
    try {
      adopt('create', await service.createProject(trimmed));
    } catch (error) {
      fail('create', reasonOf(error));
    }
  }

  async function openProject(): Promise<void> {
    setFlow((current) => transition(current, { type: 'start', op: 'open' }));
    try {
      const opened = await service.openProject();
      if (opened === null) {
        setFlow(() => INITIAL_FLOW);
        return;
      }
      adopt('open', opened);
    } catch (error) {
      fail('open', reasonOf(error));
    }
  }

  async function saveProject(): Promise<void> {
    if (project === null) {
      return;
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      fail('save', 'el proyecto necesita un nombre');
      return;
    }
    setFlow((current) => transition(current, { type: 'start', op: 'save' }));
    try {
      adopt('save', await service.saveProject({ ...project, name: trimmed }));
    } catch (error) {
      fail('save', reasonOf(error));
    }
  }

  function onNameChange(value: string): void {
    setName(value);
    if (project !== null) {
      setFlow((current) => transition(current, { type: 'edited' }));
    }
  }

  const locked = !service.available;

  return (
    <section className="view">
      <h2>Projects</h2>
      <p className="view-summary">Proyectos guardados en este dispositivo.</p>
      <p className="empty-state">
        Todavía no hay proyectos guardados en este dispositivo. La lista se llena apenas un
        archivo <code>.editoria.json</code> existe en el disco.
      </p>
      <p className="status" role="status" aria-live="polite">
        {describeFlow(flow)}
      </p>
      <div className="project-form">
        <label htmlFor="project-name">Nombre del proyecto</label>
        <input
          id="project-name"
          type="text"
          value={name}
          disabled={locked}
          onChange={(event) => {
            onNameChange(event.target.value);
          }}
        />
        <div className="actions">
          <button type="button" onClick={createProject} disabled={locked || project !== null}>
            Crear proyecto
          </button>
          <button type="button" onClick={openProject} disabled={locked}>
            Abrir proyecto
          </button>
          <button type="button" onClick={saveProject} disabled={locked || project === null}>
            Guardar
          </button>
        </div>
      </div>
      {locked ? (
        <p className="notice">{service.unavailableReason}</p>
      ) : (
        <p className="notice">
          {fileLabel === null
            ? 'Todavía no hay ningún archivo de proyecto abierto.'
            : `Archivo abierto: ${fileLabel}`}
        </p>
      )}
    </section>
  );
}
