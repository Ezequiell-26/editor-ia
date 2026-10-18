import { useState, type ComponentType } from 'react';
import { AppShell } from './components/AppShell';
import type { ViewId } from './app/navigation';
import { ProjectHome } from './features/projects/ProjectHome';
import { EditorWorkspace } from './features/editor/EditorWorkspace';
import { AssetsPanel } from './features/assets/AssetsPanel';
import { SettingsHome } from './features/settings/SettingsHome';

const VIEWS: Record<ViewId, ComponentType> = {
  projects: ProjectHome,
  editor: EditorWorkspace,
  assets: AssetsPanel,
  settings: SettingsHome,
};

export function App() {
  const [activeId, setActiveId] = useState<ViewId>('projects');
  const ActiveView = VIEWS[activeId];
  return <AppShell activeId={activeId} onSelect={setActiveId} content={<ActiveView />} />;
}
