import { describe, expect, it } from 'vitest';
import { NAV_VIEWS, type ViewId } from './navigation';
import { PIPELINE_STAGES, computePipeline, pipelineSignals } from './pipeline';
import { resolveViewRoute } from './view-routing';
import {
  WORKSPACE_GROUPS,
  WORKSPACE_STEPS,
  WORKSPACE_STEP_COUNT,
  WORKSPACE_TOOLS,
  currentWorkspaceStep,
  workspaceGroupFor,
  workspaceStepForView,
  workspaceToolFor,
} from './workspace-map';

describe('mapa único del estudio', () => {
  it('deriva los seis pasos de la ruta de producción, sin copiar otra lista', () => {
    expect(WORKSPACE_STEP_COUNT).toBe(6);
    expect(WORKSPACE_STEPS.map((step) => step.id)).toEqual(
      PIPELINE_STAGES.map((stage) => stage.id),
    );
    for (const step of WORKSPACE_STEPS) {
      expect(step.detail.length).toBeGreaterThan(20);
      expect(step.tip.length).toBeGreaterThan(10);
      expect(step.view).toBeTruthy();
    }
  });

  it('cubre los 33 ViewId exactamente una vez, sin sobrantes ni faltantes', () => {
    const grouped = WORKSPACE_GROUPS.flatMap((group) => group.views);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(new Set<ViewId>(NAV_VIEWS.map((view) => view.id)));
    expect(grouped.length).toBe(NAV_VIEWS.length);
  });

  it('cada herramienta usa la etiqueta real y la ruta canónica', () => {
    expect(WORKSPACE_TOOLS).toHaveLength(NAV_VIEWS.length);
    for (const tool of WORKSPACE_TOOLS) {
      const nav = NAV_VIEWS.find((view) => view.id === tool.view);
      expect(tool.label).toBe(nav?.label);
      expect(tool.hint).toBe(nav?.hint);
      const route = resolveViewRoute(tool.view);
      expect(tool.canonicalView).toBe(route.view);
      expect(tool.editorMode).toBe(route.editorMode);
      expect(tool.hubTab).toBe(route.hubTab);
    }
    expect(workspaceToolFor('mixer')?.editorMode).toBe('mixer');
    expect(workspaceToolFor('denoise')?.hubTab).toBe('denoise');
    expect(workspaceGroupFor('motion')?.id).toBe('editar');
    expect(workspaceGroupFor('upscale')?.id).toBe('potenciar');
  });

  it('señala la primera etapa pendiente y no inventa una completada', () => {
    const empty = computePipeline(pipelineSignals(null, false));
    expect(currentWorkspaceStep(empty)?.id).toBe('project');
    expect(workspaceStepForView('editor')?.id).toBe('edit');
    expect(currentWorkspaceStep({ ...empty, complete: true, next: null })).toBeNull();
  });
});
