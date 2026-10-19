# Editor IA — Formato del proyecto (`.editoria.json`)

**Estado:** v1 definida y verificada por tests. El código es la fuente de verdad ejecutable; este documento es el contrato humano.
**Paquete:** `packages/project-schema` (`@editor-ia/project-schema`)
**Artefacto máquina:** `packages/project-schema/schema/project-document.v1.schema.json` (draft-07)
**Fixtures:** `packages/project-schema/fixtures/`

## 1. Qué es este archivo

Un proyecto Editor IA es **un solo archivo JSON** con extensión `.editoria.json` que contiene todo lo necesario para volver a abrir el proyecto, editarlo y renderizarlo. Es la única fuente de verdad del estado creativo.

No pertenece al proyecto, y por lo tanto no puede aparecer en él:

- Claves de proveedor, tokens, cookies ni cualquier credencial (van al almacén seguro del SO).
- Estado de trabajos, colas, logs, reintentos ni rutas de salida temporales (base local pequeña).
- Preferencias de la aplicación (tema, atajos, tamaño de ventana).
- Índices de medios ni cachés de transcripción.

Si un dato no se puede reconstruir a partir de este archivo más los recursos del disco del proyecto, entonces está en el lugar equivocado.

## 2. Reglas transversales

| Regla | Detalle |
| --- | --- |
| Sin carga parcial | Un documento malformado se rechaza con la ruta exacta que falló. Nunca se ignora una entidad rota para "abrir igual". |
| Estricto | Todo objeto del formato rechaza claves desconocidas. Un typo en un campo es un error, no un campo opcional silencioso. |
| Namespace de extensión | Una clave raíz nueva solo se admite bajo prefijo `x-` (ej. `x-experiment`). Cualquier otra clave raíz se rechaza. |
| Prohibición de credenciales | Se recorre todo el documento y se rechaza cualquier clave que coincida con `api_key`, `apikey`, `access_token`, `refresh_token`, `secret`, `password`, `authorization`, `auth_token`, `bearer_token`, `cookie`, `private_key` — aunque esté dentro de `x-`. |
| Ids | `uuid` v4 generado por la aplicación. Los slugs legibles por humanos se rechazan: un id escrito a mano es la forma habitual de romper una referencia. |
| Unicidad | Los ids son únicos **dentro de cada colección** (`assets`, `timeline.tracks`, `timeline.clips`, `scenes`, `motion`, `captions.styles`, `captions.cues`, `renderProfiles`, `exportVariants`, `provenance.*`). Reutilizar un id entre colecciones distintas es válido. |
| Orden | El orden de presentación es un campo (`order` en tracks y escenas), no la posición en el array. Un archivo reordenado sin cambiar `order` significa lo mismo. |
| Duración | Nada se aproxima: si un valor no se puede expresar en frames enteros, el documento es inválido. |

## 3. Tiempo

Todas las posiciones y duraciones son **frames enteros**. No se guardan segundos en coma flotante.

```json
{ "frameRate": { "num": 30000, "den": 1001 } }
```

- `Frame` = entero ≥ 0 ≤ `TOTAL_DURATION_MAX_FRAMES` (5 184 000 = 24 h a 60 fps).
- `Duration` = entero > 0, mismo tope.
- `FrameRate` = racional `{num, den}` con ambos enteros > 0. 29,97 es `{30000, 1001}`, nunca `29.97`.
- Velocidad de clip usa el mismo tipo racional.

**Identidad de timing obligatoria** (clips `video` y `audio`):

```
durationFrames × speed.num = (outFrame − inFrame) × speed.den
```

Sin `speed` se asume `{1, 1}`, así que la duración del clip debe ser exactamente la ventana de origen. Un clip que no satisface la identidad se rechaza; una timeline que se aproxima termina desincronizada al re-muestrear el render.

## 4. Rutas

`ProjectRelativePath` es siempre relativa a la raíz del proyecto y con separador `/`.

Rechazado: vacío, absoluto (`/…`), home (`~…`), letra de unidad (`C:` o `c:/`), UNC (`\\servidor`), barra invertida en cualquier forma, segmento vacío o duplicado, segmento `..`, carácter de control, los reservados de Windows `< > : " | ? *` y terminación en `/`. Máximo 512 caracteres.

