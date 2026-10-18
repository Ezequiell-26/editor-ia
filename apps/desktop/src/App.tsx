import { useState } from "react";
import { AppShell } from "./components/AppShell";
import { ProjectHome } from "./features/projects/ProjectHome";
import { EditorWorkspace } from "./features/editor/EditorWorkspace";
import { AssetsPanel } from "./features/assets/AssetsPanel";
import { SettingsHome } from "./features/settings/SettingsHome";
import type { PageKey } from "./app/navigation";
import { nativeProjectService, type ProjectHandle, type ProjectService } from "./services/project-service";
import type { ProjectDocument } from "@editor-ia/project-schema";

export default function App({ projectService = nativeProjectService }: { projectService?: ProjectService } = {}) {
  const [page, setPage] = useState<PageKey>("projects");
  const [activeProject, setActiveProject] = useState<ProjectHandle | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function runProjectAction(action: () => Promise<ProjectHandle | null>) {
    setBusy(true);
    setMessage("");
    try {
      const result = await action();
      if (result) {
        setActiveProject(result);
        setPage("editor");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo completar la operación del proyecto.");
    } finally {
      setBusy(false);
    }
  }

  async function saveActiveProject(project: ProjectDocument) {
    if (!activeProject) throw new Error("No hay un proyecto guardado para actualizar.");
    setMessage("");
    await projectService.save(activeProject.path, project);
    setActiveProject({ path: activeProject.path, project });
  }

  return (
    <AppShell activePage={page} onNavigate={setPage}>
      {page === "projects" && (
        <ProjectHome
          onOpenEditor={() => setPage("editor")}
          onCreateProject={(name) => runProjectAction(() => projectService.create(name))}
          onOpenProject={() => runProjectAction(() => projectService.open())}
          projectName={activeProject?.project.name}
          busy={busy}
          error={message}
        />
      )}
      {page === "editor" && (
        <EditorWorkspace
          project={activeProject?.project ?? null}
          onSave={activeProject ? saveActiveProject : undefined}
          saveError={message}
        />
      )}
      {page === "assets" && <AssetsPanel />}
      {page === "settings" && <SettingsHome />}
    </AppShell>
  );
}
