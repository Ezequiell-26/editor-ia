/**
 * Planificador capítulo→escena para producción larga.
 *
 * Convierte un guion de texto (encabezados Markdown o “Capítulo N”) en escenas
 * con narración, reparte los clips existentes y no toca el proyecto: el tool
 * `chapter_plan` aplica el resultado en una sola mutación.
 */
import type { Scene } from '@editor-ia/project-schema';

export interface PlannedChapterScene {
  readonly chapter: string;
  readonly title: string;
  readonly narration: string;
  readonly notes: string;
  readonly intent: Scene['intent'];
  readonly clipId: string;
}

interface ChapterBlock {
  title: string;
  paragraphs: string[];
}

const HEADING = /^(?:#{1,6}\s+(.+)|cap[ií]tulo\s+\d+\s*[:.\-–]?\s*(.*))$/i;

function isHeading(line: string): { title: string } | null {
  const match = HEADING.exec(line.trim());
  if (!match) return null;
  const title = (match[1] ?? match[2] ?? '').trim();
  return { title: title || 'Capítulo' };
}

function wordsOf(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sentencesOf(paragraph: string): string[] {
  // Conserva el signo de cierre y las comillas que lo acompañan.
  return (
    paragraph.match(/[^.!?…]+[.!?…]+["'»”’)]*\s*|.+$/g)?.map((item) => item.trim()).filter(Boolean) ??
    []
  );
}

function sliceWords(text: string, maxWords: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.length > 0 ? [words.join(' ')] : [];
  const parts: string[] = [];
  for (let index = 0; index < words.length; index += maxWords) {
    parts.push(words.slice(index, index + maxWords).join(' '));
  }
  return parts;
}

function sceneTitle(narration: string): string {
  const first = narration.split(/(?<=[.!?…])\s+/)[0]?.trim() || narration.trim();
  if (first.length <= 70) return first;
  return `${first.slice(0, 69).trimEnd()}…`;
}

function chaptersOf(text: string): ChapterBlock[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const chapters: ChapterBlock[] = [];
  let current: ChapterBlock = { title: 'Capítulo 1', paragraphs: [] };
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim());
    const headingIndex = lines.findIndex((line) => isHeading(line) !== null);
    if (headingIndex >= 0) {
      const heading = isHeading(lines[headingIndex]!)!;
      if (current.paragraphs.length === 0 && chapters.length === 0) {
        current.title = heading.title;
      } else {
        chapters.push(current);
        current = { title: heading.title, paragraphs: [] };
      }
      const rest = lines
        .filter((_line, index) => index !== headingIndex)
        .join(' ')
        .trim();
      if (rest) current.paragraphs.push(rest);
      continue;
    }
    current.paragraphs.push(block.replace(/\s*\n\s*/g, ' ').trim());
  }
  if (current.paragraphs.some((paragraph) => paragraph.length > 0)) {
    chapters.push(current);
  }
  return chapters.filter((chapter) => chapter.paragraphs.length > 0);
}

export function planChapterScenes(
  text: string,
  clipIds: readonly string[],
  maxWords = 60,
): PlannedChapterScene[] {
  const clips = clipIds.filter((id) => id.trim().length > 0);
  if (clips.length === 0) return [];
  const budget = Math.min(160, Math.max(20, Math.round(maxWords)));
  const chapters = chaptersOf(text);
  const plan: PlannedChapterScene[] = [];
  for (const chapter of chapters) {
    const pieces: string[] = [];
    let current: string[] = [];
    let currentWords = 0;
    const flush = () => {
      if (current.length > 0) {
        pieces.push(current.join(' ').trim());
        current = [];
        currentWords = 0;
      }
    };
    for (const paragraph of chapter.paragraphs) {
      for (const sentence of sentencesOf(paragraph)) {
        const sentenceWords = wordsOf(sentence);
        if (sentenceWords > budget) {
          flush();
          pieces.push(...sliceWords(sentence, budget));
          continue;
        }
        if (currentWords + sentenceWords > budget) flush();
        current.push(sentence);
        currentWords += sentenceWords;
      }
    }
    flush();
    for (const narration of pieces) {
      plan.push({
        chapter: chapter.title,
        title: sceneTitle(narration),
        narration,
        notes: `Capítulo: ${chapter.title}`,
        intent: 'explainer',
        clipId: clips[plan.length % clips.length]!,
      });
    }
  }
  if (plan.length === 0) return [];
  return plan.map((scene, index) => ({
    ...scene,
    intent:
      plan.length === 1
        ? 'hook'
        : index === 0
          ? 'hook'
          : index === plan.length - 1
            ? 'outro'
            : 'explainer',
  }));
}
