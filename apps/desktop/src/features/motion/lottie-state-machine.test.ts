import { describe, expect, it } from 'vitest';
import { LottieStateMachineRuntime, parseLottieStateMachine } from './lottie-state-machine';

function machine(): Record<string, unknown> {
  return {
    initial: 'idle',
    inputs: [
      { type: 'Boolean', name: 'isActive', value: false },
      { type: 'Numeric', name: 'count', value: 0 },
    ],
    states: [
      {
        name: 'idle',
        type: 'PlaybackState',
        animation: 'anim_1',
        loop: true,
        transitions: [
          {
            type: 'Transition',
            toState: 'active',
            guards: [
              { type: 'Boolean', inputName: 'isActive', conditionType: 'Equal', compareTo: true },
            ],
          },
        ],
      },
      {
        name: 'active',
        type: 'PlaybackState',
        animation: 'anim_2',
        segment: [10, 40],
        entryActions: [{ type: 'SetTheme', value: 'active_theme' }],
        transitions: [
          {
            type: 'Transition',
            toState: 'idle',
            guards: [
              { type: 'Boolean', inputName: 'isActive', conditionType: 'Equal', compareTo: false },
            ],
          },
        ],
      },
    ],
    interactions: [{ type: 'Click', actions: [{ type: 'Toggle', inputName: 'isActive' }] }],
  };
}

describe('parseLottieStateMachine', () => {
  it('parsea estados, inputs, guards y acciones', () => {
    const parsed = parseLottieStateMachine('sm', machine());
    expect(parsed?.initial).toBe('idle');
    expect(parsed?.states).toHaveLength(2);
    expect(parsed?.states[1]?.segment).toEqual([10, 40]);
    expect(parsed?.inputs).toHaveLength(2);
    expect(parsed?.interactions).toHaveLength(1);
    expect(parseLottieStateMachine('bad', { initial: '', states: [] })).toBeNull();
  });
});

describe('LottieStateMachineRuntime', () => {
  it('transiciona por input, aplica SetTheme y expone animación/segmento', () => {
    const runtime = new LottieStateMachineRuntime(parseLottieStateMachine('sm', machine())!);
    expect(runtime.snapshot().currentState).toBe('idle');
    expect(runtime.snapshot().state?.animation).toBe('anim_1');

    expect(runtime.setInput('isActive', true)).toBe(true);
    const active = runtime.snapshot();
    expect(active.currentState).toBe('active');
    expect(active.state?.animation).toBe('anim_2');
    expect(active.state?.segment).toEqual([10, 40]);
    expect(active.themeId).toBe('active_theme');
    expect(active.inputs.isActive).toBe(true);

    expect(runtime.setInput('isActive', false)).toBe(true);
    expect(runtime.snapshot().currentState).toBe('idle');
  });

  it('evalúa eventos, comparaciones numéricas y acciones de inputs', () => {
    const parsed = parseLottieStateMachine('sm', {
      initial: 'idle',
      inputs: [
        { type: 'Event', name: 'go' },
        { type: 'Numeric', name: 'value', value: 0 },
        { type: 'Numeric', name: 'threshold', value: 5 },
      ],
      states: [
        {
          name: 'idle',
          type: 'PlaybackState',
          transitions: [
            { type: 'Transition', toState: 'play', guards: [{ type: 'Event', inputName: 'go' }] },
          ],
        },
        {
          name: 'play',
          type: 'PlaybackState',
          entryActions: [
            { type: 'SetNumeric', inputName: 'value', value: 7 },
            { type: 'Increment', inputName: 'value', value: 2 },
          ],
          transitions: [
            {
              type: 'Transition',
              toState: 'done',
              guards: [
                {
                  type: 'Numeric',
                  inputName: 'value',
                  conditionType: 'GreaterThan',
                  compareTo: '$threshold',
                },
              ],
            },
          ],
        },
        { name: 'done', type: 'PlaybackState', transitions: [] },
      ],
    })!;
    const runtime = new LottieStateMachineRuntime(parsed);
    expect(runtime.fireEvent('go')).toBe(true);
    const snapshot = runtime.snapshot();
    expect(snapshot.currentState).toBe('done');
    expect(snapshot.inputs.value).toBe(9);
  });

  it('avisa interacciones de puntero, Tweened y modos no Forward', () => {
    const parsed = parseLottieStateMachine('sm', {
      initial: 'a',
      inputs: [{ type: 'Boolean', name: 'go', value: false }],
      states: [
        {
          name: 'a',
          type: 'PlaybackState',
          mode: 'Reverse',
          speed: 2,
          transitions: [
            { type: 'Tweened', toState: 'b', duration: 1, guards: [] },
          ],
        },
        { name: 'b', type: 'PlaybackState', transitions: [] },
      ],
      interactions: [{ type: 'Click', actions: [] }],
    })!;
    const runtime = new LottieStateMachineRuntime(parsed);
    const warnings = runtime.snapshot().warnings.join(' ');
    expect(warnings).toMatch(/puntero/);
    expect(warnings).toMatch(/Tweened/);
    expect(warnings).toMatch(/Reverse/);
    expect(warnings).toMatch(/velocidad 2/);
  });

  it('reinicia inputs y estado', () => {
    const runtime = new LottieStateMachineRuntime(parseLottieStateMachine('sm', machine())!);
    runtime.setInput('isActive', true);
    runtime.reset();
    const snapshot = runtime.snapshot();
    expect(snapshot.currentState).toBe('idle');
    expect(snapshot.inputs.isActive).toBe(false);
  });

  it('ejecuta las entryActions del estado inicial al arrancar', () => {
    const parsed = parseLottieStateMachine('sm', {
      initial: 'idle',
      inputs: [],
      states: [
        {
          name: 'idle',
          type: 'PlaybackState',
          entryActions: [{ type: 'SetTheme', value: 'inicial' }],
          transitions: [],
        },
      ],
    })!;
    const runtime = new LottieStateMachineRuntime(parsed);
    expect(runtime.snapshot().themeId).toBe('inicial');
  });
});
