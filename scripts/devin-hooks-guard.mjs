#!/usr/bin/env node
// Hook PreToolUse (matcher: exec) para Editor IA / Olyvia.
// Bloquea comandos destructivos o que violan las reglas del CLAUDE.md del repo.
// Recibe el evento JSON por stdin; sale 2 + JSON {"decision":"block"} para bloquear.
// Sale 0 en cualquier otro caso (nunca rompe la sesión por un fallo del hook).

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input || '{}');
    const command = String(event?.tool_input?.command ?? '');
    if (!command) process.exit(0);

    const rules = [
      {
        pattern: /\bgit\s+push\b[^|;&]*--force|-f\s+origin\b|\bgit\s+push\s+.*\s-f\b/i,
        reason: 'git push --force reescribe historial remoto. Requiere autorización explícita del usuario.',
      },
      {
        pattern: /\bgit\s+reset\s+--hard\b/i,
        reason: 'git reset --hard destruye trabajo sin commitear. Prohibido por CLAUDE.md del proyecto.',
      },
      {
        pattern: /\bgit\s+clean\b/i,
        reason: 'git clean borra archivos no trackeados del usuario. Prohibido por CLAUDE.md del proyecto.',
      },
      {
        pattern: /\bgit\s+checkout\s+--\s|\bgit\s+restore\s+(--worktree\s+)?\.(\s|$)|\bgit\s+restore\s+--staged\b/i,
        reason: 'Este comando descarta cambios sin commitear. Revisá el diff y pedí confirmación al usuario.',
      },
      {
        pattern: /\brm\s+-rf?\s+(\/|~|%USERPROFILE%|[A-Za-z]:\\(?!Users\\ofici\\(QODER-WORK|devin)\\))/i,
        reason: 'rm -rf sobre rutas amplias puede destruir datos. Limitá la limpieza a artefactos creados en la tarea.',
      },
      {
        pattern: /\b(Remove-Item|del|erase)\b[^|;&]*-Recurse[^|;&]*\b(C:\\|D:\\|Users\b)/i,
        reason: 'Borrado recursivo de rutas del sistema/usuario. Prohibido sin autorización explícita.',
      },
      {
        pattern: /\b(npm|pnpm|yarn)\s+(install|i|add)\b/i,
        reason: 'Instalación de dependencias: justificá necesidad y licencia, o pedí confirmación al usuario.',
      },
      {
        pattern: /\bcargo\s+install\b/i,
        reason: 'cargo install de herramientas nuevas requiere justificación. Usá dependencias del Cargo.toml.',
      },
      {
        pattern: /\bgit\s+commit\b[^|;&]*--no-verify\b|\bgit\s+commit\b[^|;&]*-n\b/i,
        reason: 'Bypass de hooks de commit (--no-verify). No permitido.',
      },
    ];

    for (const rule of rules) {
      if (rule.pattern.test(command)) {
        process.stdout.write(
          JSON.stringify({
            decision: 'block',
            reason: `[editor-ia guard] ${rule.reason}\nComando bloqueado: ${command.slice(0, 300)}`,
          })
        );
        process.exit(0);
      }
    }
    process.exit(0);
  } catch {
    process.exit(0); // nunca bloquear por un error del propio hook
  }
});