Un asset **siempre** tiene una ruta local. No existe la variante "renderizo desde la URL": si el archivo se descargó, primero queda en el proyecto y después es referenciable.

## 5. Entidades

### 5.1 Sobre del documento

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid v4 | |
| `name` | string 1–120 | sin espacios sobrantes |
| `schemaVersion` | `1` | constante, no rango |
| `createdAt`, `updatedAt` | RFC 3339 con offset | `updatedAt` ≥ `createdAt` |
| `revision` | entero ≥ 0 | se incrementa en cada operación aplicada |
| `language` | BCP 47 (`es`, `es-419`) | idioma por defecto del proyecto |
| `video` | VideoSettings | ver abajo |
| `assets`, `timeline`, `captions`, `scenes`, `motion`, `audio`, `renderProfiles`, `exportVariants`, `provenance`, `migrationHistory` | colecciones | todas obligatorias, pueden estar vacías |

`VideoSettings`: `width`, `height` (enteros > 0 ≤ 16384), `frameRate` racional, `backgroundColor` hex opcional, `safeArea {top,right,bottom,left}` opcional en píxeles.

### 5.2 `assets[]` — discriminado por `kind`

`kind` ∈ `video | image | audio | font | text`. Campos comunes: `id`, `label` (1–200), `source`, `status`, `integrity?`, `rights`.

`source` ∈
- `{type:"local", path}`
- `{type:"downloaded", url, path, fetchedAt}`
- `{type:"generated", provider:{id,model}, path, generatedAt, operationId?}`
- `{type:"template", templateId, templateVersion, path}`

`status` ∈ `unverified | ready | missing | failed`.

`integrity` = `{sha256, bytes}` — 64 caracteres hex en minúsculas.

`media` depende del `kind` y **no admite campos de otro kind**:
- `video`: `{width, height, durationFrames, frameRate}`
- `image`: `{width, height}`
- `audio`: `{sampleRate 8k–192k, channels 1–8, durationFrames}`
- `font`, `text`: sin `media` (la clave no debe existir)

`rights.license` = `{id, commercialUse ∈ allowed|requires-attribution|not-for-redistribution|unknown, url?, attributionText?, notes?}`
`rights.provenance` = `{origin ∈ user-imported|downloaded|generated-by-provider|generated-locally|template-default, acquiredAt, sourceUrl?, provider?, termsSnapshot?}`

**Invariables:**
1. `status:"ready"` exige `integrity` presente, `media` medido (en kinds con media) y `commercialUse ≠ unknown`. Un asset sin hash y sin sonda no puede ser "ready": es la regla de no-falsos-positivos aplicada al material.
2. `origin:"downloaded"` exige `sourceUrl`.
3. `status:"missing"` se permite sin `media`: una ruta rota es un estado representable, no un error de archivo.

### 5.3 `timeline.tracks[]`

`kind` ∈ `video | image | audio | narration | caption | graphic`, `label`, `order` (0–63, único), `muted|hidden|locked` (default `false`).

### 5.4 `timeline.clips[]` — discriminado por `kind`

`kind` ∈ `video | image | audio | graphic`. Campos comunes: `id`, `trackId`, `startFrame`, `durationFrames`, `label?`, `transform?`, `audio?`.

`source` ∈
- `{type:"asset", assetId, inFrame, outFrame}` — clips `video` y `audio`
- `{type:"asset", assetId}` — clip `image` (una ventana de origen en una imagen es un error)
- `{type:"graphic", motionId}` — clip `graphic`

`speed` (racional) solo en `video` y `audio`.
`transform` = `{offsetX, offsetY, scaleX, scaleY, rotationDeg, opacity}` todos opcionales; `opacity` en [0,1], `scaleX/Y` > 0.
`audio` = `{gainDb ∈ [−60,12], fadeInFrames, fadeOutFrames}`.

**Invariables:** dos clips del mismo track no se solapan (tocarse en el borde exacto es válido); el `kind` del track debe ser compatible con el del clip (`audio` acepta tracks `audio` y `narration`).

### 5.5 `captions`

