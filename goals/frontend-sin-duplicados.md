# Goal · Front end de Olyvia sin duplicados y fácil de usar

- **Estado general**: `active`
- **Activado**: 2026-11-06 · modo `/goal` (skill local, bucle con verificación real)
- **Workspace**: `D:\Users\ofici\QODER-WORK\editor-ia`
- **Prompt maestro**: `docs/PROMPT-REESTRUCTURACION-FRONTEND.md`
- **Ciclos**: 0/100

> Nota sobre el motor: el MCP `athena-loops` / `.agentloop/` de la sesión
> anterior quedó en `running:false`, `stop_reason: loop_agent_error`
> (CLI `opencode` exit 1 en el bootstrap, 0 iteraciones). No se reactivó un
> backend roto ni se falsificó su estado. Se activa el objetivo con el
> protocolo del skill `/goal`: bucle directo, misma exigencia de evidencia.

---

## Objetivo

Reestructurar el front end de `apps/desktop` para que cada concepto tenga una
sola fuente de verdad, que la app sea fácil de usar (un único mapa mental, una
puerta por función) y que el código sea fácil de mantener, **sin perder ni una
funcionalidad** y sin tocar el trabajo no confirmado del usuario.

---

## Criterios de aceptación (verificables)

| # | Criterio | Línea base | Meta |
| --- | --- | --- | --- |
| 1 | Design systems activos en `main.tsx` | 9 | 1 |
| 2 | `!important` en CSS | 4.666 | < 200 justificados |
| 3 | Definiciones por token de color | 3–5 | 1 |
| 4 | Registros que enumeran los 33 `ViewId` | 2 (+1 muerto) | 1 |
| 5 | Implementaciones del dominio `auto-edit` | 2 | 1 |
| 6 | Demos con 0 referencias / imports rotos | 8 / 1 | 0 / 0 |
| 7 | Archivos de producción > 1.500 líneas | 13 | 0 sin justificar |
| 8 | Primitivas en `components/ui/` usadas en ≥3 features | 0 | ≥ 6 |
| 9 | `typecheck` / `build` | 0 / 0 | 0 / 0 |
| 10 | Suite serial / e2e | 1 fallo previo / 19·1·4 | sin regresiones nuevas |
| 11 | SSIM 10 estados / contraste AA / `pageOverflow` | sin medir en este goal | ≥ 0,99 / 0 fallos / 0 |
| 12 | Archivos del usuario modificados sin permiso | 0 | 0 |

---

## Plan y estado de tareas

| # | Tarea | Estado | Evidencia |
| --- | --- | --- | --- |
| T1 | Auditoría completa de la app (CSS, componentes, estado, servicios, tests) | `hecha` | 3 relevamientos + métricas verificadas de primera mano (35 CSS / 47.337 líneas / 4.666 `!important` / 486 TS / 142.137 líneas / 13 archivos > 1.500). Ver §3 del prompt maestro. |
| T2 | Diagnóstico de qué está mal | `hecha` | 12 problemas numerados con rutas y números, en §4 del prompt maestro. |
| T3 | Prompt completo y ejecutable | `hecha` | `docs/PROMPT-REESTRUCTURACION-FRONTEND.md` (12 secciones, 6 fases, 12 criterios, comandos de verificación). |
| T4 | Línea base real de typecheck / serial / build / e2e | `hecha` | typecheck **0** · build **0** (14,28 s) · serial 236 archivos con **1 fallo real** (`ProjectHome.test.tsx`, test desfasado «Mi obra») · e2e **19/1/4**, los 4 previos (`.hue-slider`, `input[type=color]`), **0 regresiones**. 8 fallos iniciales de la serial fueron un backtick transitorio en `mcp-catalog.ts:615`, corregido por edición concurrente a las 12:30; re-ejecución 8/9 verde. Logs: `goal-*-baseline.log`, `goal-serial-recheck.log`. |
| T5 | F1 del prompt: primera deduplicación segura y verificada | `hecha` | `components/ui/OptionField.tsx` + test nuevo; 2 consumidores migrados; **−98 líneas** de código duplicado; 1 sola definición; typecheck 0; tests dirigidos **3/3**. Logs: `goal-t5-typecheck.log`, `goal-t5-tests.log`. |
| T6 | F2: un solo conjunto de tokens | `pendiente` | Requiere tocar `appearance.ts` / `theme-palette.ts` (trabajo del usuario) → **confirmación previa**. |
| T7 | F3: cascada `@layer`, retiro de 8 capas legacy | `pendiente` | Requiere tocar `filmora.css` (trabajo del usuario) → **confirmación previa**. |
| T8 | F4: registro único + F3/F4 de unificación | `pendiente` | — |
| T9 | F5: dividir 13 archivos monumentales, unificar `auto-edit` | `pendiente` | — |
| T10 | F6: higiene de build, tests e IPC | `pendiente` | — |
| T11 | Cierre: tabla antes/después, capturas, `git status`, deuda honesta | `pendiente` | — |

