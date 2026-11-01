import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_TOOLS,
  assistantToolPayload,
  estimateSchemaTokens,
  selectToolIntents,
  selectToolsForMessage,
} from './assistant-tools';

function namesFor(text: string): string[] {
  return selectToolsForMessage(text).map((tool) => tool.name);
}

function payloadBytes(tools: ReturnType<typeof selectToolsForMessage>): number {
  return JSON.stringify(assistantToolPayload(tools)).length;
}

describe('router de herramientas por intención', () => {
  it('para una búsqueda de archivos manda solo el grupo de archivos', () => {
    const names = namesFor('Buscá videos en Descargas');
    expect(names).toContain('media_find');
    expect(names).toContain('files_roots');
    expect(names).toContain('project_inspect');
    expect(names).not.toContain('render_queue_control');
    expect(names.length).toBeLessThanOrEqual(14);
  });

  it('para exportar manda las herramientas de render', () => {
    const names = namesFor('Exportá el video');
    expect(names).toContain('export_open');
    expect(names).toContain('render_start');
    expect(names).not.toContain('three_add');
  });

  it('para cortar un clip manda edición', () => {
    const names = namesFor('Cortá el clip 2 a 4 segundos');
    expect(names).toContain('clip_edit');
    expect(names).toContain('clip_split');
    expect(names).not.toContain('render_queue_add');
  });

  it('arma el video desde carpeta con la herramienta correcta', () => {
    const names = namesFor('Armá el video con las imágenes y la voz de la carpeta D:/x');
    expect(names).toContain('auto_video_from_folder');
    expect(names).toContain('media_find');
  });

  it('para una frase general manda un set mínimo en vez del catálogo', () => {
    const names = namesFor('Hola, ¿cómo estás?');
    expect(names).toContain('project_inspect');
    expect(names).toContain('files_roots');
    expect(names.length).toBeLessThanOrEqual(9);
    expect(names).not.toContain('render_queue_control');
  });

  it('detecta varias intenciones en la misma frase', () => {
    const intents = selectToolIntents('Cortá el clip y bajá el volumen');
    expect(intents).toContain('edit');
    expect(intents).toContain('audio');
  });

  it('ahorra al menos el 60 % del esquema frente al catálogo completo', () => {
    const full = estimateSchemaTokens(ASSISTANT_TOOLS);
    const files = estimateSchemaTokens(selectToolsForMessage('Buscá videos en Descargas'));
    const general = estimateSchemaTokens(selectToolsForMessage('Hola'));
    expect(files).toBeLessThan(full * 0.4);
    expect(general).toBeLessThan(full * 0.4);
    expect(payloadBytes(selectToolsForMessage('Hola'))).toBeLessThan(payloadBytes(ASSISTANT_TOOLS));
  });

  it('sin argumentos sigue publicando el catálogo completo', () => {
    expect(assistantToolPayload()).toHaveLength(ASSISTANT_TOOLS.length);
  });
});
