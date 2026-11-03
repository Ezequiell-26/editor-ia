import type { ViewId } from '../../app/navigation';

export type OperatorAction =
  | { readonly kind: 'navigate'; readonly view: ViewId; readonly label: string }
  | { readonly kind: 'play' }
  | { readonly kind: 'pause' }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | { readonly kind: 'save' }
  | { readonly kind: 'export' }
  | { readonly kind: 'create'; readonly topic: string }
  | { readonly kind: 'new_project'; readonly name: string }
  | { readonly kind: 'import_file'; readonly path: string }
  | { readonly kind: 'download_url'; readonly url: string }
  | { readonly kind: 'add_clip'; readonly asset: string; readonly atPlayhead: boolean }
  | { readonly kind: 'delete_selected' }
  | { readonly kind: 'split_at_playhead' }
  | { readonly kind: 'goto'; readonly seconds: number }
  | { readonly kind: 'add_caption'; readonly text: string; readonly seconds: number }
  | { readonly kind: 'set_speed'; readonly speed: number }
  | { readonly kind: 'set_gain'; readonly db: number }
  | { readonly kind: 'mute_clip'; readonly muted: boolean }
  | {
      readonly kind: 'cut_silences';
      readonly thresholdDb: number;
      readonly minSilenceSeconds: number;
      readonly paddingSeconds: number;
      readonly scope: 'selection' | 'project';
    }
  | { readonly kind: 'auto_subtitles'; readonly scope: 'selection' | 'project' }
  | {
      readonly kind: 'cut_voice_pauses';
      readonly minPauseSeconds: number;
      readonly paddingSeconds: number;
      readonly scope: 'selection' | 'project';
    }
  | {
      readonly kind: 'auto_cleanup';
      readonly denoise: 'off' | 'light' | 'medium' | 'strong';
      readonly levelAudio: boolean;
      readonly zoomCuts: boolean;
      readonly cutSilences: boolean;
      readonly cutPauses: boolean;
      readonly targetLufs: number;
    }
  | { readonly kind: 'auto_pilot' }
  | { readonly kind: 'mcp_server' }
  | {
      readonly kind: 'motion';
      readonly templateId: 'title-card' | 'lower-third' | 'end-card' | 'stat-callout';
      readonly text: string;
      readonly secondary?: string;
    }
  | { readonly kind: 'status' }
  | { readonly kind: 'media_folder'; readonly folder: string }
  | { readonly kind: 'brain'; readonly mode: 'safe' | 'all' | 'report' }
  | { readonly kind: 'help' }
  | { readonly kind: 'unknown'; readonly message: string };

export interface OperatorView {
  readonly id: ViewId;
  readonly label: string;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** `1:30`, `90 s`, `1m 30s`, `2 min` → segundos. `null` si no se entiende. */
export function parseTimeToSeconds(raw: string): number | null {
  const text = normalize(raw)
    .replace(/\b(segundos?|segs?)\b/g, 's')
    .trim();
  const clock = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(text);
  if (clock) {
    // Los grupos que no están vienen como `undefined`: no son cero.
    const first = Number(clock[1]);
    const second = Number(clock[2]);
    if (Number.isNaN(first) || Number.isNaN(second)) return null;
    const third = clock[3] === undefined ? null : Number(clock[3]);
    if (third !== null && Number.isNaN(third)) return null;
    const total =
      third === null ? first * 60 + second : first * 3600 + second * 60 + third;
    return total >= 0 ? total : null;
  }
  const compact = /^(?:(\d+)\s*(?:m|min|minutos?)\s*)?(?:(\d+)\s*s?)?$/.exec(text);
  if (compact && (compact[1] || compact[2])) {
    const minutes = Number(compact[1] ?? 0);
    const seconds = Number(compact[2] ?? 0);
    const total = minutes * 60 + seconds;
    return total >= 0 ? total : null;
  }
  const plain = Number(text);
  return Number.isFinite(plain) && plain >= 0 ? plain : null;
}

/** `2x`, `2`, `50 %`, `0,5` → factor de velocidad. `null` si no se entiende. */
export function parseSpeed(raw: string): number | null {
  const text = normalize(raw).replace(/velocidad|x\b/g, '').trim();
  const percent = /^(\d{1,3})\s*%$/.exec(text);
  if (percent) {
    const value = Number(percent[1]) / 100;
    return value >= 0.1 && value <= 10 ? value : null;
  }
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) && value >= 0.1 && value <= 10 ? value : null;
}

