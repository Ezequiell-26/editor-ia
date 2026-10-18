export type RendererName = "ffmpeg" | "remotion";
export type RendererCapability = { available: boolean; executablePath?: string };
export type RendererCapabilities = {
  protocolVersion: number;
  renderers: Record<RendererName, RendererCapability>;
  supportedProfiles: string[];
};

const names: readonly RendererName[] = ["ffmpeg", "remotion"];

export function getRendererCapabilities(
  resolveExecutable: (name: RendererName) => string | null,
): RendererCapabilities {
  const renderers = Object.fromEntries(names.map((name) => {
    const executablePath = resolveExecutable(name);
    return [name, executablePath ? { available: true, executablePath } : { available: false }];
  })) as Record<RendererName, RendererCapability>;

  return {
    protocolVersion: 1,
    renderers,
    supportedProfiles: ["youtube-1080p", "shorts-1080p", "custom"],
  };
}
