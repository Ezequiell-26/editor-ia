# E2E: montaje automático y export real — 2026-10-19

**Aplicación:** Editor IA, binario debug compilado desde el árbol actual
(`target\debug\editor-ia-desktop.exe`) contra Vite en `http://localhost:5173`.
El binario debug usa `devUrl`; el build de release embebe `dist/`.
**Proyecto:** `D:\Users\ofici\QODER-WORK\editor-ia-demo-assets\demo-full.editoria.json`
(“Demo completa”, 6 escenas, 2 imágenes, 2 videos).
**Respaldo previo:** `demo-full.before-autoedit.editoria.json` (14.851 bytes, copia
del proyecto antes del montaje).

## Pasos ejecutados en la app real

1. Abrir el proyecto desde **Proyectos → Abrir proyecto…**.
2. Ir a **Producción**.
3. Voz local: **Microsoft Sabina Desktop · es-MX**.
4. Marcar “Generar narración para las 6 escenas sin audio” y confirmar los
   derechos de la voz.
5. **Generar video automático**.
6. Al terminar, **Abrir editor para exportar**, que abrió el diálogo de render
   automáticamente (solicitud de exportación del store).
7. Exportar con perfil YouTube 1080p, subtítulos quemados, destino
   `D:\Users\ofici\QODER-WORK\editor-ia-demo-assets\demo-autoedit.mp4`.

## Resultado medido

- La app informó: **“Video montado: 6 escenas en 0:00:34:01”**.
- La timeline quedó con:
  - **Narración (NAR)**: 6 clips de audio SAPI, en 0:00:00:00, 0:00:02:24,
    0:00:08:28, 0:00:14:13, 0:00:20:25 y 0:00:27:05.
  - **Imágenes (I1)**: 6 clips, alternando las 2 imágenes disponibles; se
    repitieron 4 porque hay más escenas que imágenes.
  - **Subtítulos (C1)**: 8 cues.
  - **Video (V1)**: vacío; los 2 videos quedaron en la biblioteca y el montaje
    automático no los usó.
  - Duración total: **1021 frames = 34,033 s**.
- `provenance.operations` registró:
  `editor · Montaje automático: 6 escena(s), 6 imagen(es), 8 subtítulo(s)`.
- Aviso mostrado: “Se repitieron 4 imagen(es) porque hay más escenas que imágenes
  disponibles”. Después de esta corrida se agregó además el aviso de videos no
  montados; el código actual informa “2 video(s) quedaron en la biblioteca: el
  montaje automático sólo usa imágenes”, aunque la captura grabada no lo muestra.
- El proyecto se guardó (estado “Guardado”) y el export usó el archivo en disco.

## Export verificado con FFprobe

| Campo | Valor |
| --- | --- |
| Archivo | `D:\Users\ofici\QODER-WORK\editor-ia-demo-assets\demo-autoedit.mp4` |
| Bytes | **868.615** (la UI mostró 848,3 KB) |
| Duración | **34,033333 s** |
| Video | H.264, 1920×1080, 30/1 fps |
| Audio | AAC, 48 kHz, 2 canales |
| Tiempo de render | 11,9 s de proceso |
| Subtítulos | Quemados con libass; 8 cues |

Frames extraídos y revisados:

- `autoedit-frame-5s.png`: imagen de fondo (card verde oscuro) y subtítulo
  “¿Y si pudieras resolver esto en minutos en lugar de horas?”.
- `autoedit-frame-17s.png`: imagen de fondo y subtítulo “El flujo es simple:
  describís el objetivo, revisás el plan y ajustás lo que quieras.”.

Los “cards” del proyecto de demo son imágenes de color sólido; por eso el fondo
se ve liso. El subtítulo y la duración coinciden con la escena.

## Límites de esta prueba

- La app se ejecutó en **modo debug con Vite** porque el binario debug apunta a
  `http://localhost:5173`. Después de esta prueba se compiló el release con
  `--features tauri/custom-protocol`, se regeneró el instalador NSIS y se verificó
  que la ventana release abre `http://tauri.localhost/` con la UI embebida.
- El montaje usa **TTS local por escena** y subtítulos por duración de audio. No
  ejecuta CLIP ni faster-whisper, y no hace alineación forzada palabra-imagen.
- Los videos del proyecto no se montan automáticamente; sólo se usan imágenes
  confirmadas. Se repiten si hay más escenas que imágenes.
- El export sigue siendo explícito: el usuario elige perfil y destino. No hay
  publicación automática.
- El proyecto de demo quedó modificado (con 6 audios nuevos y la timeline
  automática); el respaldo previo está en el mismo directorio.

## Reproducir

```powershell
# Terminal 1: frontend que espera el binario debug
npm run dev

# Terminal 2: binario debug ya compilado
target\debug\editor-ia-desktop.exe
```

Abrir `demo-full.editoria.json`, ir a Producción, confirmar la voz y generar.