/** `+3`, `-5`, `3 db`, `sube 2` → decibeles. `null` si no se entiende. */
export function parseDecibels(raw: string): number | null {
  const text = normalize(raw).replace(/db\b|decibeles?/g, '').trim();
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) && value >= -24 && value <= 24 ? value : null;
}

/**
 * Subtítulos automáticos desde la voz.
 *
 * «subtitulá el clip», «generá subtítulos automáticos», «transcribí y subtitulá
 * todo el proyecto». No es el subtítulo manual (`add_caption`), que lleva el
 * texto en el comando: acá el texto sale de transcribir el audio.
 */
export function parseAutoSubtitlesCommand(
  raw: string,
): Extract<OperatorAction, { kind: 'auto_subtitles' }> | null {
  const text = normalize(raw);
  if (!/\bsubtitul\w*\b/.test(text)) return null;
  // «subtitulá …» ya es el verbo; si no, hace falta una señal de automático.
  // Ojo: «subtítulo <texto>» es el comando manual y no debe caer acá.
  const startsWithVerb = /^subtitul(?:a|ar|ame)\b/.test(text);
  const plural = /\bsubtitulos\b/.test(text);
  const automatic =
    /\b(auto\w*|transcrib\w*|genera\w*|crea\w*|hace\w*|pon\w*|agrega\w*|suma\w*)\b/.test(text);
  if (!startsWithVerb && !(plural && automatic)) return null;
  const scope = /\b(todo el proyecto|proyecto completo|todos los clips|todas las pistas|todo)\b/.test(
    text,
  )
    ? 'project'
    : 'selection';
  return { kind: 'auto_subtitles', scope };
}

/**
 * Corte por pausas de voz.
 *
 * «cortá las pausas», «quitá el aire entre frases», «cortá por voz». Se
 * distingue del corte de silencios (amplitud) por la palabra: si el pedido
 * habla de silencio y no de pausa, manda el otro comando.
 */
export function parseVoicePauseCutCommand(
  raw: string,
): Extract<OperatorAction, { kind: 'cut_voice_pauses' }> | null {
  const text = normalize(raw);
  const mentionsPause =
    /\b(pausas?|aire)\b/.test(text) || /\bpor voz\b/.test(text) || /\bentre frases\b/.test(text);
  if (!mentionsPause) return null;
  const verb = /\b(cort\w*|quit\w*|elimin\w*|sac\w*|limpi\w*|ajust\w*|reduc\w*)\b/.test(text);
  if (!verb) return null;
  if (/\bsilencios?\b/.test(text) && !/\b(pausas?|aire|frases)\b/.test(text)) return null;

  const minimum = firstNumber(text, [
    /(?:pausa minima|minimo|min)\s*(?:de\s*)?(\d{1,3}(?:[.,]\d+)?)\s*s/,
  ]);
  const padding = firstNumber(text, [
    /(?:aire|margen|colchon|padding)\s*(?:conservado\s*)?(?:de\s*)?(\d{1,3}(?:[.,]\d+)?)\s*s/,
  ]);
  const scope = /\b(todo el proyecto|proyecto completo|todos los clips|todas las pistas|todo)\b/.test(
    text,
  )
    ? 'project'
    : 'selection';

  return {
    kind: 'cut_voice_pauses',
    minPauseSeconds: clampNumber(minimum ?? 0.35, 0.1, 3),
    paddingSeconds: clampNumber(padding ?? 0.08, 0, 0.5),
    scope,
  };
}