---

## Supuestos registrados (decididos, no preguntados)

1. **No se borra ni se sobrescribe trabajo no confirmado del usuario.**
   Hay 59 archivos en `git status`. Las fases F2, F3, F5 y F6 pisan varios de
   ellos; quedan `bloqueadas` hasta confirmación explícita. Se ejecutan antes
   las fases que operan sobre archivos limpios.
2. **Sin commits, push, reset, clean ni instalación de la app en uso.**
3. **El rediseño visual ya ejecutado (Filmora 12) se conserva**: este goal es
   estructural, no estético. Ningún delta visual se acepta sin SSIM.
4. **Los fallos previos documentados no se maquillan**, pero toda regresión
   nueva se corrige antes de avanzar.
5. **Rust / FFmpeg / servicios quedan fuera del alcance.**

---

## Registro de evidencia por ciclo

### Ciclo 1 · 2026-11-06
- Entrada: pedido del usuario ("analizá la app entera, revisá qué está mal,
  creá un prompt completo y activá el modo goal").
- T1/T2/T3 completadas. Sin modificaciones a código de producto: sólo
  documentos nuevos (`docs/PROMPT-REESTRUCTURACION-FRONTEND.md`, este archivo).
- Motor: el MCP `athena-loops` sigue sin reactivarse (backend `opencode`
  roto en el bootstrap). Se usa el bucle directo del skill `/goal`.

### Ciclo 2 · 2026-11-06
- T4: línea base medida. Hallazgo: **edición concurrente** del usuario sobre
  `state/mcp-catalog.ts` durante la corrida; 9 suites fallidas por error de
  transformación, 8 recuperadas al re-ejecutar. Queda 1 fallo real y previo.
- T5: primera deduplicación real. Extracción de `OptionField` a
  `components/ui/`, con test de regresión de 4 casos.
- Error propio detectado y corregido en el mismo ciclo: el test nuevo asumía
  que vaciar el campo restaura el valor; el contrato real confirma `0`
  (`Number('') === 0`). Se fijó el comportamiento heredado en el test y se
  documentó como decisión de UX pendiente, sin cambiar conducta.
- Verificación: `npm run typecheck` = 0 · tests dirigidos 3/3 ·
  `grep function OptionField` = 1 definición.

### Ciclo 3 · 2026-11-06
- Cierre de la línea base: `npx vite build --emptyOutDir=false` = 0 (14,28 s,
  aviso de chunks > 300 kB); `npm run test:e2e` = **19 passed / 1 skipped /
  4 failed**, exactamente los 4 previos (`settings.spec.ts:27`,
  `theme.spec.ts:695/732/806`), 0 regresiones nuevas.
- Sin cambios de código respecto al ciclo 2. Se actualizaron el prompt
  maestro y este estado con los números definitivos.

### Ciclo 4 · 2026-11-06 (invocación formal del skill `/goal`)
- Continuación del bucle: los dos `CutsSection` compartían además
  `speedFactorOf` y `clipLabel` **idénticos**. Se extrajeron a
  `features/editor/clip-display.ts` con nombres inequívocos
  (`clipSpeedFactor`, `clipDisplayName`).
- **Decisión de arquitectura registrada**: NO se unificaron con
  `features/visuals/visuals.ts` ni `state/brain/policies.ts`, que tienen
  funciones homónimas con contratos distintos (etiqueta `kind + id`, búsqueda
  por `clipId`). Mezclarlas cambiaría texto visible del editor. La colisión de
  nombres queda para F5.
- Verificación: typecheck 0 · tests dirigidos **3/3** · 0 helpers duplicados
  en `features/editor/`. Total acumulado de la F1: **−110 líneas** de código
  duplicado, 1 primitiva de UI + 1 módulo de dominio compartidos.
- **Estado del goal**: `active`, T1–T5 hechas, T6–T11 pendientes; T6–T10
  bloqueadas por el supuesto 1 (trabajo no confirmado del usuario).
- Sin cambios sobre trabajo no confirmado del usuario.

---

## Bloqueos que requieren decisión del usuario

1. **F2, F3, F5 y F6 pisan archivos con trabajo no confirmado** (59 en
   `git status`, entre ellos `App.tsx`, `Timeline.tsx`, `theme-palette.ts`,
   `appearance.ts`, `filmora.css`, `mcp-catalog.ts` y Rust). No se tocaron.
   Para continuar hace falta autorización explícita o un commit previo del
   usuario.
2. **Test desfasado** `ProjectHome.test.tsx`: requiere decidir el contrato
   nuevo de navegación tras F1/F2 antes de actualizarlo.
3. **Backend del bucle** `athena-loops` / `opencode`: sigue fallando en el
   bootstrap. El objetivo se ejecuta con bucle directo; no se falsificó el
   estado del run anterior.