`styles[]` = `{id, name, fontFamily, fontSizePx 1–400, color, outlineColor?, position ∈ top|center|bottom}` con color hex (`#rgb`/`#rrggbb`).
`cues[]` = `{id, trackId, styleId?, text 1–500, language, startFrame, endFrame}`.

`endFrame > startFrame`; sin solapamiento dentro de un track; `styleId` debe existir. En el sobre del documento, todo cue debe vivir en un track de `kind:"caption"`.

### 5.6 `scenes[]`

`{id, order (único), title, intent, status, narration, clipIds[], sourceSceneId?, notes?}`

`intent` ∈ `hook | context | explainer | demo | proof | cta | outro`; `status` ∈ `draft | reviewed | approved`.
`narration` = `{text?, voiceProfileId?, assetId?, estimatedDurationFrames?}` y exige `text` o `assetId`.
`clipIds` son referencias; `sourceSceneId` mantiene el linaje cuando una variante deriva de otra escena.

### 5.7 `motion[]`

`{id, template:{id, version, source ∈ bundled|user|downloaded}, props, targetTrackId?}`

`props` es un objeto JSON puro: se rechazan `Date`, funciones, `Symbol`, `bigint`, números no finos o fuera del rango seguro. La validación de `props` contra el contrato de la plantilla ocurre en el renderer, que conoce la `version`; el archivo solo garantiza que es JSON transportable.

### 5.8 `audio`

`{master:{gainDb default 0, limiter default false}, music?, ducking:{enabled default false, amountDb default −12, sourceTrackIds[], targetTrackIds[]}, loudnessTarget?}`

- `music` = `{assetId, gainDb default −18, fadeInFrames?, fadeOutFrames?, loop default false}`
- `loudnessTarget` = `{platform ∈ youtube|shorts|reels|tiktok|podcast|broadcast, integratedLufs ∈ [−33,−9], truePeakDb ∈ [−9,0], toleranceDb ∈ [0,3]}`
- `ducking.enabled` exige al menos un track de origen y uno destino.

El valor medido del stack actual (`−13,8 LUFS`) entra en el rango, y los objetivos de plataforma también.

### 5.9 `renderProfiles[]`

`{id, name (único), container, videoCodec, audioCodec, resolution, frameRate, bitrate, pixelFormat, audioSampleRate, audioChannels, aspectRatio, qualityGate}`

- `container` ∈ `mp4 | mov | webm`; matriz obligatoria: mp4/mov → `h264|h265` + `aac`; webm → `vp9|av1` + `opus`.
- `bitrate` ∈ `{mode:"crf", crf 0–51}` | `{mode:"target", videoBitsPerSecond > 0}`.
- `aspectRatio` ∈ `16:9 | 9:16 | 1:1 | 4:5 | 3:2 | 2:3` y debe coincidir con `resolution` en multiplicación cruzada exacta (`1920×9 = 1080×16`).
- `qualityGate` = `{minOutputBytes > 0, durationToleranceFrames 0–600, requireAllAssetsReady default true}`.

`qualityGate` es la promesa que el worker debe verificar antes de informar `completed`. Un perfil no puede aceptar un archivo de salida vacío.

### 5.10 `exportVariants[]`

`{id, name, renderProfileId, platform ∈ youtube|shorts|reels|tiktok|other, note?}`. La `renderProfileId` debe existir en `renderProfiles`.

### 5.11 `provenance`

Tres colecciones: `sources[]`, `claims[]`, `operations[]`.

`source` = `{id, kind ∈ web|paper|dataset|interview|product-docs|transcript, title, url?, publisher?, accessedAt, reliability ∈ primary|secondary|unverified}`; `kind:"web"` exige `url`.

`claim` = `{id, text 1–1000, status ∈ unverified|verified|contradicted, sourceIds[], sceneId?}`; `verified` y `contradicted` exigen al menos una fuente.

`operation` (la acción de IA como dato reversible) = `{id, role, summary, createdAt, provider?, cost, patch[], expectedRevision, appliedStatus}`

