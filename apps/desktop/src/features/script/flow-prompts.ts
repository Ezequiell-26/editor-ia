import type { ProjectDocument } from '@editor-ia/project-schema';

/**
 * Image prompts for the Flow Queue extension.
 *
 * The extension imports one prompt per line. Editor IA keeps the scene title as
 * the anchor and uses the visual note first, falling back to the narrated line.
 * The style is user-editable; nothing is sent to a provider from this module.
 */

export const DEFAULT_FLOW_STYLE =
  'Ilustración editorial limpia, personajes simples, fondo plano, sin texto';

export interface FlowPromptOptions {
  readonly style: string;
  readonly includeNarration: boolean;
}

export interface FlowPrompt {
  readonly index: number;
  readonly sceneId: string;
  readonly title: string;
  readonly prompt: string;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function buildFlowPrompts(
  project: ProjectDocument,
  options: FlowPromptOptions,
): FlowPrompt[] {
  const style = normalize(options.style);
  return [...project.scenes]
    .sort((a, b) => a.order - b.order)
    .map((scene, index) => {
      const title = normalize(scene.title);
      const visual = normalize(scene.notes ?? '');
      const narration = normalize(scene.narration.text ?? '');
      const subject = visual || narration || title;
      const segments: string[] = [];
      if (style) segments.push(style);
      segments.push(`${title}. ${subject}`);
      if (options.includeNarration && narration && narration !== subject) {
        segments.push(`Contexto narrado: ${narration}`);
      }
      return {
        index,
        sceneId: scene.id,
        title,
        prompt: normalize(segments.join(' · ')).slice(0, 4_000),
      };
    });
}

export function flowPromptsToText(prompts: readonly FlowPrompt[]): string {
  return prompts.map((prompt) => prompt.prompt).join('\n');
}