/**
 * Limpieza automática del proyecto.
 *
 * «limpiá el video», «dejalo listo para publicar», «limpieza automática».
 * Encadena silencios, pausas, denoise, nivelado y zoom. Las palabras «sin
 * zoom», «sin pausas», «sin nivelar» o «denoise fuerte/suave» ajustan el plan.
 */
export function parseAutoCleanupCommand(
  raw: string,
): Extract<OperatorAction, { kind: 'auto_cleanup' }> | null {
  const text = normalize(raw);
  const trigger =
    /\b(limpieza automatica|autolimpieza|limpi(a|ar) el video|limpi(a|ar) el proyecto|dejalo listo|dejarlo listo|listo para publicar|prepara(r)? (el video|para publicar|para redes))\b/.test(
      text,
    );
  if (!trigger) return null;
  const denoise: 'off' | 'light' | 'medium' | 'strong' =
    /\b(sin|no) (denoise|reduccion de ruido|ruido)\b/.test(text)
      ? 'off'
      : /\b(fuerte|agresiv)/.test(text)
        ? 'strong'
        : /\b(suave|leve|liger)/.test(text)
          ? 'light'
          : 'medium';
  return {
    kind: 'auto_cleanup',
    denoise,
    levelAudio: !/\bsin nivelar\b|\bsin nivelado\b/.test(text),
    zoomCuts: !/\bsin zoom\b/.test(text),
    cutSilences: !/\bsin silencios\b/.test(text),
    cutPauses: !/\bsin pausas\b/.test(text),
    targetLufs: -14,
  };
}

/**
 * Piloto automático completo del proyecto.
 *
 * «piloto automático», «auto pilot», «hacer todo automático», «limpiar y exportar».
 * Mide el material, limpia con valores adaptativos, renderiza y verifica el MP4.
 */
export function parseAutoPilotCommand(
  raw: string,
): Extract<OperatorAction, { kind: 'auto_pilot' }> | null {
  const text = normalize(raw);
  const trigger =
    /\b(piloto automatico|auto pilot|autopilot|hac(e|er|é) todo automatico|limpi(a|ar|á) y export(a|ar|á)|procesa(r)? y entrega(r)?|deja(r)? listo y exporta(r)?|exporta(r)? automatico|entrega(r)? automatica|crea(r)? (el )?video automatico)\b/.test(
      text,
    );
  if (!trigger) return null;
  return { kind: 'auto_pilot' };
}

/**
 * Edición genérica.
 *
 * «editá», «arreglalo», «hacelo» no dicen qué hacer, y antes caían al modelo,
 * que contestaba «listo» sin ejecutar nada. En esta app editar sin más detalle
 * significa la limpieza integral: silencios, pausas, ruido, nivelado y zoom.
 *
 * No pisa pedidos específicos: si el texto nombra subtítulos, silencios, música,
 * color, título o exportación, lo resuelve el parser que corresponde.
 */
export function parseGenericEditCommand(
  raw: string,
): Extract<OperatorAction, { kind: 'auto_cleanup' }> | null {
  const text = normalize(raw);
  const verb =
    /\b(edita|editá|editame|edítame|arregla|arreglá|arreglalo|mejora|mejorá|mejoralo|procesa|procesá|hacelo|haceme|metele|dale)\b/.test(
      text,
    );
  const target =
    /\b(video|esto|todo|proyecto|clip|material|timeline|trabajo)\b/.test(text) ||
    /^(editalo|editálo|hacelo|hacé|dale|metele|arreglalo)$/.test(text);
  if (!verb || !target) return null;
  if (
    /\b(silencio|pausa|subtitulo|subtítulo|texto|musica|música|zoom|ruido|volumen|export\w*|titulo|título|color|hablante|marcador)\b/.test(
      text,
    )
  ) {
    return null;
  }
  return {
    kind: 'auto_cleanup',
    denoise: 'medium',
    levelAudio: true,
    zoomCuts: true,
    cutSilences: true,
    cutPauses: true,
    targetLufs: -14,
  };
}

/**
 * Servidor MCP local.
 *
 * «servidor MCP», «conectar una IA», «controlar desde fuera». Arranca el
 * endpoint HTTP y devuelve la configuración para el cliente externo.
 */
