import { invoke, isTauri } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { ProjectDocument } from "@editor-ia/project-schema";

export type ProjectHandle = { path: string; project: ProjectDocument };

export interface ProjectService {
  create(name: string): Promise<ProjectHandle | null>;
  open(): Promise<ProjectHandle | null>;
  save(path: string, project: ProjectDocument): Promise<void>;
}

function requireNativeRuntime(): void {
  if (!isTauri()) {
    throw new Error("La gestión de proyectos requiere abrir Editor IA como aplicación de escritorio.");
  }
}

function safeFileStem(name: string): string {
  const stem = name.normalize("NFKC").split("").map((character) =>
    '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32 ? "-" : character
  ).join("").replace(/[. ]+$/g, "").trim();
  return stem.slice(0, 120) || "Nuevo proyecto";
}

export const nativeProjectService: ProjectService = {
  async create(name) {
    requireNativeRuntime();
    const path = await saveDialog({
      title: "Crear proyecto de Editor IA",
      defaultPath: `${safeFileStem(name)}.editoria.json`,
      filters: [{ name: "Proyecto Editor IA", extensions: ["editoria.json"] }],
    });
    if (!path) return null;
    const project = await invoke<ProjectDocument>("create_project", { path, name });
    return { path, project };
  },

  async open() {
    requireNativeRuntime();
    const selected = await openDialog({
      title: "Abrir proyecto de Editor IA",
      multiple: false,
      directory: false,
      filters: [{ name: "Proyecto Editor IA", extensions: ["editoria.json"] }],
    });
    if (typeof selected !== "string") return null;
    const project = await invoke<ProjectDocument>("open_project", { path: selected });
    return { path: selected, project };
  },

  async save(path, project) {
    requireNativeRuntime();
    await invoke<void>("save_project", { path, project });
  },
};
