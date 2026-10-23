# Rendimiento — ronda 2026-10-22

Mediciones tomadas en esta máquina (Windows, AMD Radeon integrada, WebView2
155.0.4283.62). Cada cambio es verificable: los números salen del build real, no
de una estimación.

## Bundle de arranque

| Métrica | Antes | Después |
| --- | --- | --- |
| Chunk principal (`main-*.js`) | 532.180 B | **506.430 B** (−25.750 B, −4,8 %) |
| Chunk principal (gzip) | 158,35 kB | **147,83 kB** |
| Chunks totales | 24 | 26 (motor de búsqueda y compresor aparte) |

Dos dependancias salieron del camino crítico con `import()` dinámico:

- **MiniSearch** (`minisearch`, ~26 kB): sólo se descarga cuando se abre la
  paleta `Ctrl+K`. Además se *precalienta* en un `requestIdleCallback` después
  del arranque, así la primera búsqueda no espera la descarga.
- **fflate** (`fflate`): sólo se descarga cuando el usuario pide el paquete de
  entrega `.zip`.

El resto del chunk principal sigue siendo React, el store y el esquema del
proyecto (Zod), que se usan en la primera pantalla.

## Cambio de herramienta sin espera (2026-10-23)

El síntoma reportado era concreto: al abrir otra herramienta aparecía
"Cargando herramienta…" y la vista tardaba. La causa era que cada vista es un
chunk `lazy()` que se descargaba y evaluaba **en el clic**.

Ahora cada vista tiene su cargador declarado y `preloadViews()` los descarga
todos en tiempo ocioso (uno por turno, 90 ms de pausa) apenas arranca la app. El
fallback de `Suspense` ya no muestra texto.

Medición dentro de la página (clic + dos `requestAnimationFrame`, 1440×900):

| Vista | Primera visita | Revisita |
| --- | --- | --- |
| Director | 13,8 ms | — |
| Producción | 16,6 ms | — |
| Editor | 21,4 ms | 11,2 ms |
| Medios | 43,9 ms | 16,0 ms |
| Ajustes | 27,7 ms | 28,7 ms |
| Inicio | 24,5 ms | — |

Ninguna visita mostró el cartel de carga. Se evaluó además mantener las vistas
montadas (keep-alive); se descartó porque conserva temporizadores y audio de
vistas ocultas y rompe el contrato de la suite. La precarga logra el mismo
tiempo sin ese riesgo.

## E/S y procesos

- **Miniaturas con cupo**: cada miniatura lanza un FFmpeg. Con una biblioteca de
  cientos de medios eso eran cientos de procesos simultáneos peleando por CPU y
  disco. Ahora `useThumbnail` pasa por una cola con **máximo 4 trabajos
  simultáneos** (`withThumbnailSlot`), con prueba que verifica el pico.
- **Waveforms**: ya venían con deduplicado por URL, caché en memoria y caché
  persistente por SHA-256; se mantienen igual.
- **Autoguardado**: confirmado con *debounce* de 1.400 ms; no serializa el
  proyecto en cada tecla.
- **Búsqueda**: el índice se construye al abrir la paleta, no en cada edición, y
  la recolección de documentos es O(n) sobre el documento ya validado.

## Camino nativo

- **Lote en una sola llamada IPC**: `convert_media_batch` procesa la cola en
  Rust y devuelve un resultado por ítem, en lugar de idas y vueltas por archivo.
  El progreso viaja por el evento `convert-progress`.
- **Escritura atómica**: temporal + `rename` por archivo, sin dejar basura si
  FFmpeg falla.
- **Un FFmpeg por ítem**, secuencial, para no saturar la máquina (misma regla que
  el render).

## Verificación

- `npm run typecheck`: limpio.
- `npx vitest run`: **726 pruebas en 74 archivos**, 0 fallos (incluye 4 nuevas de
  la cola de miniaturas y 9 de la vista de conversión).
- `cargo test -p editor-ia-desktop --offline`: 0 fallos.
- `npm run build` y `npm run tauri:build`: correctos.

## Lo que queda para una próxima pasada

1. Virtualizar la biblioteca de medios y la timeline con scroll propio
   (`@tanstack/react-virtual`, MIT) cuando se pueda verificar en pantalla.
2. Dividir el contexto del store (datos del proyecto vs. estado de interfaz)
   para que un cambio de selección no re-renderice todo el árbol.
3. Mover Zod y el esquema a un chunk aparte si la primera pantalla deja de
   necesitarlos.
