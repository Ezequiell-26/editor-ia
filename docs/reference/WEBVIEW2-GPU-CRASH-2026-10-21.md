# Ventana negra en Windows: GPU de WebView2 y bundle de producción

Fecha: 2026-10-21. Síntoma reportado: al abrir la app de escritorio la ventana
aparece, pero no muestra ninguna imagen (fondo negro, sin interfaz).

## Causa 1 — el proceso GPU de WebView2 no arranca

La app quedaba viva, con una ventana `Tauri Window` visible y **sin procesos
`msedgewebview2` hijos**. Los volcados de Crashpad en
`%LOCALAPPDATA%\com.editoria.desktop\EBWebView\Crashpad\reports` mostraban:

```
FATAL:content\browser\gpu\gpu_data_manager_impl_private.cc:408]
GPU process isn't usable. Goodbye.
```

La pila confirma el camino intencional de Chromium:
`GpuProcessHost::RecordProcessCrash` → `FallBackToNextGpuMode` →
`IntentionallyCrashBrowserForUnusableGpuProcess`. Es decir: el proceso GPU muere,
Chromium decide cerrar el navegador y la ventana queda negra.

- `--disable-gpu` **no** lo resolvió: el proceso GPU seguía lanzándose (en modo
  software) y volvía a fallar.
- `--in-process-gpu` **sí** lo resolvió: el trabajo de GPU corre dentro del
  proceso del navegador y no hay proceso GPU separado que pueda caerse.

Configuración aplicada en `apps/desktop/src-tauri/tauri.conf.json`, en las dos
ventanas (`main` y `splash`):

```json
"additionalBrowserArgs": "--in-process-gpu"
```

Es una medida de compatibilidad para este equipo (AMD Radeon, driver
31.0.21925.1001, WebView2 155.0.4283.62). Si un driver posterior funciona bien,
se puede quitar y volver a la aceleración por GPU separada.

## Causa 2 — require dinámico de `subsrt` en el bundle

Aun con WebView2 sano, el bundle de producción lanzaba al evaluar el módulo:

```
Could not dynamically require "./format/vtt.js".
Please configure the dynamicRequireTargets ... of @rollup/plugin-commonjs
```

`subsrt` carga sus nueve formatos con `require('./format/' + nombre + '.js')`.
Rollup no puede resolver esa require dinámica y deja una función que lanza. El
entry del paquete nunca debe importarse en el renderer.

Solución: importar el parser SSA/ASS directo, que es autocontenido y no usa
requires dinámicas:

```ts
import ssaFormat from 'subsrt/lib/format/ssa.js';
```

Así se conserva la licencia MIT y el parser, sin el camino que rompe el bundle.

## Causa 3 — perfil bloqueado por procesos huérfanos

Tras varias ejecuciones fallidas quedaron procesos `msedgewebview2` huérfanos
con el perfil abierto. El siguiente intento falló con:

```
HRESULT(0x800700AA): Ya se está usando el recurso solicitado.
```

y, con un perfil recién creado, con:

```
HRESULT(0x80070578): El identificador de la ventana no es válido.
```

Limpieza aplicada:

1. Cerrar la app y todos los `msedgewebview2` cuyo `--user-data-dir` apunte a
   `com.editoria.desktop`.
2. Renombrar `EBWebView` a `EBWebView.bak-<fecha>` para empezar con un perfil
   limpio.
3. Restaurar sólo `Default\Local Storage` desde el respaldo para conservar
   apariencia, perfil y recientes.

## Verificación

- Captura de la ventana con `PrintWindow` (no una suposición): se ve la vista
  Inicio, “Preparación del estudio”, **4/4 herramientas listas** y “Proyectos
  recientes”.
- La app queda con un solo proceso `editor-ia-desktop` y su árbol WebView2.
- `npm run build` y `npx vitest run` siguen limpios (718 pruebas).

## Cómo diagnosticar de nuevo

```powershell
# ¿hay procesos WebView2 del editor?
Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
  Where-Object { $_.CommandLine -match 'com.editoria.desktop' } |
  Select-Object ProcessId, ParentProcessId, CommandLine

# ¿hubo un crash nuevo?
Get-ChildItem "$env:LOCALAPPDATA\com.editoria.desktop\EBWebView\Crashpad\reports" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 3

# analizar el volcado (Windows SDK)
cdb -z <archivo.dmp> -c "!analyze -v; q"
```
