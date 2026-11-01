/**
 * Runtime mínimo pero real de state machines dotLottie 2.0.
 *
 * Soporta states Playback/Global, transiciones inmediatas y tweened (aplicadas
 * como inmediatas), guards Boolean/Numeric/String/Event y las acciones de
 * inputs/theme/frame. Las interacciones de puntero y los callbacks OnComplete
 * no se simulan en el editor: se avisan y se manejan con inputs explícitos.
 *
 * El objetivo es que un pack `.lottie` pueda previsualizarse y exportarse con
 * el estado/animación/segmento elegido, sin fingir interacción de mouse.
 */

export type StateMachineValue = boolean | number | string;

export interface LottieStateMachineInput {
  readonly type: 'Boolean' | 'Numeric' | 'String' | 'Event';
  readonly name: string;
  readonly value?: StateMachineValue;
}

export interface LottieStateMachineGuard {
  readonly type: 'Boolean' | 'Numeric' | 'String' | 'Event';
  readonly inputName: string;
  readonly conditionType?: string;
  readonly compareTo?: unknown;
}

export interface LottieStateMachineAction {
  readonly type: string;
  readonly inputName?: string;
  readonly value?: unknown;
}

export interface LottieStateMachineTransition {
  readonly type: 'Transition' | 'Tweened';
  readonly toState: string;
  readonly guards: readonly LottieStateMachineGuard[];
  readonly duration?: number;
  readonly easing?: readonly number[];
}

export interface LottieStateMachineState {
  readonly name: string;
  readonly type: 'PlaybackState' | 'GlobalState';
  readonly animation?: string;
  readonly segment?: readonly [number, number];
  readonly loop?: boolean;
  readonly autoplay?: boolean;
  readonly mode?: string;
  readonly speed?: number;
  readonly entryActions: readonly LottieStateMachineAction[];
  readonly exitActions: readonly LottieStateMachineAction[];
  readonly transitions: readonly LottieStateMachineTransition[];
}

export interface LottieStateMachine {
  readonly id: string;
  readonly name?: string;
  readonly initial: string;
  readonly states: readonly LottieStateMachineState[];
  readonly inputs: readonly LottieStateMachineInput[];
  readonly interactions: readonly Record<string, unknown>[];
}

export interface LottieStateMachineSnapshot {
  readonly machineId: string;
  readonly currentState: string;
  readonly inputs: Readonly<Record<string, StateMachineValue>>;
  readonly themeId: string | null;
  readonly frame: number | null;
  readonly events: readonly string[];
  readonly warnings: readonly string[];
  readonly state: LottieStateMachineState | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;
  return value as number[];
}

function parseAction(value: unknown): LottieStateMachineAction | null {
  const record = asRecord(value);
  if (!record || typeof record.type !== 'string') return null;
  return {
    type: record.type,
    ...(typeof record.inputName === 'string' ? { inputName: record.inputName } : {}),
    ...(record.value !== undefined ? { value: record.value } : {}),
  };
}

function parseGuard(value: unknown): LottieStateMachineGuard | null {
  const record = asRecord(value);
  if (!record || typeof record.type !== 'string' || typeof record.inputName !== 'string') {
    return null;
  }
  const type = record.type as LottieStateMachineGuard['type'];
  if (!['Boolean', 'Numeric', 'String', 'Event'].includes(type)) return null;
  return {
    type,
    inputName: record.inputName,
    ...(typeof record.conditionType === 'string' ? { conditionType: record.conditionType } : {}),
    ...(record.compareTo !== undefined ? { compareTo: record.compareTo } : {}),
  };
}

