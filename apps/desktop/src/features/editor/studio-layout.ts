import type { CSSProperties } from 'react';
import {
  EDITOR_PREFERENCE_BOUNDS,
  type EditorPreferences,
} from '../../state/editor-preferences';

export type StudioFocus = 'none' | 'viewer' | 'timeline';

export interface StudioLayout {
  readonly leftWidth: number;
  readonly rightWidth: number;
  readonly timelineHeight: number;
  readonly leftCollapsed: boolean;
  readonly rightCollapsed: boolean;
  readonly timelineCollapsed: boolean;
}

export function studioLayoutFromPreferences(preferences: EditorPreferences): StudioLayout {
  return {
    leftWidth: preferences.studioLeftWidth,
    rightWidth: preferences.studioRightWidth,
    timelineHeight: preferences.studioTimelineHeight,
    leftCollapsed: preferences.studioLeftCollapsed,
    rightCollapsed: preferences.studioRightCollapsed,
    timelineCollapsed: preferences.studioTimelineCollapsed,
  };
}

export function clampStudioWidth(kind: 'left' | 'right' | 'timeline', value: number): number {
  const bounds =
    kind === 'left'
      ? EDITOR_PREFERENCE_BOUNDS.studioLeftWidth
      : kind === 'right'
        ? EDITOR_PREFERENCE_BOUNDS.studioRightWidth
        : EDITOR_PREFERENCE_BOUNDS.studioTimelineHeight;
  if (!Number.isFinite(value)) return bounds.min;
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, value)));
}

/**
 * Variables CSS que gobiernan el grid del Studio. El ancho de una columna
 * colapsada es 0 para que el visor ocupe el espacio, pero el panel sigue
 * montado para no perder su estado ni su scroll.
 */
export function studioGridStyle(layout: StudioLayout, focus: StudioFocus): CSSProperties {
  const left = layout.leftWidth;
  const right = layout.rightWidth;
  const timeline = layout.timelineHeight;
  if (focus === 'viewer') {
    return {
      '--studio-left': '0px',
      '--studio-right': '0px',
      '--studio-timeline': '0px',
    } as CSSProperties;
  }
  if (focus === 'timeline') {
    return {
      '--studio-left': '0px',
      '--studio-right': '0px',
      '--studio-timeline': 'minmax(240px, 1fr)',
    } as CSSProperties;
  }
  return {
    '--studio-left': layout.leftCollapsed ? '0px' : `${left}px`,
    '--studio-right': layout.rightCollapsed ? '0px' : `${right}px`,
    '--studio-timeline': layout.timelineCollapsed ? '34px' : `${timeline}px`,
  } as CSSProperties;
}

export function studioGridClasses(
  layout: StudioLayout,
  focus: StudioFocus,
  drawers: { readonly left: boolean; readonly right: boolean } = { left: false, right: false },
): string {
  return [
    'editor-grid',
    'studio-grid',
    layout.leftCollapsed ? 'studio-left-collapsed' : '',
    layout.rightCollapsed ? 'studio-right-collapsed' : '',
    layout.timelineCollapsed ? 'studio-timeline-collapsed' : '',
    focus === 'viewer' ? 'studio-focus-viewer' : '',
    focus === 'timeline' ? 'studio-focus-timeline' : '',
    drawers.left ? 'studio-drawer-left-open' : '',
    drawers.right ? 'studio-drawer-right-open' : '',
  ]
    .filter(Boolean)
    .join(' ');
}
