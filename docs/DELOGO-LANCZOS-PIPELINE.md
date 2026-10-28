# Hook post-descarga: delogo, Lanczos y HEVC

Fecha: 2026-10-27. Implementado en
`apps/desktop/src-tauri/src/commands/downloader.rs` y
`pipeline_profile.rs`; UI en `apps/desktop/src/features/download/DownloadView.tsx`.

## Cadena única

```
yt-dlp 100 %
  └─ process_video (un solo proceso FFmpeg, sin archivos intermedios)
       ├─ hqdn3d                      denoise espacial + temporal
       ├─ delogo                      parche proporcional en la esquina
       ├─ scale + pad (Lanczos)       sólo si el origen < objetivo
       ├─ setpts=PTS/0.98             0,98×
       ├─ minterpolate / fps=60       60 fps reales
       ├─ eq                           gamma, contraste, saturación
       ├─ scale/crop 4 %              zoom con foco por tercios
       ├─ hflip                       espejo
       ├─ noise=alls=8:allf=t+u       grano 35 mm
       ├─ audio                       voz Piper, banda, 1,02×+ruido o audio limpio
       └─ libx265 / hevc_*            H.265 CRF/CQ 23–24 + tag hvc1
  └─ MD5 + SHA-256 → mover a Videos descargados → limpiar caché
```

En videos de más de 60 s se omite `minterpolate` y el grano; si hay
upscaling se conserva `hqdn3d` antes del Lanczos. El resto del hook es igual.

## Delogo: coordenadas calculadas, no `main_w`

FFmpeg **no** acepta `main_w`/`main_h` dentro de `x`/`y` de `delogo`
(probado con FFmpeg 9.0: `Undefined constant ... 'main_w-160'`). Por eso el
parche se resuelve una vez en Rust con las dimensiones reales de FFprobe:

```rust
// 1920×1080 → x=1760, y=20, w=140, h=50 (equivalente a main_w-160)
let rect = delogo_rect(width, height, "top-right")?;
// delogo=x=1760:y=20:w=140:h=50
```

Proporciones: 140/1920 de ancho, 50/1080 de alto, margen 20/1920 y 20/1080,
con mínimos de 16 px y recorte para que el parche nunca salga del cuadro.
Esquinas: `top-right`, `top-left`, `bottom-right`, `bottom-left`.

El delogo va **antes** del zoom del 4 %: el parche limpia la marca y el
recorte posterior elimina cualquier residuo que quede en el margen de
seguridad.

## Escalado Lanczos

Objetivo automático:

- corto (≤60 s): 1920×1080; vertical: 1080×1920.
- largo (>60 s): 3840×2160; vertical: 2160×3840.
- `1080` o `2160` fuerzan el objetivo.
- Nunca reduce: si el origen ya alcanza el objetivo, no se inserta `scale`.
- `force_original_aspect_ratio=decrease` + `pad` evita deformar; el contenido
  conserva su relación y se proyecta con barras negras si hace falta.
- El zoom 4 % usa dimensiones explícitas para que el resultado final sea
  exactamente 1920×1080 o 3840×2160, sin perder 2 px por el redondeo par.

```text
scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,
pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black
```

Se usa `scale` de CPU con `flags=lanczos`. `scale_cuda` exigiría subir las
frames a memoria CUDA y bajarlas para `delogo`, `eq`, `noise` y `minterpolate`,
lo que rompe la pasada única y agrega copias. La aceleración por hardware se
aplica al **encoder** HEVC. Si en el futuro se hace una cadena 100 % GPU, el
equivalente sería:

```text
hwupload,scale_cuda=1920:1080:interp_algo=lanczos,hwdownload,format=nv12
```

No se activa porque `delogo` y el grano no tienen versión CUDA en este
pipeline; queda documentado, no simulado.

## Encoders H.265

Perfil elegido con probe real (`-encoders` + encode de prueba):

| Perfil | Encoder | Args |
|---|---|---|
| NVIDIA | `hevc_nvenc` | `-preset p3 -cq 23 -tune ll`, decode `-hwaccel cuda` |
| AMD | `hevc_amf` | `-quality speed -rc cqp -qp_i 23 -qp_p 23` |
| Intel | `hevc_qsv` | `-preset fast -global_quality 23` |
| CPU | `libx265` | `-preset ultrafast -crf 23` (`24` con RAM ≤9 GB) |
| Look manual | `libx265` | `-preset fast -crf 22` |

Todos agregan `-tag:v hvc1` para compatibilidad MP4. Si el equipo sólo tiene
encoder H.264 por hardware, se prefiere x265 CPU: el asset final siempre es
H.265.

## Comando reproducible

```powershell
ffmpeg -hide_banner -v error -y -hwaccel cuda -i entrada.mp4 -i voz.wav `
  -filter_complex "[0:v]hqdn3d=1.86:1.39:2.80:2.15,delogo=x=1760:y=20:w=140:h=50,scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setpts=PTS/0.98,minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:vsbmc=1,eq=gamma=0.95:contrast=1.08:saturation=1.12,scale=1996:1122,crop=1920:1080:(iw-ow)*0.5:(ih-oh)*0.5,hflip,noise=alls=8:allf=t+u,format=yuv420p[v];[1:a]loudnorm=I=-14:TP=-1.5:LRA=11,apad[a]" `
  -map "[v]" -map "[a]" -c:v hevc_nvenc -preset p3 -cq 23 -tune ll -tag:v hvc1 `
  -c:a aac -b:a 192k -pix_fmt yuv420p -r 60 -movflags +faststart salida.mp4
```

Sin GPU, reemplazar el bloque de encoder por:

```text
-c:v libx265 -preset ultrafast -crf 23 -threads 0 -tag:v hvc1
```

## Verificación real

- `delogo_and_lanczos_live_optional`: video 320×180 con logo blanco; YMAX de la
  zona del logo **242 → 88** después del parche, salida exacta **1920×1080**,
  códec **hevc**, MD5/SHA-256 de 32/64 hex.
- `cinematic_render_live_optional`: look completo, pipeline automático,
  ruta larga simulada, voz Piper y watermark; HEVC confirmado por FFprobe.
- 5 unitarios de delogo/upscale/orden y 5 del mapeo de ruta en el frontend.
- Suite completa **1299/1299 en 157 archivos** en 186,70 s.
- Instalador **256.175.368 B** SHA-256 `9CC185B1…4F77DF`, firma válida;
  ejecutable instalado **77.885.920 B** SHA-256 `80406247…01B579`, PID 25000.
  El asset `main-5wWzMphb.js` embebido referencia `DownloadView-DYF0AvxY.js`,
  que contiene los controles de logo y Lanczos.

## Límites

- El parche es estático: no detecta logos ni sigue movimientos; si no hay logo
  en la esquina elegida, difumina contenido real.
- En resoluciones muy chicas el parche se reduce a 16 px; puede no cubrir una
  marca grande.
- El 4K en videos largos cuadruplica píxeles y puede tardar mucho en CPU.
- `delogo` interpola desde el borde del rectángulo; una marca que toque el
  borde exacto del cuadro no se puede reconstruir por completo.
- La cola persistente con pausa/reanudación/aborto sigue pendiente.
