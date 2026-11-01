import { describe, expect, it } from 'vitest';
import { DEFAULT_EDITOR_PREFERENCES } from '../../state/editor-preferences';
import {
  clampStudioWidth,
  studioGridClasses,
  studioGridStyle,
  studioLayoutFromPreferences,
  type StudioLayout,
} from './studio-layout';

const layout: StudioLayout = {
  leftWidth: 300,
  rightWidth: 340,
  timelineHeight: 280,
  leftCollapsed: false,
  rightCollapsed: false,
  timelineCollapsed: false,
};

describe('layout del Studio', () => {
  it('acota los tres tamaños con los límites compartidos', () => {
    expect(clampStudioWidth('left', 10)).toBe(180);
    expect(clampStudioWidth('left', 9_000)).toBe(520);
    expect(clampStudioWidth('right', 200)).toBe(220);
    expect(clampStudioWidth('timeline', 90)).toBe(120);
    expect(clampStudioWidth('timeline', 999)).toBe(520);
    expect(clampStudioWidth('left', Number.NaN)).toBe(180);
  });

  it('traduce las preferencias al layout y expone variables CSS', () => {
    const fromPrefs = studioLayoutFromPreferences({
      ...DEFAULT_EDITOR_PREFERENCES,
      studioLeftWidth: 280,
      studioRightWidth: 360,
      studioTimelineHeight: 240,
    });
    expect(fromPrefs.leftWidth).toBe(280);
    const style = studioGridStyle(fromPrefs, 'none') as Record<string, string>;
    expect(style['--studio-left']).toBe('280px');
    expect(style['--studio-right']).toBe('360px');
    expect(style['--studio-timeline']).toBe('240px');
  });

  it('colapsa columnas sin desmontar los paneles', () => {
    const style = studioGridStyle(
      { ...layout, leftCollapsed: true, timelineCollapsed: true },
      'none',
    ) as Record<string, string>;
    expect(style['--studio-left']).toBe('0px');
    expect(style['--studio-timeline']).toBe('34px');
    const classes = studioGridClasses(
      { ...layout, leftCollapsed: true, timelineCollapsed: true },
      'none',
    );
    expect(classes).toContain('studio-left-collapsed');
    expect(classes).toContain('studio-timeline-collapsed');
  });

  it('los modos de foco esconden las otras zonas con clases explícitas', () => {
    expect(studioGridClasses(layout, 'viewer')).toContain('studio-focus-viewer');
    expect(studioGridClasses(layout, 'timeline')).toContain('studio-focus-timeline');
    const viewer = studioGridStyle(layout, 'viewer') as Record<string, string>;
    expect(viewer['--studio-timeline']).toBe('0px');
  });
});
