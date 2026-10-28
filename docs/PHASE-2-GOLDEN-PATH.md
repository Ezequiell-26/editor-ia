# Fase 2 — Golden path y estabilidad

Actualizado: 2026-10-28. Feature freeze respetado: no se agregaron módulos
nuevos; se endurecieron los flujos existentes y se cerraron riesgos de
estabilidad y licencias.

## 1. Los tres flujos dorados

### A. Descarga → Auto-edit → Exportación

- `[done]` Después de importar una descarga aparece **Auto-editar** junto a
  “Abrir en Studio” y “Ver en Medios”.
- `[done]` El botón abre `AutoEditView`; esa vista arma el proyecto variante y
  navega al Editor, desde donde se exporta con el flujo existente.
- `[verificado]` Test de integración: descarga simulada → importación →
  “Auto-editar” → Editor automático visible. La exportación del proyecto ya
  está cubierta por los tests del diálogo y del render.
- **Límite honesto:** la corrida con 10 medios reales y una conexión real
  queda para la matriz de beta; los tests usan el servicio simulado.

### B. Short/Reel 9:16 con hook y subtítulos quemados

- `[verificado]` Nuevo test de integración de Creador: elige video, genera
  hook, desmarca 16:9 y 1:1, exporta sólo 9:16 y quema un SRT.
- `[done]` Los tres módulos siguen siendo independientes y no bloquean la UI:
  Hook, Exportar variantes y Quemar subtítulos.
- **Límite honesto:** la transcripción automática a SRT no forma parte de este
  flujo; el usuario elige el subtítulo. Convertirlo en un botón único requiere
  conectar Whisper y queda fuera de la feature freeze.

### C. Procesamiento en lote / Fábrica

- `[verificado]` `batch-factory.test.ts` cubre planificación de variantes,
  generación y ensamblado con ángulos distintos.
- `[done]` La Fábrica maneja errores por variante: si falla un render, conserva
  el proyecto escrito y reporta `renderError` sin abortar el lote completo.
- **Límite honesto:** falta el test de integración de punta a punta con
  imágenes reales y el servicio Tauri real. Es el siguiente ítem de la matriz
  de beta.

## 2. Límites de descarga

- Default **6 simultáneas** (antes 2).
- El campo normal acepta **1–8**, el rango recomendado para conexiones
  domésticas.
- El límite **512** queda detrás del interruptor **Avanzado**; al apagarlo, un
  valor alto se reduce a 8 y se persiste.
- Tests: `queue.test.ts` (default 6 y clamps) + test visual/UI del campo y el
  interruptor en la cola consolidada.
- Verificado en la UI a 1280×720: “Simultáneas 6”, “Avanzado” y la ayuda
  “4–8 simultáneas es el rango recomendado…”.

## 3. Estabilidad y errores

- `[done]` **ViewErrorBoundary**: un error de render en una herramienta ya no
  deja la ventana en blanco; muestra “La herramienta se detuvo”, el mensaje,
  “Reintentar”, “Ir a Inicio” y “Abrir Ajustes”. Se reinicia al cambiar de
  vista. Tests 2/2.
- `[verificado]` La recuperación de proyecto ya detecta automáticamente una
  instantánea de cierre forzado y ofrece restaurarla con un clic; guardar,
  cerrar o descartar limpia la instantánea. No se auto-abre para no pisar una
  sesión nueva sin consentimiento. Test de App existente.
- Los errores de descarga, auto-edit, Fábrica y Creador se muestran en su
  contexto; no hay alerts nativos bloqueantes.

## 4. Auditoría legal

- `[done]` `npm run audit:licenses` falla si Wav2Lip, checkpoints o `.pth`
  entran al bundle base. Resultado actual: **OK, fuera**.
- `[done]` Inventario en [LICENSES.md](LICENSES.md): FFmpeg LGPL-3.0 con aviso,
  yt-dlp Unlicense, ONNX Runtime MIT, Piper MIT, voz CC0.
- `[done]` `THIRD-PARTY-NOTICES.txt` agregado a los recursos del instalador.
- **Blocker legal para la venta:** eSpeak NG es **GPL-3.0**. La DLL está
  incluida con Piper; antes de vender hay que cumplir aviso + oferta de fuente
  o reemplazar el runtime. Wav2Lip queda externo y no comercial.

## 5. Verificación

- Typecheck raíz verde.
- Suite raíz **1356/1356 en 165 archivos**.
- Suite de escritorio **956/956 en 139**.
- `npm run audit:licenses`: OK.
- Revisión visual de la cola con default 6 y control avanzado a 1280×720.
- Sin build, instalación, commit ni push.

## Pendiente para cerrar Fase 2

1. Matriz manual de 10 corridas reales por flujo (A, B y C) con archivos
   reales, midiendo duración, salida y errores.
2. Test de integración de la Fábrica con imágenes reales y servicio Tauri.
3. Decisión legal sobre eSpeak NG antes de la Fase 4.
4. Definir si la recuperación debe auto-abrir en el próximo arranque; hoy se
   ofrece y requiere un clic por seguridad.