- `role` ∈ `planner | researcher | scriptwriter | asset-scout | editor | motion-designer | audio-subtitle | qa-reviewer | coordinator`
- `patch` = 1–500 operaciones JSON Pointer (RFC 6902) `add | replace | remove`. `add`/`replace` llevan `value` (JSON puro), `remove` **no** puede llevarlo. El path debe empezar por `/`, no puede ser vacío (eso reemplazaría el documento entero) y no puede contener `..`.
- `cost` = `{items:[{kind ∈ tokens|seconds|calls|bytes|images, amount, unitLabel, estimatedUsdCents?}], disclosed, approved}`
- `appliedStatus` ∈ `proposed | applied | reverted | failed`
- Una operación `applied` exige `disclosed:true`; si tuvo costo (`items` no vacío), exige además `approved:true`. Un trabajo pago aplicado sin aprobación es un archivo inválido.

El texto del modelo nunca se ejecuta: se convierte en `patch`, se valida, y recién entonces toca el proyecto.

### 5.12 `migrationHistory[]`

`{fromVersion, toVersion, migratedAt, tool}`. Se agrega una entrada por cada migración aplicada al abrir un archivo de una versión anterior.

## 6. Integridad referencial que valida el sobre

Ninguna entidad puede apuntar a algo que no esté en el archivo:

1. `timeline.clips[].source.assetId` → existe en `assets` y `status` permite renderizar según el `qualityGate`.
2. `timeline.clips[].source.motionId` → existe en `motion`.
3. `motion[].targetTrackId` → existe en `timeline.tracks`.
4. `captions.cues[].trackId` → existe y es `kind:"caption"`.
5. `captions.cues[].styleId` → existe en `captions.styles`.
6. `scenes[].clipIds[]` → existen en `timeline.clips`.
7. `exportVariants[].renderProfileId` → existe en `renderProfiles`.
8. `audio.music.assetId` → existe en `assets`.
9. `audio.ducking.sourceTrackIds` / `targetTrackIds` → existen en `timeline.tracks`.
10. `provenance.claims[].sourceIds` → existen en `provenance.sources`.
11. `provenance.claims[].sceneId` → existe en `scenes`.

## 7. Versionado y compatibilidad

- `schemaVersion` es **constante literal `1`**. Un valor mayor u otro número produce `UNSUPPORTED_SCHEMA_VERSION` con el número real en el mensaje, no cien errores de forma.
- Cambio **aditivo** que los lectores viejos pueden ignorar: va en el namespace `x-` y no forma parte del contrato hasta que se promueve en una versión nueva.
- Cambio **rotura** (campo obligatorio nuevo, cambio de tipo, semántica de tiempo): sube a `2` y exige un migrador con entrada en `migrationHistory`.
- El archivo no guarda "versión mínima lectora"; la regla es simple: un lector solo abre su propia versión.

## 8. API del paquete

```ts
import { createEmptyProject, parseProject, ProjectDocumentSchema, totalProjectDuration } from '@editor-ia/project-schema';

parseProject(JSON.parse(text)); // {ok:true, project} | {ok:false, code, message, issues:[{path,message}]}
createEmptyProject('Proyecto nuevo'); // documento v1 válido, vacío
totalProjectDuration(project); // último frame tocado por clips o cues
```

Códigos de error de `parseProject`: `UNSUPPORTED_SCHEMA_VERSION` | `INVALID_PROJECT`. `issues[]` lleva la ruta punteada y el mensaje para mostrar en la UI.

## 9. Qué el JSON Schema no alcanza a expresar

El artefacto `schema/project-document.v1.schema.json` es **draft-07** — `zod-to-json-schema` 3.24 no emite 2020-12 y pedirlo en silencio devolvía draft-07 igual, así que el documento declara lo que realmente es. Para 2020-12 hay que migrar el paquete a Zod 4 y su `z.toJSONSchema()`.

Además, tres familias de reglas son código, no esquema, y un validador Rust debe implementarlas aparte: la identidad de timing con `speed`, el namespace `x-` con `catchall`, y las once verificaciones de integridad referencial de la sección 6.

Regenerar el artefacto y los fixtures:

```bash
npm run schema:generate
npm run fixtures:write
npm run verify   # typecheck + 228 tests
```

Un test falla si el JSON Schema commiteado difiere del generado, así que no puede quedar desactualizado sin romper CI.
