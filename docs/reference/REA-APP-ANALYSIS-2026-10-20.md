# Análisis REA de aplicaciones de referencia — 2026-10-20

Herramienta: **REA CLI 6.4.0** (`D:\Users\ofici\MCPs\rea-global\rea`), proveedor
Ghidra 12.1.4. Los resultados crudos quedaron en este mismo directorio.

## CapCut — análisis completado

- Objetivo: `D:\Users\ofici\_Migrado_de_C\AppData\Local\CapCut\Apps\CapCut.exe`
  (el acceso `C:\Users\ofici\AppData\Local\CapCut\Apps` es un junction; REA falla
  con `ERR_REA_WINDOWS_NATIVE` si se le pasa la ruta con el componente reparse).
- SHA-256: `33418526a93188ee01285803217a13ae9f5dcac576986ffdbd66ab2258a27f8f`
- Formato: PE x86_64. Segmentos principales: `.text` 3 227 136 bytes,
  `.rdata` 1 307 648 bytes, `.data` 98 144 bytes.
- Evidence ID del overview: `ev_696669bce21e731442b8a1b6acd32cbf0d742ea1278ad2db98d6b6de2e6cbf9f`
- Búsqueda de cadenas `(transition|keyframe|speed ramp|title)`:
  Evidence ID `ev_e3b09e4658d711698a5d032d355457988cd24968f708a9e1fd4a4fddbb79b13d`.
  Los resultados fueron nombres de APIs de Windows
  (`IApplicationViewTitleBar`, `IBooleanKeyFrameAnimation`,
  `IColorKeyFrameAnimation`, `IKeyFrameAnimation`), **no** cadenas funcionales de
  CapCut. No se usa esta búsqueda para afirmar paridad de transiciones o títulos.
- Archivos: `rea-capcut-2026-10-20.json`,
  `rea-capcut-strings-2026-10-20.json`, snapshot `capcut.rea-snapshot`.

## DaVinci Resolve — sin evidencia utilizable

- Objetivo: `D:\Resolve.exe`.
- `rea analyze` superó los **330 s** y devolvió `provider_timeout`
  (`details.operation = list_documents`, `timeout_ms = 330000`, retryable).
- No se extrajo ningún hallazgo de Resolve en esta pasada y no se cita como
  evidencia.

## Qué se usó y qué no

La matriz de paridad sigue siendo
[`EDITOR-PARITY-MATRIX-2026-10-19.md`](EDITOR-PARITY-MATRIX-2026-10-19.md), basada
en el inventario previo de artefactos instalados. En este pase REA confirmó el
formato y tamaño del binario de CapCut y produjo un snapshot de strings, pero no
aportó una lista funcional nueva. Por eso las decisiones de implementación se
apoyaron en el código y los tests del proyecto, no en una suposición sobre REA.

Implementado en este pase y verificado con tests/render:

- montaje automático con video generado, estiramiento hasta 2× y respaldo por
  imagen;
- keyframes de transformación (escala, desplazamiento, rotación) y ganancia, con
  UI, preview y render FFmpeg real;
- disolvencia de entrada superpuesta y títulos en pista propia;
- autopiloto guion → voz → Flow opcional → montaje → proyecto → MP4 con cola
  persistente y reanudación de render;
- metadatos de publicación sugeridos y capítulos.

No implementado todavía: opacidad animada, speed ramps, LUTs `.cube`, máscaras,
qualifiers, multicam, smart reframe, matting por IA, biblioteca de música/SFX/
B-roll, publicación o programación en redes. Flow real sigue sin verificarse
porque el perfil de Chrome no tenía sesión de Google ni créditos.

> Actualización posterior: se analizó CapCut **9.4.0.4015** y se extrajeron 184
> tipos de keyframe y 52 flags. El inventario vigente está en
> [`CAPCUT-9.4-FEATURE-INVENTORY-2026-10-20.md`](CAPCUT-9.4-FEATURE-INVENTORY-2026-10-20.md);
> en ese pase se implementaron easing/opacidad, reverse, voice effects,
> animaciones de texto, transiciones extra, rampa de 3 tramos y LUT `.cube`.
