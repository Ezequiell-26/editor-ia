/**
 * Rotación de cuentas de Google Flow.
 *
 * El servidor MCP de Flow soporta varios perfiles de Google y recibe
 * `accountId` por llamada. Lo que faltaba era la política: cuando una cuenta se
 * queda sin créditos, probar la siguiente en vez de fallar.
 *
 * Dos reglas para no hacer macanas:
 * - Sólo se rota ante un fallo **de créditos**. Un error de UI, de red o de
 *   política no se reintenta: cambiar de cuenta no lo arregla y gasta tiempo.
 * - Se prueban las cuentas conectadas una vez cada una, en orden, empezando por
 *   la elegida. Nunca se entra en un ciclo.
 */

export interface FlowAccount {
  readonly id: string;
  readonly label: string;
  readonly connected: boolean;
}

export interface FlowAccountsSnapshot {
  readonly accounts: readonly FlowAccount[];
  readonly defaultAccountId: string | null;
  readonly readyForGeneration: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** Normaliza lo que devuelve `flow_list_accounts`. */
export function parseFlowAccounts(payload: unknown): FlowAccountsSnapshot {
  const record = asRecord(payload);
  const raw = Array.isArray(record?.accounts) ? (record.accounts as unknown[]) : [];
  const accounts: FlowAccount[] = [];
  for (const item of raw) {
    const entry = asRecord(item);
    if (!entry || typeof entry.id !== 'string' || entry.id.length === 0) continue;
    const label =
      typeof entry.label === 'string' && entry.label.trim().length > 0
        ? entry.label.trim()
        : typeof entry.email === 'string' && entry.email.trim().length > 0
          ? entry.email.trim()
          : entry.id.slice(0, 8);
    accounts.push({
      id: entry.id,
      label,
      connected: entry.connectionStatus !== 'disconnected',
    });
  }
  const defaultAccountId =
    typeof record?.defaultAccountId === 'string' && record.defaultAccountId.length > 0
      ? record.defaultAccountId
      : null;
  return {
    accounts,
    defaultAccountId,
    readyForGeneration: record?.readyForGeneration === true,
  };
}

const CREDIT_TEXT =
  /not enough (?:ai )?credits|insufficient (?:ai )?credits|out of (?:ai )?credits|no credits|credit limit|quota (?:exceeded|exhausted)|puntos insuficientes|sin cr[eé]ditos|cr[eé]ditos agotados|se agotaron los cr[eé]ditos/i;

const CREDIT_CODES = new Set([
  'insufficient_credits',
  'credits_exhausted',
  'quota_exceeded',
  'credit_limit_reached',
]);

/** ¿El fallo es por créditos? Sólo entonces tiene sentido rotar. */
export function isCreditFailure(message: string, code?: string | null): boolean {
  if (code && CREDIT_CODES.has(code.trim().toLowerCase())) return true;
  return CREDIT_TEXT.test(message);
}

/**
 * Orden de intentos: la cuenta elegida primero y después las demás conectadas.
 * Las desconectadas quedan afuera.
 */
export function accountRotation(
  accounts: readonly FlowAccount[],
  startId?: string | null,
): FlowAccount[] {
  const connected = accounts.filter((account) => account.connected);
  const start = connected.findIndex((account) => account.id === startId);
  if (start <= 0) return connected;
  return [...connected.slice(start), ...connected.slice(0, start)];
}

export interface FlowAttemptFailure {
  readonly accountId: string;
  readonly message: string;
  readonly credit: boolean;
}

export interface FlowRotationResult<T> {
  readonly value: T | null;
  readonly accountId: string | null;
  readonly failures: readonly FlowAttemptFailure[];
}

/**
 * Ejecuta `call` con cada cuenta hasta que una funcione.
 *
 * `call` devuelve `{ ok: true, value }` o `{ ok: false, message, code }`.
 * Se corta en el primer éxito o en el primer fallo que **no** sea de créditos:
 * si la cuenta funciona pero Flow falla por otra cosa, rotar sólo multiplica el
 * error.
 */
export async function generateWithRotation<T>(
  accounts: readonly FlowAccount[],
  startId: string | null,
  call: (accountId: string) => Promise<
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string; readonly code?: string | null }
  >,
): Promise<FlowRotationResult<T>> {
  const order = accountRotation(accounts, startId);
  const failures: FlowAttemptFailure[] = [];
  if (order.length === 0) {
    return { value: null, accountId: null, failures };
  }
  for (const account of order) {
    const outcome = await call(account.id);
    if (outcome.ok) {
      return { value: outcome.value, accountId: account.id, failures };
    }
    const credit = isCreditFailure(outcome.message, outcome.code);
    failures.push({ accountId: account.id, message: outcome.message, credit });
    if (!credit) break;
  }
  return { value: null, accountId: null, failures };
}
