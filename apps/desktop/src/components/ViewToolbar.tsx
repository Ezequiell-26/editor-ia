import type { ReactNode } from 'react';

/**
 * Slim top bar for a tool view. The rail already names the view, so this keeps
 * only the actions, filters and live state that are useful while working.
 */
export function ViewToolbar({
  label,
  children,
  actions,
}: {
  readonly label: string;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="view-toolbar" role="group" aria-label={label}>
      <span className="view-toolbar-label">{label}</span>
      <div className="view-toolbar-main">{children}</div>
      {actions ? <div className="view-toolbar-actions">{actions}</div> : null}
    </div>
  );
}
