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
  | { readonly kind: 'status' }
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
  if (/^(reproducir|play|dale|seguir|continuar)/.test(text)) return { kind: 'play' };
  if (/^(pausar|pausa|detener|parar|stop)/.test(text)) return { kind: 'pause' };
  if (/^(deshacer|undo|volver atras|volver atrás)/.test(text)) return { kind: 'undo' };
  if (/^(rehacer|redo)/.test(text)) return { kind: 'redo' };
  if (/^(guardar|save|guardar proyecto)/.test(text)) return { kind: 'save' };
  if (/^(exportar|export|renderizar|render)/.test(text)) return { kind: 'export' };
  const create = text.match(/^(?:crear|hacer|generar)\s+(?:un\s+)?(?:video|short|reel|contenido)\s+(?:sobre|de|con)\s+(.+)$/);
  if (create) return { kind: 'create', topic: create[1]!.trim() };
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
      'No entendí. Probá “abrir editor”, “reproducir”, “pausar”, “guardar”, “exportar”, “deshacer” o “estado”.',
  };
}

export const OPERATOR_HELP =
  'Comandos: abrir <vista>, crear un video sobre <tema>, reproducir, pausar, guardar, exportar, deshacer, rehacer, estado. Es un operador local determinista: no usa IA ni tokens.';
