import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@editor-ia/project-schema";
import App from "../../App";
import type { ProjectHandle, ProjectService } from "../../services/project-service";

const project = createEmptyProject("Demo", "2026-10-18T12:00:00.000Z");
const handle: ProjectHandle = { path: "C:\\work\\demo.editoria.json", project };

function createService(overrides: Partial<ProjectService> = {}): ProjectService {
  return {
    create: vi.fn(async (name: string) => ({ ...handle, project: { ...project, name } })),
    open: vi.fn(async () => handle),
    save: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("ProjectHome project flow", () => {
  it("creates a project and navigates to the editor", async () => {
    const service = createService();
    render(<App projectService={service} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre del proyecto" }), { target: { value: "Tutorial IA" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));
    expect(await screen.findByRole("heading", { name: "Editor de contenido" })).toBeTruthy();
    expect(service.create).toHaveBeenCalledWith("Tutorial IA");
    expect(screen.getByDisplayValue("Tutorial IA")).toBeTruthy();
  });

  it("opens an existing project when the user selects one", async () => {
    const service = createService();
    render(<App projectService={service} />);
    fireEvent.click(screen.getByRole("button", { name: /Abrir existente/i }));
    expect(await screen.findByDisplayValue("Demo")).toBeTruthy();
    expect(service.open).toHaveBeenCalledTimes(1);
  });

  it("keeps unsaved changes visible when saving fails", async () => {
    const service = createService({ save: vi.fn(async () => { throw new Error("Disk full"); }) });
    render(<App projectService={service} />);
    fireEvent.click(screen.getByRole("button", { name: /Abrir existente/i }));
    // Wait for the async navigation to finish; ProjectHome also has a textbox with this label.
    expect(await screen.findByDisplayValue("Demo")).toBeTruthy();
    const nameInput = screen.getByRole("textbox", { name: "Nombre del proyecto" });
    fireEvent.change(nameInput, { target: { value: "Changed title" } });
    expect(screen.getByDisplayValue("Changed title")).toBeTruthy();
    const saveButton = screen.getByRole("button", { name: "Guardar" });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    await waitFor(() => expect(service.save).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Disk full|No se pudo guardar/i);
    expect(screen.getByDisplayValue("Changed title")).toBeTruthy();
    expect(screen.getByText("Cambios sin guardar")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });
});
