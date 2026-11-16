import { describe, expect, it } from 'vitest';
import type { McpAuditEntry } from '../../services/project-service';
import {
  asAuditEntry,
  auditEntriesOf,
  auditEntryDuration,
  auditEntryScopes,
  auditEntryStatus,
  auditEntryTime,
  auditEntryTool,
} from './mcp-audit';

describe('helpers del audit log MCP', () => {
  it('normaliza sólo objetos: líneas JSON de otro tipo no tienen campos', () => {
    expect(asAuditEntry({ tool: 'ping' })).toEqual({ tool: 'ping' });
    expect(asAuditEntry('texto suelto')).toEqual({});
    expect(asAuditEntry(42)).toEqual({});
    expect(asAuditEntry(null)).toEqual({});
    expect(asAuditEntry([{ tool: 'x' }])).toEqual({});
  });

  it('distingue ok, error, rechazo por scope y desconocido', () => {
    expect(auditEntryStatus({ ok: true })).toBe('ok');
    expect(auditEntryStatus({ ok: false })).toBe('error');
    expect(auditEntryStatus({ ok: false, denied: 'scope' })).toBe('denied');
    expect(auditEntryStatus({})).toBe('unknown');
    // Un `denied` presente gana aunque `ok` falte o sea true.
    expect(auditEntryStatus({ denied: 'scope' })).toBe('denied');
  });

  it('cae a "(sin herramienta)" cuando la línea no trae tool', () => {
    expect(auditEntryTool({ tool: 'diagnostics' })).toBe('diagnostics');
    expect(auditEntryTool({ tool: '  ' })).toBe('(sin herramienta)');
    expect(auditEntryTool({})).toBe('(sin herramienta)');
    expect(auditEntryTool({ tool: 7 } as unknown as McpAuditEntry)).toBe('(sin herramienta)');
  });

  it('formatea ts epoch-ms y rechaza valores inválidos', () => {
    expect(auditEntryTime(1_700_000_000_000)).toMatch(/\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{2}/);
    expect(auditEntryTime(0)).toBe('—');
    expect(auditEntryTime(-5)).toBe('—');
    expect(auditEntryTime('ayer')).toBe('—');
    expect(auditEntryTime(undefined)).toBe('—');
  });

  it('formatea duración en ms o segundos y devuelve null si no vino', () => {
    expect(auditEntryDuration(12)).toBe('12 ms');
    expect(auditEntryDuration(1450)).toBe('1,5 s');
    expect(auditEntryDuration(0)).toBe('0 ms');
    expect(auditEntryDuration(undefined)).toBeNull();
    expect(auditEntryDuration('12')).toBeNull();
    expect(auditEntryDuration(-3)).toBeNull();
  });

  it('resume scopes sólo en entradas rechazadas', () => {
    const denied: McpAuditEntry = {
      ok: false,
      denied: 'scope',
      requiredScope: 'write',
      grantedScopes: ['read', 'audit'],
    };
    expect(auditEntryScopes(denied)).toBe('requiere «write» · concedidos: read, audit');
    expect(auditEntryScopes({ ok: true, requiredScope: 'write' })).toBeNull();
    expect(auditEntryScopes({ denied: 'scope' })).toBeNull();
    expect(
      auditEntryScopes({
        denied: 'scope',
        requiredScope: 'admin',
        grantedScopes: 'no-array',
      } as unknown as McpAuditEntry),
    ).toBe('requiere «admin»');
  });

  it('auditEntriesOf normaliza el tail completo', () => {
    // El JSONL admite cualquier JSON válido por línea: strings y números
    // llegan igual y la UI los normaliza a entradas vacías.
    const tail = {
      entries: [{ tool: 'a', ok: true }, 'basura', 7],
      skipped: 1,
      truncated: false,
    } as unknown as Parameters<typeof auditEntriesOf>[0];
    const entries = auditEntriesOf(tail);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ tool: 'a', ok: true });
    expect(entries[1]).toEqual({});
    expect(auditEntriesOf(null)).toEqual([]);
  });
});