function parseTransition(value: unknown): LottieStateMachineTransition | null {
  const record = asRecord(value);
  if (!record || typeof record.toState !== 'string') return null;
  const type = record.type === 'Tweened' ? 'Tweened' : 'Transition';
  const guards = Array.isArray(record.guards)
    ? record.guards.flatMap((guard) => {
        const parsed = parseGuard(guard);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    type,
    toState: record.toState,
    guards,
    ...(typeof record.duration === 'number' ? { duration: record.duration } : {}),
    ...(numberArray(record.easing) ? { easing: numberArray(record.easing)! } : {}),
  };
}

function parseState(value: unknown): LottieStateMachineState | null {
  const record = asRecord(value);
  if (!record || typeof record.name !== 'string' || !record.name.trim()) return null;
  const type = record.type === 'GlobalState' ? 'GlobalState' : 'PlaybackState';
  const segment = numberArray(record.segment);
  return {
    name: record.name,
    type,
    ...(typeof record.animation === 'string' ? { animation: record.animation } : {}),
    ...(segment && segment.length >= 2
      ? { segment: [segment[0]!, segment[1]!] as const }
      : {}),
    ...(typeof record.loop === 'boolean' ? { loop: record.loop } : {}),
    ...(typeof record.autoplay === 'boolean' ? { autoplay: record.autoplay } : {}),
    ...(typeof record.mode === 'string' ? { mode: record.mode } : {}),
    ...(typeof record.speed === 'number' && Number.isFinite(record.speed)
      ? { speed: record.speed }
      : {}),
    entryActions: Array.isArray(record.entryActions)
      ? record.entryActions.flatMap((action) => {
          const parsed = parseAction(action);
          return parsed ? [parsed] : [];
        })
      : [],
    exitActions: Array.isArray(record.exitActions)
      ? record.exitActions.flatMap((action) => {
          const parsed = parseAction(action);
          return parsed ? [parsed] : [];
        })
      : [],
    transitions: Array.isArray(record.transitions)
      ? record.transitions.flatMap((transition) => {
          const parsed = parseTransition(transition);
          return parsed ? [parsed] : [];
        })
      : [],
  };
}

export function parseLottieStateMachine(
  id: string,
  value: unknown,
): LottieStateMachine | null {
  const record = asRecord(value);
  if (!record || typeof record.initial !== 'string' || !record.initial.trim()) return null;
  const states = Array.isArray(record.states)
    ? record.states.flatMap((state) => {
        const parsed = parseState(state);
        return parsed ? [parsed] : [];
      })
    : [];
  if (states.length === 0) return null;
  const inputs = Array.isArray(record.inputs)
    ? record.inputs.flatMap((input) => {
        const item = asRecord(input);
        if (!item || typeof item.name !== 'string') return [];
        const type = item.type as LottieStateMachineInput['type'];
        if (!['Boolean', 'Numeric', 'String', 'Event'].includes(type)) return [];
        const value = item.value;
        const valid =
          type === 'Event' ||
          (type === 'Boolean' && typeof value === 'boolean') ||
          (type === 'Numeric' && typeof value === 'number' && Number.isFinite(value)) ||
          (type === 'String' && typeof value === 'string');
        if (!valid) return [];
        return [
          {
            type,
            name: item.name,
            ...(value !== undefined ? { value: value as StateMachineValue } : {}),
          },
        ];
      })
    : [];
  const interactions = Array.isArray(record.interactions)
    ? record.interactions.flatMap((interaction) => {
        const parsed = asRecord(interaction);
        return parsed ? [parsed] : [];
      })
    : [];
  const name = typeof record.name === 'string' ? record.name : undefined;
  return {
    id,
    ...(name ? { name } : {}),
    initial: record.initial,
    states,
    inputs,
    interactions,
  };
}

function defaultFor(input: LottieStateMachineInput): StateMachineValue {
  if (input.value !== undefined) return input.value;
  if (input.type === 'Boolean') return false;
  if (input.type === 'Numeric') return 0;
  if (input.type === 'String') return '';
  return false;
}

function coerce(input: LottieStateMachineInput, value: unknown): StateMachineValue | null {
  if (input.type === 'Boolean') return typeof value === 'boolean' ? value : null;
  if (input.type === 'Numeric') {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  if (input.type === 'String') return typeof value === 'string' ? value : null;
  return null;
}

export class LottieStateMachineRuntime {
  private readonly machine: LottieStateMachine;
  private readonly inputs: Map<string, LottieStateMachineInput>;
  private values: Map<string, StateMachineValue>;
  private current: string;
  private themeId: string | null;
  private frame: number | null = null;
  private events: string[] = [];
  private readonly warnings: string[] = [];
  private readonly warned = new Set<string>();

  constructor(machine: LottieStateMachine, options: { initialTheme?: string | null } = {}) {
    this.machine = machine;
    this.inputs = new Map(machine.inputs.map((input) => [input.name, input]));
    this.values = new Map(
      machine.inputs.map((input) => [input.name, defaultFor(input)]),
    );
    this.current = machine.states.some((state) => state.name === machine.initial)
      ? machine.initial
      : machine.states[0]!.name;
    this.themeId = options.initialTheme ?? null;
    if (machine.interactions.length > 0) {
      this.warn(
        'Las interacciones del pack (puntero, click u OnComplete) no se simulan; usá los inputs del panel.',
      );
    }
    for (const state of machine.states) {
      if (state.transitions.some((transition) => transition.type === 'Tweened')) {
        this.warn('Las transiciones Tweened se aplican como inmediatas.');
      }
      if (state.mode && state.mode !== 'Forward') {
        this.warn(
          `El estado "${state.name}" usa modo ${state.mode}; la exportación usa Forward.`,
        );
      }
      if (state.speed !== undefined && state.speed !== 1) {
        this.warn(
          `El estado "${state.name}" usa velocidad ${state.speed}; la exportación usa 1×.`,
        );
      }
    }
    const initial = this.state();
    if (initial) {
      this.runActions(initial.entryActions, new Set());
      this.evaluate(new Set());
    }
  }

  private warn(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    this.warnings.push(message);
  }

  private state(name = this.current): LottieStateMachineState | null {
    return this.machine.states.find((state) => state.name === name) ?? null;
  }

  private resolveCompare(value: unknown): unknown {
    if (typeof value === 'string' && value.startsWith('$')) {
      return this.values.get(value.slice(1));
    }
    return value;
  }

  private guardPasses(guard: LottieStateMachineGuard, fired: Set<string>): boolean {
    if (guard.type === 'Event') return fired.has(guard.inputName);
    const actual = this.values.get(guard.inputName);
    const expected = this.resolveCompare(guard.compareTo);
    const condition = guard.conditionType ?? 'Equal';
    if (guard.type === 'Boolean') {
      if (condition === 'NotEqual') return actual !== expected;
      return actual === expected;
    }
    if (guard.type === 'String') {
      if (condition === 'NotEqual') return actual !== expected;
      return actual === expected;
    }
    if (guard.type === 'Numeric') {
      if (typeof actual !== 'number' || typeof expected !== 'number') return false;
      switch (condition) {
        case 'NotEqual':
          return actual !== expected;
        case 'GreaterThan':
          return actual > expected;
        case 'GreaterThanOrEqual':
          return actual >= expected;
        case 'LessThan':
          return actual < expected;
        case 'LessThanOrEqual':
          return actual <= expected;
        default:
          return actual === expected;
      }
    }
    return false;
  }

  private transitionFor(
    state: LottieStateMachineState | null,
    fired: Set<string>,
  ): LottieStateMachineTransition | null {
    if (!state) return null;
    for (const transition of state.transitions) {
      if (transition.type === 'Tweened') {
        this.warn('Las transiciones Tweened se aplican como inmediatas.');
      }
      if (transition.guards.every((guard) => this.guardPasses(guard, fired))) {
        return transition;
      }
    }
    return null;
  }

  private runActions(actions: readonly LottieStateMachineAction[], fired: Set<string>): void {
    for (const action of actions) {
      switch (action.type) {
        case 'SetTheme':
          if (typeof action.value === 'string') this.themeId = action.value;
          else this.warn('La acción SetTheme no tiene un ID de tema válido.');
          break;
        case 'SetBoolean':
        case 'SetString':
        case 'SetNumeric': {
          const input = action.inputName ? this.inputs.get(action.inputName) : undefined;
          if (!input) {
            this.warn(`La acción ${action.type} apunta a un input inexistente.`);
            break;
          }
          const next = coerce(input, action.value);
          if (next === null) {
            this.warn(`La acción ${action.type} tiene un valor incompatible.`);
            break;
          }
          this.values.set(input.name, next);
          break;
        }
        case 'Increment':
        case 'Decrement': {
          const input = action.inputName ? this.inputs.get(action.inputName) : undefined;
          const current = input ? this.values.get(input.name) : undefined;
          if (!input || input.type !== 'Numeric' || typeof current !== 'number') {
            this.warn(`La acción ${action.type} requiere un input numérico.`);
            break;
          }
          const step = typeof action.value === 'number' ? action.value : 1;
          this.values.set(
            input.name,
            current + (action.type === 'Increment' ? step : -step),
          );
          break;
        }
        case 'Toggle': {
          const input = action.inputName ? this.inputs.get(action.inputName) : undefined;
          if (!input || input.type !== 'Boolean') {
            this.warn('La acción Toggle requiere un input booleano.');
            break;
          }
          this.values.set(input.name, !this.values.get(input.name));
          break;
        }
        case 'Fire':
          if (action.inputName) fired.add(action.inputName);
          break;
        case 'SetFrame':
        case 'SetProgress':
          if (typeof action.value === 'number' && Number.isFinite(action.value)) {
            this.frame = action.value;
            this.warn(
              'Las acciones SetFrame/SetProgress se registran, pero la preview/export usa el segmento completo del estado.',
            );
          }
          break;
        case 'FireCustomEvent':
          if (typeof action.value === 'string') this.events.push(action.value);
          break;
        case 'OpenUrl':
          this.warn('La acción OpenUrl se bloqueó: el editor no abre enlaces del pack.');
          break;
        case 'Reset':
          this.reset();
          break;
        default:
          this.warn(`La acción ${action.type} no está soportada.`);
      }
    }
  }

  private evaluate(fired: Set<string>): void {
    for (let step = 0; step < 16; step += 1) {
      const globals = this.machine.states.filter((state) => state.type === 'GlobalState');
      let transition = null as LottieStateMachineTransition | null;
      for (const global of globals) {
        transition = this.transitionFor(global, fired);
        if (transition) break;
      }
      transition ??= this.transitionFor(this.state(), fired);
      if (!transition) return;
      const current = this.state();
      if (current) this.runActions(current.exitActions, fired);
      const next = this.state(transition.toState);
      if (!next) {
        this.warn(`La transición apunta al estado inexistente "${transition.toState}".`);
        return;
      }
      this.current = next.name;
      this.runActions(next.entryActions, fired);
    }
    this.warn('La state machine superó 16 transiciones seguidas; se detuvo.');
  }

  setInput(name: string, value: StateMachineValue): boolean {
    const input = this.inputs.get(name);
    if (!input || input.type === 'Event') return false;
    const next = coerce(input, value);
    if (next === null) return false;
    this.values.set(name, next);
    this.evaluate(new Set());
    return true;
  }

  /** Permite que el selector de tema del panel mantenga sincronizado el runtime. */
  setTheme(themeId: string | null): void {
    this.themeId = themeId;
  }

  fireEvent(name: string): boolean {
    const input = this.inputs.get(name);
    if (input && input.type !== 'Event') return false;
    const fired = new Set<string>([name]);
    this.evaluate(fired);
    return true;
  }

  reset(): void {
    this.current = this.machine.states.some((state) => state.name === this.machine.initial)
      ? this.machine.initial
      : this.machine.states[0]!.name;
    this.values = new Map(
      this.machine.inputs.map((input) => [input.name, defaultFor(input)]),
    );
    this.frame = null;
    this.events = [];
  }

  snapshot(): LottieStateMachineSnapshot {
    return {
      machineId: this.machine.id,
      currentState: this.current,
      inputs: Object.fromEntries(this.values),
      themeId: this.themeId,
      frame: this.frame,
      events: [...this.events],
      warnings: [...this.warnings],
      state: this.state(),
    };
  }
}