export function parseMcpServerCommand(
  raw: string,
): Extract<OperatorAction, { kind: 'mcp_server' }> | null {
  const text = normalize(raw);
  if (
    !/\b(servidor mcp|exponer mcp|mcp externo|conectar (una )?ia|control(ar)? (la app )?desde fuera)\b/.test(
      text,
    )
  ) {
    return null;
  }
  return { kind: 'mcp_server' };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function firstNumber(text: string, patterns: readonly RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match?.[1]) continue;
    const value = Number(match[1].replace(',', '.'));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Comando de corte automático de silencios.
 *
 * Acepta las formas que un usuario escribe de verdad: «cortá los silencios»,
 * «auto corte de silencio», «limpiá los silencios del proyecto con umbral -40».
 * El singular «quita el silencio» queda para desmutear: es otro comando y no
 * debe cambiar de significado.
 */
export function parseSilenceCutCommand(
  raw: string,
): Extract<OperatorAction, { kind: 'cut_silences' }> | null {
  const text = normalize(raw);
  if (!/\bsilencios?\b/.test(text)) return null;
  const verb = /\b(cort\w*|elimin\w*|quit\w*|sac\w*|borr\w*|remov\w*|limpi\w*|auto)\b/.test(text);
  if (!verb) return null;
  const plural = /\bsilencios\b/.test(text);
  const unmute =
    !plural &&
    /\b(quit\w*|desmute\w*|reactiva\w*|desilencia\w*)\b/.test(text) &&
    !/\b(auto|corte|cortar)\b/.test(text);
  if (unmute) return null;

  const threshold = firstNumber(text, [
    /(?:umbral|threshold)\s*(?:de\s*)?(-?\d{1,3}(?:[.,]\d+)?)/,
    /(-?\d{1,3}(?:[.,]\d+)?)\s*db/,
  ]);
  const minimum = firstNumber(text, [/(?:minimo|min)\s*(?:de\s*)?(\d{1,3}(?:[.,]\d+)?)\s*s/]);
  const padding = firstNumber(text, [
    /(?:colchon|margen|padding)\s*(?:de\s*)?(\d{1,3}(?:[.,]\d+)?)\s*s/,
  ]);
  const scope = /\b(todo el proyecto|proyecto completo|todos los clips|todas las pistas|todo)\b/.test(
    text,
  )
    ? 'project'
    : 'selection';

  return {
    kind: 'cut_silences',
    thresholdDb: clampNumber(threshold ?? -45, -90, -10),
    minSilenceSeconds: clampNumber(minimum ?? 0.35, 0.05, 5),
    paddingSeconds: clampNumber(padding ?? 0.15, 0, 2),
    scope,
  };
}

/** Quita artículos y muletillas del nombre de un material. */
function cleanAssetName(raw: string): string {
  const stripped = raw
    .replace(
      /^(?:el|la|los|las|un|una|unos|unas|mi|nuestro|clip|video|imagen|foto|audio|sonido|de|del|que)\b\s*/gi,
      '',
    )
    .replace(/\s+(?:a|en|al|para|de)\s+(?:la\s+)?(?:timeline|pista|final|playhead)\b.*$/i, '')
    .trim();
  // Si al quitar la palabra clave queda un número solo («la imagen foto 3»),
  // el nombre real era el que incluía la palabra clave.
  return stripped.length > 0 && /[a-záéíóúñ]/i.test(stripped) ? stripped : raw.trim();
}

interface ToolRoute {
  readonly match: RegExp;
  readonly view: ViewId;
  readonly label: string;
}

const TOOLS: readonly ToolRoute[] = [
  { match: /denoise|quitar (el )?ruido|sacar (el )?ruido|limpiar (el )?ruido/, view: 'denoise', label: 'Denoise' },
  { match: /nitidez|definicion|enfocar|enfoque/, view: 'sharpen', label: 'Definición' },
  { match: /comprimir|compresi|reducir (el )?peso/, view: 'compress', label: 'Comprimir' },
  { match: /convertir|transcodificar/, view: 'convert', label: 'Convertir' },
  { match: /upscale|agrandar|super-?resolucion|a 4k/, view: 'upscale', label: 'Upscale' },
  { match: /quitar (el )?fondo|sacar (el )?fondo/, view: 'background', label: 'Quitar fondo' },
  { match: /comparar|antes y despues/, view: 'compare', label: 'Comparar' },
  { match: /miniatura/, view: 'thumbnails', label: 'Miniaturas' },
  { match: /subtitul|traduc|localizacio/, view: 'localization', label: 'Localización' },
  { match: /descargar|bajar (el )?video|youtube/, view: 'download', label: 'Descargar' },
  { match: /director/, view: 'director', label: 'Director' },
  { match: /fabrica|en lote|batch/, view: 'factory', label: 'Fábrica' },
  { match: /efectos|visual/, view: 'visuals', label: 'Efectos' },
  { match: /vfx/, view: 'vfx', label: 'VFX' },
  { match: /mezclador|mixer/, view: 'mixer', label: 'Mezcla' },
  { match: /multicamara/, view: 'multicam', label: 'Multicámara' },
  { match: /laboratorio/, view: 'lab', label: 'Laboratorio' },
];

/** Operador local determinista: no usa un modelo ni gasta tokens. */
export function parseOperatorCommand(
  input: string,
  views: readonly OperatorView[],
): OperatorAction {
  const text = normalize(input);
  if (!text) {
    return { kind: 'unknown', message: 'Escribí un comando, por ejemplo “abrir editor”.' };
  }
  if (/^(ayuda|comandos|que podes hacer|qué podés hacer)/.test(text)) {
    return { kind: 'help' };
  }
  if (/^(estado|resumen|donde estoy|dónde estoy)/.test(text)) {
    return { kind: 'status' };
  }
  // El cerebro de edición se dispara por intención, no por acción suelta: el
  // usuario pide "mejorá el ritmo" y la app decide los cortes.
  if (/^(analiza|analizá|diagnostica|diagnosticá|informe|reporte)\b.*\b(cerebro|timeline|ritmo|edicion|edición)/.test(text)) {
    return { kind: 'brain', mode: 'report' };
  }
  if (/\b(cerebro|brain)\b/.test(text)) {
    return { kind: 'brain', mode: /(aplic|todo|completo)/.test(text) ? 'all' : 'safe' };
  }
  if (/(cerra|cerrá|cierra|cerrar)\b.*\bhuecos?\b/.test(text)) {
    return { kind: 'brain', mode: 'safe' };
  }
  if (/(mejora|mejorá|arregla|arreglá|ajusta|ajustá)\b.*\b(ritmo|pacing|edicion|edición)\b/.test(text)) {
    return { kind: 'brain', mode: 'safe' };
  }
  const silenceCut = parseSilenceCutCommand(text);
  if (silenceCut) return silenceCut;
  const voicePauses = parseVoicePauseCutCommand(text);
  if (voicePauses) return voicePauses;
  const autoPilot = parseAutoPilotCommand(text);
  if (autoPilot) return autoPilot;
  const autoCleanup = parseAutoCleanupCommand(text);
  if (autoCleanup) return autoCleanup;
  const genericEdit = parseGenericEditCommand(text);
  if (genericEdit) return genericEdit;
  const mcpServer = parseMcpServerCommand(text);
  if (mcpServer) return mcpServer;
  const autoSubtitles = parseAutoSubtitlesCommand(text);
  if (autoSubtitles) return autoSubtitles;
  if (/^(reproducir|play|dale|seguir|continuar)/.test(text)) return { kind: 'play' };
  if (/^(pausar|pausa|detener|parar|stop)/.test(text)) return { kind: 'pause' };
  if (/^(deshacer|undo|volver atras|volver atrás)/.test(text)) return { kind: 'undo' };
  if (/^(rehacer|redo)/.test(text)) return { kind: 'redo' };
  if (/^(guardar|save|guardar proyecto)/.test(text)) return { kind: 'save' };
  if (/^(exportar|export|renderizar|render)/.test(text)) return { kind: 'export' };

  // Los comandos de motion conservan el texto original (tildes y mayúsculas).
  const raw = input.trim();
  const motionParts = (value: string): { text: string; secondary?: string } => {
    const parts = value
      .split(/\s*[,;]\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length > 1
      ? { text: parts[0]!, secondary: parts.slice(1).join(', ') }
      : { text: parts[0] ?? '' };
  };
  const title = raw.match(
    /^(?:crear|hacer|generar)\s+(?:un\s+)?(?:título|titulo|title|placa de apertura)\s+(.+)$/i,
  );
  if (title?.[1]?.trim()) {
    return { kind: 'motion', templateId: 'title-card', text: title[1].trim() };
  }
  const lower = raw.match(
    /^(?:crear|hacer|generar)\s+(?:un\s+)?(?:lower third|lower-third|placa|nombre)\s+(.+)$/i,
  );
  if (lower?.[1]?.trim()) {
    const parts = motionParts(lower[1]);
    if (parts.text) return { kind: 'motion', templateId: 'lower-third', ...parts };
  }
  const end = raw.match(
    /^(?:crear|hacer|generar)\s+(?:un\s+)?(?:cierre|end card|endcard|outro)\s+(.+)$/i,
  );
  if (end?.[1]?.trim()) {
    const parts = motionParts(end[1]);
    if (parts.text) return { kind: 'motion', templateId: 'end-card', ...parts };
  }
  const stat = raw.match(
    /^(?:crear|hacer|generar)\s+(?:un\s+)?(?:dato|stat|estadística|estadistica)\s+(.+)$/i,
  );
  if (stat?.[1]?.trim()) {
    const parts = motionParts(stat[1]);
    if (parts.text) return { kind: 'motion', templateId: 'stat-callout', ...parts };
  }

  const create = text.match(
    /^(?:crear|hacer|generar)\s+(?:un\s+)?(?:video|short|reel|contenido)\s+(?:sobre|de|con)\s+(.+)$/,
  );
  if (create) return { kind: 'create', topic: create[1]!.trim() };

  // Proyecto nuevo.
  const newProject =
    raw.match(/^(?:nuevo|nueva)\s+proyecto\s+(?:llamado\s+|con\s+nombre\s+)?(.+)$/i) ??
    raw.match(
      /^(?:crear|crear un|crear un nuevo)\s+(?:proyecto|proyecto nuevo)\s+(?:llamado\s+|con\s+nombre\s+|nuevo\s+)?(.+)$/i,
    );
  if (newProject?.[1]?.trim()) {
    return {
      kind: 'new_project',
      name: newProject[1]!.trim().replace(/^["“'«]+|["”'»]+$/g, ''),
    };
  }

  // Importar un archivo por ruta absoluta: Rust valida que exista.
  const importFile =
    raw.match(
      /^(?:importa|importar|importá|agrega|agregar|agregá|sumá|sumar)\s+(?:el\s+|la\s+)?(?:archivo|video|imagen|foto|audio|sonido)\s+["“'«]?([a-zA-Z]:[\\/][^"”'»\n\r]+)["”'»]?$/i,
    ) ?? raw.match(/^(?:importa|importar|importá)\s+["“'«]?([a-zA-Z]:[\\/][^"”'»\n\r]+)["”'»]?$/i);
  if (importFile?.[1]?.trim()) {
    return { kind: 'import_file', path: importFile[1].trim() };
  }

  // Descargar una URL: se encola y se abre Descargar.
  const download = raw.match(
    /^(?:descarga|descargar|bajá|bajar|traé)\s+(?:el\s+|el video de\s+|este\s+)?(https?:\/\/[^\s"”'»]+)/i,
  );
  if (download?.[1]?.trim()) {
    return { kind: 'download_url', url: download[1].trim() };
  }

  // Subtítulo en el playhead: con verbo o suelto. Va antes que «agregar clip»
  // y antes que la herramienta de Localización.
  const caption =
    raw.match(
      /^(?:agrega|agregar|agregá|pone|poner|poné|escribe|escribir|sumá|sumar)\s+(?:un\s+|el\s+)?(?:subtítulo|subtitulo|caption|texto en pantalla)\s+(?:de\s+|que\s+diga\s+|diciendo\s+)?["“'«]?([^"”'»]+?)["”'»]?(?:\s+durante\s+(\d+(?:\.\d+)?)\s*seg?undos?)?$/i,
    ) ??
    raw.match(
      /^(?:subtítulo|subtitulo|caption)\s+(?:de\s+|que\s+diga\s+|diciendo\s+)?["“'«]?([^"”'»]+?)["”'»]?(?:\s+durante\s+(\d+(?:\.\d+)?)\s*seg?undos?)?$/i,
    );
  if (caption?.[1]?.trim()) {
    const seconds = caption[2] ? Number(caption[2]) : 3;
    return {
      kind: 'add_caption',
      text: caption[1].trim(),
      seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 3,
    };
  }

  // Agregar material a la timeline.
  const addClip = raw.match(
    /^(?:agrega|agregar|agregá|mete|meter|sumá|sumar|pone|poné|poner)\s+(?:el\s+|la\s+|los\s+)?(?:clip|video|imagen|foto|audio|sonido)\s+(?:de\s+|del\s+)?["“'«]?([^"”'»]+?)["”'»]?\s*(?:al\s+final|a\s+la\s+timeline|en\s+el\s+playhead|al\s+playhead)?$/i,
  );
  if (addClip?.[1]?.trim()) {
    const asset = cleanAssetName(addClip[1]!);
    if (asset) {
      return {
        kind: 'add_clip',
        asset,
        atPlayhead: /playhead/i.test(addClip[0] ?? ''),
      };
    }
  }

  // Cortar en el playhead.
  if (/^(corta|cortar|cortá|divide|dividir|split|parti|partí)\b/.test(text)) {
    return { kind: 'split_at_playhead' };
  }

  // Borrar lo seleccionado.
  if (
    /^(borra|borrar|borrá|elimina|eliminar|eliminá|saca|sacar|sacá|borrame)\b/.test(text)
  ) {
    return { kind: 'delete_selected' };
  }

  // Ir a un tiempo. La unidad puede ir antes («minuto 2») o después («2 min»).
  const goto = raw.match(
    /^(?:ve|vete|anda|andá|ir|saltar|salta|saltá|movete|moverte)\s+(?:a|al|hasta)\s+(?:el\s+)?(segundos?|minutos?|min|seg|s)?\s*["“'«]?(\d{1,2}:\d{1,2}(?::\d{1,2})?|\d+(?:[.,]\d+)?)["”'»]?\s*(segundos?|minutos?|min|seg|s)?$/i,
  );
  if (goto?.[2]) {
    const unit = `${goto[1] ?? ''}${goto[3] ?? ''}`.toLowerCase();
    if (goto[2].includes(':')) {
      const seconds = parseTimeToSeconds(goto[2]);
      if (seconds !== null) return { kind: 'goto', seconds };
    } else {
      const value = Number(goto[2].replace(',', '.'));
      if (Number.isFinite(value) && value >= 0) {
        const seconds = unit.startsWith('min') ? value * 60 : value;
        return { kind: 'goto', seconds };
      }
    }
  }

  // Velocidad del clip seleccionado.
  const speed = raw.match(
    /^(?:velocidad|acelera|acelerar|ralentiza|ralentizar|frena)\s*(?:a|al|en)?\s*(\d{1,3}\s*%|\d+(?:[.,]\d+)?\s*x?)/i,
  );
  if (speed?.[1]) {
    const value = parseSpeed(speed[1]);
    if (value !== null) return { kind: 'set_speed', speed: value };
  }

  // Ganancia del clip seleccionado.
  const gain = raw.match(
    /^(?:volumen|ganancia|subi|subí|subir|baja|bajar|bajá)\s*(?:el\s+)?(?:volumen|ganancia)?\s*(?:a|en|por)?\s*(\+|-)?\s*(\d+(?:[.,]\d+)?)\s*(?:db)?$/i,
  );
  if (gain) {
    const negative = gain[1] === '-' || /baja|bajá|bajar/i.test(gain[0] ?? '');
    const value = parseDecibels(`${negative ? '-' : ''}${gain[2]}`);
    if (value !== null && value !== 0) return { kind: 'set_gain', db: value };
  }

  // Silenciar / reactivar el clip seleccionado.
  if (/^(silencia|silenciar|silenciá|mute|mutear|calla|callar)\b/.test(text)) {
    return { kind: 'mute_clip', muted: true };
  }
  if (
    /^(desmute|desmutear|quita el silencio|quitar el silencio|reactiva el audio|desilencia)\b/.test(
      text,
    )
  ) {
    return { kind: 'mute_clip', muted: false };
  }

  // Herramientas con lenguaje natural: mismo valor que «abrir <vista>».
  if (/^(abre|abrir|abri|abrime|usar|usa|usá|quiero)\b/.test(text)) {
    const tool = TOOLS.find((entry) => entry.match.test(text));
    if (tool) return { kind: 'navigate', view: tool.view, label: tool.label };
  }

  // "usá los archivos de descargas de la carpeta video 1" o "usá los archivos de D:\Videos":
  // operador local determinista, sin gasto de tokens.
  const directPath = raw.match(
    /(?:usar|usa|usá|montar|cargar)\s+(?:los\s+archivos\s+(?:de\s+)?)?(?:carpeta\s+)?(["“'«]?([a-zA-Z]:[\\/][^"”'»\n\r]+)["”'»]?)/i,
  );
  if (directPath?.[2]?.trim()) {
    return { kind: 'media_folder', folder: directPath[2].trim() };
  }

  if (
    raw.toLowerCase().includes('carpeta') &&
    /(descarga|imagen|imagenes|foto|fotos|audio|sonido|video|archivo|montar|usar|usa|usá)/i.test(raw)
  ) {
    const match = raw.match(
      /carpeta\s+["“'«]?([^"”'»\n\r]+?)["”'»]?(?:\s+(?:de|en)\s+descargas?|\s+para\b|$)/i,
    );
    const folder = match?.[1]?.trim();
    if (folder) return { kind: 'media_folder', folder };
  }
  const navigation = text.match(
    /^(?:abrir|abri|ir a|ve a|ve al|navegar a|ir|abrime|mostrame)\s+(.+)$/,
  );
  if (navigation) {
    const target = navigation[1]!.trim();
    const view =
      views.find((entry) => normalize(entry.label) === target) ??
      views.find((entry) => normalize(entry.id) === target) ??
      views.find((entry) => normalize(entry.label).includes(target));
    if (view) return { kind: 'navigate', view: view.id, label: view.label };
    return {
      kind: 'unknown',
      message: `No conozco la vista “${target}”. Probá con Inicio, Editor, Director o Ajustes.`,
    };
  }
  return {
    kind: 'unknown',
    message:
      'No entendí. Probá “abrir editor”, “agregá el clip b-roll”, “cortá acá”, “subtítulo Hola”, “velocidad 2x”, “descarga https://…” o “estado”.',
  };
}

export const OPERATOR_HELP =
  'Podés pedirme: abrir <vista> · nueva proyecto <nombre> · importar <ruta> · usar la carpeta <nombre> de descargas · descargar <url> · agregá el clip <material> · cortá acá · borrá lo seleccionado · andá al segundo 30 · subtítulo <texto> durante 3 segundos · velocidad 2x · volumen +3 · silenciá el clip · cortá los silencios [del proyecto] [umbral -40] · subtitulá el clip [o todo el proyecto] · cortá las pausas [entre frases] · limpiá el video [sin zoom] · crear un video sobre <tema> · crear título <texto> · crear lower third <nombre, rol> · crear cierre <texto> · crear dato <valor, etiqueta> · reproducir, pausar, guardar, exportar, deshacer, rehacer y estado. La edición de timeline corre local y se puede deshacer.';
