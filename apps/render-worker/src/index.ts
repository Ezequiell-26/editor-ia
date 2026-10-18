import { spawnSync } from "node:child_process";
import { getRendererCapabilities, type RendererName } from "./capabilities";
import { createRenderResult, validateRenderRequest } from "./protocol";

function resolveExecutable(name: RendererName): string | null {
  // Executable names are an internal allowlist, never values supplied by the model or request.
  const command = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(command, [name], { encoding: "utf8", windowsHide: true, timeout: 3000 });
  if (result.status !== 0 || result.error) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

async function main() {
  if (process.argv.includes("--capabilities")) {
    process.stdout.write(JSON.stringify(getRendererCapabilities(resolveExecutable), null, 2) + "\n");
    return;
  }

  let raw = "";
  for await (const chunk of process.stdin) raw += chunk.toString();
  try {
    const request = validateRenderRequest(JSON.parse(raw));
    // Real renderer adapters are delivered in the next vertical slice. Never fake an MP4.
    process.stdout.write(JSON.stringify(createRenderResult(request.requestId, "unsupported", {
      errorCode: "renderer-not-implemented",
      message: `The ${request.engine} renderer is not implemented in this foundation build.`,
    })) + "\n");
    process.exitCode = 3;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid render request";
    process.stderr.write(message + "\n");
    process.exitCode = 2;
  }
}

void main();
