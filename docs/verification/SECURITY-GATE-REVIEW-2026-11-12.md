# Revisión de la puerta de seguridad — 2026-11-12

## Alcance y evidencia
Revisión estática de `scripts/security-audit.mjs`, `package.json`, `.github/workflows/verify.yml` y `.github/workflows/windows-package.yml`. No se ejecutaron auditorías de dependencias ni se modificó código de producción.

## Hallazgos

### SEC-GATE-001 — La auditoría solo falla ante vulnerabilidades críticas
- **Prioridad:** P1 (calidad de release).
- **Evidencia:** el script solo establece `failed = true` cuando `counts.critical > 0` para npm y `critical > 0` para Cargo. Los hallazgos `high` se imprimen, pero no bloquean el proceso; `moderate` y `low` tampoco.
- **Impacto:** CI puede terminar con código 0 aunque haya vulnerabilidades altas conocidas en dependencias.
- **Recomendación:** definir una política explícita por entorno: bloquear critical y high en CI/release; permitir excepciones temporales solo con identificador, justificación, propietario y fecha de expiración.

### SEC-GATE-002 — Los fallos de la auditoría se convierten en omisiones exitosas
- **Prioridad:** P1 (falso verde).
- **Evidencia:** los bloques `catch` de npm y Cargo imprimen advertencias y continúan. Si npm audit falla por red, registro, JSON inválido o ejecución, el proceso puede finalizar con `SECURITY-AUDIT: OK (sin críticas)`. Cargo audit además se omite cuando la herramienta no está instalada.
- **Impacto:** un control que no pudo ejecutarse puede confundirse con una auditoría limpia.
- **Recomendación:** separar estados `PASS`, `FAIL` y `SKIPPED`; en CI/release fallar si un escáner obligatorio no pudo ejecutarse. Instalar y fijar cargo-audit en CI en lugar de depender de la máquina.

### SEC-GATE-003 — La auditoría de npm excluye dependencias de desarrollo
- **Prioridad:** P2 (cobertura de cadena de suministro).
- **Evidencia:** el comando es `npm audit --omit=dev --json`.
- **Impacto:** herramientas de build, test, empaquetado y generación de artefactos no se evalúan en esta pasada. Una dependencia vulnerable de desarrollo puede comprometer CI o el proceso de publicación aunque no se incluya en runtime.
- **Recomendación:** ejecutar auditorías separadas para runtime y árbol completo; documentar excepciones por entorno.

### SEC-GATE-004 — La puerta de seguridad no está conectada al workflow CI
- **Prioridad:** P1 (control no aplicado automáticamente).
- **Evidencia:** los workflows `.github/workflows/verify.yml` y `windows-package.yml` ejecutan `npm run verify`, auditoría de licencias, inventario y builds, pero no invocan `npm run audit:security`.
- **Impacto:** aunque el script exista y esté registrado en `package.json`, no protege automáticamente los PR, pushes ni el empaquetado.
- **Recomendación:** integrar un job de seguridad independiente con permisos mínimos, versiones fijadas, caché controlada y política de fallo; no mezclar el resultado de licencias con vulnerabilidades.

## Estado de ejecución
- Revisión estática: completada.
- npm audit: no ejecutado en esta pasada.
- cargo audit: no ejecutado en esta pasada.
- Cambios de código: ninguno.
- CI/release: no modificados.
- Validación dinámica: pendiente.

## Orden recomendado
1. Corregir la semántica de fallo/omisión para eliminar falsos verdes.
2. Definir umbrales y excepciones auditables.
3. Añadir el escaneo completo de npm y fijar cargo-audit en CI.
4. Integrar la puerta en PR y empaquetado.
5. Probar escenarios controlados: vulnerabilidad high, critical, escáner sin red, JSON inválido y herramienta ausente.

### SEC-GATE-005 — Servidor Vite de desarrollo escuchando en todas las interfaces
- **Prioridad:** P2 (exposición de entorno de desarrollo).
- **Evidencia:** proceso Node PID 15972 ejecuta Vite con `--host 0.0.0.0 --port 3000`; `Get-NetTCPConnection` confirmó listener `0.0.0.0:3000`. No se identificó una necesidad de acceso LAN para esta sesión.
- **Impacto:** el servidor de desarrollo queda accesible desde interfaces de red alcanzables, sujeto al firewall. No equivale a un servicio de producción, pero aumenta la superficie de exposición del código y del entorno de desarrollo.
- **Acción:** preferir `127.0.0.1` para tareas locales; si se requiere acceso LAN, limitarlo a una red confiable, revisar reglas de firewall y cerrar el servidor al terminar la sesión autorizada. No se detuvo el proceso porque pertenece al flujo de trabajo activo.
