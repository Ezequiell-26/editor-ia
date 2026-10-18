import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  ProjectDocumentSchema,
  PROJECT_SCHEMA_VERSION,
} from "./project";

const timestamp = "2026-10-18T12:00:00.000Z";

function validProject() {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "project-test",
    name: "Test edit",
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: { width: 1920, height: 1080, fps: 30, backgroundColor: "#101319" },
    assets: [{ id: "asset-1", kind: "video", uri: "media/clip.mp4" }],
    tracks: [{ id: "track-1", type: "video", name: "Video 1", order: 0 }],
    clips: [{ id: "clip-1", assetId: "asset-1", trackId: "track-1", startFrame: 0, inFrame: 0, durationFrames: 90 }],
    scenes: [{ id: "scene-1", title: "Opening", startFrame: 0, durationFrames: 90, clipIds: ["clip-1"] }],
  };
}

const invalidMutations: Array<[string, (project: Record<string, any>) => void]> = [
  ["unsupported schema version", (p) => { p.schemaVersion = 2; }],
  ["empty project name", (p) => { p.name = "   "; }],
  ["zero width", (p) => { p.settings.width = 0; }],
  ["negative height", (p) => { p.settings.height = -10; }],
  ["invalid frame rate", (p) => { p.settings.fps = 0; }],
  ["negative start frame", (p) => { p.clips[0].startFrame = -1; }],
  ["zero clip duration", (p) => { p.clips[0].durationFrames = 0; }],
  ["credential-like field", (p) => { p.apiKey = "do-not-accept"; }],
];

describe("ProjectDocumentSchema", () => {
  it("accepts a valid versioned editable project", () => {
    const parsed = ProjectDocumentSchema.parse(validProject());
    expect(parsed.settings).toMatchObject({ width: 1920, height: 1080, fps: 30 });
  });

  it("creates an empty project with one editable video track", () => {
    const project = createEmptyProject("Demo project", timestamp);
    expect(project.schemaVersion).toBe(1);
    expect(project.tracks).toHaveLength(1);
    expect(project.assets).toEqual([]);
  });

  it.each(invalidMutations)("rejects %s", (_label, mutate) => {
    const project = structuredClone(validProject()) as Record<string, any>;
    mutate(project);
    expect(ProjectDocumentSchema.safeParse(project).success).toBe(false);
  });

  it("rejects duplicate entity identifiers across entity types", () => {
    const project = validProject();
    project.scenes[0].id = project.clips[0].id;
    expect(ProjectDocumentSchema.safeParse(project).success).toBe(false);
  });

  it("rejects references to unknown assets and tracks", () => {
    const project = validProject();
    project.clips[0].assetId = "missing-asset";
    expect(ProjectDocumentSchema.safeParse(project).success).toBe(false);
  });

  it.each(["../secret.mp4", "/absolute/video.mp4", "C:\\private\\video.mp4", "media/../../secret.mp4"])(
    "rejects asset path escaping project root: %s",
    (uri) => {
      const project = validProject();
      project.assets[0].uri = uri;
      expect(ProjectDocumentSchema.safeParse(project).success).toBe(false);
    },
  );
});
