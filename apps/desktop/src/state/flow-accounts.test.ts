import { describe, expect, it } from 'vitest';
import {
  accountRotation,
  generateWithRotation,
  isCreditFailure,
  parseFlowAccounts,
  type FlowAccount,
} from './flow-accounts';

const ACCOUNTS: FlowAccount[] = [
  { id: 'a', label: 'Ana', connected: true },
  { id: 'b', label: 'Beto', connected: true },
  { id: 'c', label: 'Caída', connected: false },
];

describe('parseFlowAccounts', () => {
  it('normaliza cuentas, default y disponibilidad', () => {
    const snapshot = parseFlowAccounts({
      accounts: [
        { id: 'a', label: 'Ana', connectionStatus: 'connected' },
        { id: 'b', email: 'beto@example.com', connectionStatus: 'connected' },
        { id: 'c', connectionStatus: 'disconnected' },
      ],
      defaultAccountId: 'a',
      readyForGeneration: true,
    });
    expect(snapshot.accounts).toHaveLength(3);
    expect(snapshot.accounts[1]?.label).toBe('beto@example.com');
    expect(snapshot.accounts[2]?.connected).toBe(false);
    expect(snapshot.defaultAccountId).toBe('a');
    expect(snapshot.readyForGeneration).toBe(true);
  });

  it('tolera basura', () => {
    expect(parseFlowAccounts(null).accounts).toEqual([]);
    expect(parseFlowAccounts({ accounts: [{}, { id: '' }] }).accounts).toEqual([]);
  });
});

describe('isCreditFailure', () => {
  it('reconoce el texto en inglés y español', () => {
    expect(isCreditFailure('Flow: not enough AI credits')).toBe(true);
    expect(isCreditFailure('No hay puntos insuficientes para generar')).toBe(true);
    expect(isCreditFailure('Se agotaron los créditos de tu cuenta')).toBe(true);
  });

  it('reconoce los códigos', () => {
    expect(isCreditFailure('cualquier cosa', 'insufficient_credits')).toBe(true);
    expect(isCreditFailure('cualquier cosa', 'QUOTA_EXCEEDED')).toBe(true);
  });

  it('no confunde otros errores', () => {
    expect(isCreditFailure('Flow cambió la interfaz')).toBe(false);
    expect(isCreditFailure('timeout esperando la descarga')).toBe(false);
    expect(isCreditFailure('blocked by policy', 'generation_failed')).toBe(false);
  });
});

describe('accountRotation', () => {
  it('empieza por la elegida y sigue con las demás conectadas', () => {
    expect(accountRotation(ACCOUNTS, 'b').map((account) => account.id)).toEqual(['b', 'a']);
  });

  it('sin elegida usa el orden natural', () => {
    expect(accountRotation(ACCOUNTS, null).map((account) => account.id)).toEqual(['a', 'b']);
  });

  it('si la elegida no existe, no pierde cuentas', () => {
    expect(accountRotation(ACCOUNTS, 'zzz').map((account) => account.id)).toEqual(['a', 'b']);
  });
});

describe('generateWithRotation', () => {
  it('pasa a la siguiente cuenta cuando se agotan los créditos', async () => {
    const tried: string[] = [];
    const result = await generateWithRotation(ACCOUNTS, 'a', async (accountId) => {
      tried.push(accountId);
      if (accountId === 'a') {
        return { ok: false as const, message: 'not enough AI credits', code: 'generation_failed' };
      }
      return { ok: true as const, value: `video-${accountId}` };
    });
    expect(tried).toEqual(['a', 'b']);
    expect(result.value).toBe('video-b');
    expect(result.accountId).toBe('b');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.credit).toBe(true);
  });

  it('no rota ante un error que no es de créditos', async () => {
    const tried: string[] = [];
    const result = await generateWithRotation(ACCOUNTS, 'a', async (accountId) => {
      tried.push(accountId);
      return { ok: false as const, message: 'Flow cambió la interfaz', code: 'ui_changed' };
    });
    expect(tried).toEqual(['a']);
    expect(result.value).toBeNull();
    expect(result.failures).toHaveLength(1);
  });

  it('si todas se agotan, devuelve el detalle', async () => {
    const result = await generateWithRotation(ACCOUNTS, 'a', async () => ({
      ok: false as const,
      message: 'puntos insuficientes',
    }));
    expect(result.value).toBeNull();
    expect(result.failures.map((failure) => failure.accountId)).toEqual(['a', 'b']);
    expect(result.failures.every((failure) => failure.credit)).toBe(true);
  });

  it('sin cuentas conectadas no intenta nada', async () => {
    const result = await generateWithRotation([], null, async () => {
      throw new Error('no debería llamarse');
    });
    expect(result.value).toBeNull();
    expect(result.accountId).toBeNull();
  });
});
