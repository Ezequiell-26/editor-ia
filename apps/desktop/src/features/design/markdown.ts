/**
 * Parser mínimo para las guías DESIGN.md y las reglas de craft. No busca ser
 * un motor Markdown completo: reconoce lo que usan esos documentos (títulos,
 * párrafos, listas, citas, tablas y bloques de código) y devuelve bloques
 * seguros para renderizar con React, sin HTML crudo.
 */
export type MarkdownBlock =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3 | 4; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: 'quote'; readonly text: string }
  | { readonly kind: 'code'; readonly language: string; readonly text: string }
  | { readonly kind: 'table'; readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: 'rule' };

export function plainInline(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/(^|[\s(])\*([^*]+)\*/g, '$1$2')
    .replace(/(^|[\s(])_([^_]+)_/g, '$1$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, '$1')
    .trim();
}

function cells(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => plainInline(cell));
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(line) && line.includes('-');
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^\s*```([\w-]*)\s*$/.exec(line);
    if (fence) {
      const language = fence[1] ?? '';
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push({ kind: 'code', language, text: body.join('\n') });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const depth = heading[1]?.length ?? 1;
      const level = (depth <= 1 ? 1 : depth === 2 ? 2 : depth === 3 ? 3 : 4) as 1 | 2 | 3 | 4;
      blocks.push({ kind: 'heading', level, text: plainInline(heading[2] ?? '') });
      index += 1;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s*_-]*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
        body.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ kind: 'quote', text: plainInline(body.join(' ')) });
      continue;
    }

    if (line.includes('|') && isTableDivider(lines[index + 1] ?? '')) {
      const headers = cells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim()) {
        rows.push(cells(lines[index] ?? ''));
        index += 1;
      }
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }

    const listItem = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (listItem) {
      const ordered = Boolean(listItem[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(current);
        if (item) {
          items.push(plainInline(item[3] ?? ''));
          index += 1;
          continue;
        }
        if (current.trim() && /^\s{2,}\S/.test(current) && items.length > 0) {
          items[items.length - 1] = `${items[items.length - 1]} ${plainInline(current)}`.trim();
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (
        !current.trim() ||
        /^#{1,6}\s/.test(current) ||
        /^\s*```/.test(current) ||
        /^\s*>\s?/.test(current) ||
        /^\s*(?:[-*+]|\d+[.)])\s+/.test(current) ||
        (current.includes('|') && isTableDivider(lines[index + 1] ?? ''))
      ) {
        break;
      }
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: plainInline(paragraph.join(' ')) });
  }

  return blocks;
}
