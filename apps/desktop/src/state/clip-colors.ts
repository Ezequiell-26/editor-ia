import type { ClipColorTag } from '@editor-ia/project-schema';

export const CLIP_COLORS: readonly {
  readonly id: ClipColorTag;
  readonly label: string;
  readonly hex: string;
}[] = [
  { id: 'rose', label: 'Rojo', hex: '#c26b78' },
  { id: 'orange', label: 'Naranja', hex: '#b8814e' },
  { id: 'amber', label: 'Ámbar', hex: '#b09a4a' },
  { id: 'green', label: 'Verde', hex: '#6f9b6a' },
  { id: 'teal', label: 'Turquesa', hex: '#4f9188' },
  { id: 'blue', label: 'Azul', hex: '#5f83b3' },
  { id: 'violet', label: 'Violeta', hex: '#8a76b5' },
  { id: 'slate', label: 'Gris', hex: '#7b8494' },
];

export function clipColorHex(tag: ClipColorTag | undefined): string | undefined {
  return tag ? CLIP_COLORS.find((item) => item.id === tag)?.hex : undefined;
}

export function clipMatchesColorFilter(
  tag: ClipColorTag | undefined,
  filter: ClipColorTag | 'all',
): boolean {
  return filter === 'all' || tag === filter;
}
