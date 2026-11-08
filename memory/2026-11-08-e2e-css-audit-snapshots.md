# 2026-11-08 — Suite e2e completa + snapshots css-audit commiteados

## Contexto

Pasada de verificación e2e (Playwright, Chrome del sistema, `localhost:3000`)
tras la reconciliación 12. Main sin commits nuevos.

## Resultado

- `playwright test`: 37 tests → **23 passed / 1 skipped / 13 failed**.
- Los 13 fallos eran todos `e2e/css-audit.spec.ts`: el spec se commiteó en
  `e2054c7` pero sus snapshots PNG nunca se versionaron (carpeta generada al
  correr, untracked). Playwright escribe el «actual» como snapshot nuevo en
  la primera corrida y falla — comportamiento esperado sin baseline.
- El spec se declaraba «auditoría temporal, NO commitear»: contracción entre
  la intención original y el estado del repo.

## Resolución

Los 13 snapshots (856 KB, `chrome-win32`, `maxDiffPixelRatio: 0`) generados
contra el CSS spliteado actual quedaron **commiteados** y el spec pasó a ser
regresión pixel permanente de las 13 vistas navegables. Header del spec
actualizado con instrucción de regeneración (`--update-snapshots` + revisar
diff de imágenes).

Re-corrida: **13/13 css-audit verde**. Estado e2e final: 36/37 + 1 skip
intencional documentado (`lottie.spec.ts` — sin proyecto/servicio en modo
navegador; cobertura en `LottiePanel.test.tsx`).

## Lección

`toHaveScreenshot` sin snapshots commiteados falla siempre en checkout
limpio. Si un spec de screenshot se commitea, los snapshots van en el mismo
commit o el spec no sirve como regresión.

## Límite honesto

Snapshots específicos de `chrome-win32` + Chrome del sistema; en otro
entorno pueden requerir regeneración. Sub-vistas internas del editor sin
cobertura e2e (requieren proyecto+backend).
