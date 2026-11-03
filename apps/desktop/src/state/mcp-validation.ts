import { MCP_TOOL_BY_NAME } from './mcp-catalog';

type JsonSchema = Record<string, unknown>;
type Arguments = Record<string, unknown>;

function isRecord(value: unknown): value is Arguments {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function matchesType(type: unknown, value: unknown): boolean {
  const allowed = Array.isArray(type) ? type : [type];
  return allowed.some((candidate) => {
    switch (candidate) {
      case 'object':
        return isRecord(value);
      case 'array':
        return Array.isArray(value);
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && Number.isFinite(value);
      case 'integer':
        return typeof value === 'number' && Number.isSafeInteger(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'null':
        return value === null;
      default:
        return true;
    }
  });
}

function validateValue(schema: JsonSchema, value: unknown, path: string): void {
  if (schema.type !== undefined && !matchesType(schema.type, value)) {
    const expected = Array.isArray(schema.type) ? schema.type.join(' | ') : String(schema.type);
    throw new Error(`parámetro inválido «${path}»: se esperaba ${expected}`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    throw new Error(`parámetro inválido «${path}»: valor fuera de las opciones permitidas`);
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      throw new Error(`parámetro inválido «${path}»: texto demasiado corto`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      throw new Error(`parámetro inválido «${path}»: texto demasiado largo`);
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      throw new Error(`parámetro inválido «${path}»: formato no válido`);
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      throw new Error(`parámetro inválido «${path}»: mínimo ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      throw new Error(`parámetro inválido «${path}»: máximo ${schema.maximum}`);
    }
    if (typeof schema.multipleOf === 'number' && value % schema.multipleOf !== 0) {
      throw new Error(`parámetro inválido «${path}»: debe ser múltiplo de ${schema.multipleOf}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      throw new Error(`parámetro inválido «${path}»: faltan elementos`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      throw new Error(`parámetro inválido «${path}»: demasiados elementos`);
    }
    if (schema.uniqueItems === true) {
      const serialized = value.map((item) => JSON.stringify(item));
      if (new Set(serialized).size !== serialized.length) {
        throw new Error(`parámetro inválido «${path}»: no se permiten elementos duplicados`);
      }
    }
    if (isRecord(schema.items)) {
      value.forEach((item, index) => validateValue(schema.items as JsonSchema, item, `${path}[${index}]`));
    }
  }

  if (isRecord(value)) {
    if (typeof schema.minProperties === 'number' && Object.keys(value).length < schema.minProperties) {
      throw new Error(`parámetro inválido «${path}»: se necesita al menos ${schema.minProperties} campo(s)`);
    }
    if (typeof schema.maxProperties === 'number' && Object.keys(value).length > schema.maxProperties) {
      throw new Error(`parámetro inválido «${path}»: demasiados campos`);
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : [];

    for (const key of required) {
      if (!(key in value) || value[key] === undefined) {
        throw new Error(`falta el parámetro obligatorio «${path}.${key}»`);
      }
    }

    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key];
      if (childSchema === undefined) {
        if (schema.additionalProperties === false) {
          throw new Error(`parámetro desconocido «${path}.${key}»`);
        }
        if (isRecord(schema.additionalProperties)) {
          validateValue(schema.additionalProperties, child, `${path}.${key}`);
        }
        continue;
      }
      if (isRecord(childSchema)) validateValue(childSchema, child, `${path}.${key}`);
    }
  }
}

function validateToolSemantics(toolName: string, args: Arguments): void {
  const start = (args.startSeconds ?? args.startFrame) as number | undefined;
  const end = (args.endSeconds ?? args.endFrame) as number | undefined;

  if (
    (toolName === 'export_lossless' || toolName === 'caption_update') &&
    start !== undefined &&
    end !== undefined &&
    end <= start
  ) {
    throw new Error('el final del rango debe ser posterior al inicio');
  }

  if (toolName === 'marker_add' && typeof args.endFrame === 'number' && args.endFrame <= (args.frame as number)) {
    throw new Error('endFrame debe ser posterior al frame del marcador');
  }

  if (toolName === 'write_chapters' && Array.isArray(args.chapters)) {
    let previousEnd = -1;
    for (const [index, chapter] of args.chapters.entries()) {
      if (!isRecord(chapter)) continue;
      const chapterStart = chapter.startSeconds as number;
      const chapterEnd = chapter.endSeconds as number;
      if (chapterEnd <= chapterStart) {
        throw new Error(`capítulo ${index + 1}: endSeconds debe ser posterior a startSeconds`);
      }
      if (chapterStart < previousEnd) {
        throw new Error(`capítulo ${index + 1}: los capítulos no pueden solaparse ni estar desordenados`);
      }
      previousEnd = chapterEnd;
    }
  }
}

/**
 * Valida argumentos contra el mismo JSON Schema que publica tools/list,
 * además de las relaciones entre campos que JSON Schema no puede expresar
 * con facilidad. Todo se comprueba antes de ejecutar efectos laterales.
 */
export function validateMcpToolArguments(toolName: string, rawArgs: unknown): Arguments {
  const definition = MCP_TOOL_BY_NAME.get(toolName);
  if (!definition) throw new Error(`herramienta desconocida: ${toolName}`);

  const value = rawArgs === undefined || rawArgs === null ? {} : rawArgs;
  if (!isRecord(value)) throw new Error('los argumentos MCP deben ser un objeto JSON');

  validateValue(definition.inputSchema, value, 'arguments');
  validateToolSemantics(toolName, value);
  return value;
}
