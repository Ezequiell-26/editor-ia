import { useState } from 'react';
import { AppShell } from './components/AppShell';
import type { ViewId } from './app/navigation';
import { ProjectHome } from './features/projects/ProjectHome';
import { EditorWorkspace } from './features/editor/EditorWorkspace';
import { AssetsPanel } from './features/assets/AssetsPanel';
import { SettingsHome } from './features/settings/SettingsHome';
import { createProjectService, type ProjectService } from './services/project-service';

interface AppProps {
  readonly service?: ProjectService;
}

function renderView(activeId: ViewId, service: ProjectService) {
  switch (activeId) {
    case 'projects':
      return <ProjectHome service={service} />;
    case 'editor':
      return <EditorWorkspace />;
    case 'assets':
      return <AssetsPanel />;
    case 'settings':
      return <SettingsHome />;
  }
}

export function App({ service = createProjectService() }: AppProps) {
  const [activeId, setActiveId] = useState<ViewId>('projects');
  return (
    <AppShell
      activeId={activeId}
      onSelect={setActiveId}
      content={renderView(activeId, service)}
    />
  );
}
