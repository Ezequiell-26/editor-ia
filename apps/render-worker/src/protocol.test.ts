import path from "node:path";
import { describe, expect, it } from "vitest";
import { getRendererCapabilities } from "./capabilities";
import { createRenderResult, RENDER_PROTOCOL_VERSION, validateRenderRequest } from "./protocol";

function validRequest() {
  return {
    requestId: "render-test-1",
    protocolVersion: RENDER_PROTOCOL_VERSION,
    projectPath: path.win32.resolve("C:\\work\\demo.editoria.json"),
    outputPath: path.win32.resolve("C:\\work\\renders\\demo.mp4"),
    engine: "ffmpeg",
    profile: { id: "youtube-1080p", width: 1920, height: 1080, fps: 30, format: "mp4" },
  };
}

describe("render worker protocol", () => {
  it("accepts a well-formed versioned render request", () => {
    expect(validateRenderRequest(validRequest()).requestId).toBe("render-test-1");
  });

  it("rejects an unsupported protocol version", () => {
    expect(() => validateRenderRequest({ ...validRequest(), protocolVersion: 999 })).toThrow();
  });

  it("rejects relative paths, path collisions and an unexpected profile", () => {
    expect(() => validateRenderRequest({ ...validRequest(), outputPath: "output.mp4" })).toThrow();
    const request = validRequest();
    request.outputPath = request.projectPath;
    expect(() => validateRenderRequest(request)).toThrow(/must not overwrite/i);
    expect(() => validateRenderRequest({ ...validRequest(), profile: { id: "fast", width: 1920, height: 1080, fps: 30, format: "mp4" } })).toThrow();
  });

  it("reports renderer availability through the injected resolver", () => {
    const capabilities = getRendererCapabilities((name) => name === "ffmpeg" ? "C:\\tools\\ffmpeg.exe" : null);
    expect(capabilities.renderers.ffmpeg.available).toBe(true);
    expect(capabilities.renderers.remotion.available).toBe(false);
    expect(capabilities.supportedProfiles).toContain("shorts-1080p");
  });

  it("never allows completed status without a verified output file", () => {
    expect(() => createRenderResult("render-1", "completed")).toThrow(/verified output/i);
    expect(() => createRenderResult("render-1", "completed", { outputPath: "C:\\renders\\video.mp4", outputVerified: false })).toThrow();
    expect(createRenderResult("render-1", "failed", { errorCode: "renderer-unavailable" }).outputPath).toBeUndefined();
  });
});
