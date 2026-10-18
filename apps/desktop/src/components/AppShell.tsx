import { Sidebar } from './Sidebar';
import { NAV_VIEWS, type ViewId } from '../app/navigation';
import type { ReactNode } from 'react';

interface AppShellProps {
  readonly activeId: ViewId;
  readonly onSelect: (id: ViewId) => void;
  readonly content: ReactNode;
}

export function AppShell({ activeId, onSelect, content }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <h1 className="brand">Editor IA</h1>
        <p className="brand-note">v0.0.0 · fundación — edición y render no disponibles</p>
      </header>
      <div className="app-body">
        <Sidebar views={NAV_VIEWS} activeId={activeId} onSelect={onSelect} />
        <main className="content">{content}</main>
      </div>
    </div>
  );
}
