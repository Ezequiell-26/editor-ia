# 2026-11-08 — Reconciliación 9: plantillas de fábrica animadas

## Qué se portó desde main (`b4052c6..d7f49f2`, 1 commit)

`d7f49f2` — `BuiltinEffectSpec` admite keyframes por `paramId`
sanitizadas contra el manifiesto (specs numéricos, frames ≥0, valores
coercionados, easing validado, mínimo 2 claves). Tres recetas nuevas:
«Golpe que se apaga» (shake), «Punch de entrada» (zoom_pulse) y
«Tensión que crece» (tremolo). `EffectTemplates` marca las plantillas
con pistas como «animada».

Los 4 archivos de código se copiaron verbatim desde `git show HEAD:`
(verificados idénticos a la base `b4052c6` salvo EOL). La entrada de la
cola se insertó al tope; `LEDGER.json` de main no se porta por
convención.

## Incidente y corrección

En la primera inserción de la entrada de cola usé un rango de líneas
de main que incluía las 3 entradas ya portadas en la reconciliación 8
→ quedaron duplicadas. Se detectó con `grep -n` y se reconstruyó el
archivo quedando cada entrada una sola vez (verificado: Isolate bidi,
Aviso mate y Velocidad aparecen una vez cada una).

## Verificación

- `npm run typecheck` (apps/desktop): 0 errores.
- vitest: `builtin-effect-templates.test.ts` 8/8,
  `EffectTemplates.test.tsx` 7/7 (el stderr de jsdom «navigation» es
  ruido conocido del test de importación, no un fallo).
