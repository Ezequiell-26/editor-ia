# Distribución y actualizaciones — 2026-10-26

**Alcance:** diseño (cero código) de la firma pública del instalador Windows con
sello de tiempo, el canal de actualizaciones y el onboarding de motores externos
fuera del instalador con verificación de modelos por hash. Responde a los
puntos **P4 #14** («Firma pública con sello de tiempo y estrategia de
actualizaciones») y **P4 #15** («Motores/IA externos fuera del instalador:
onboarding claro y verificación de modelos por hash») de `docs/AUDIT.md:116-118`.
El punto #16 (precisión Bézier del export) queda fuera de este documento.

**Estado de la firma medido en esta sesión** (no tomado de documentos): el
instalador actual `target\release\bundle\nsis\Olyvia_0.1.0_x64-setup.exe`
(239.580.312 bytes, build del 2026-10-25 22:31) firmado con
`Get-AuthenticodeSignature` da **Status: Valid** («Firma comprobada»),
firmante `CN=Editor IA (Self-Signed), O=Editor IA`, thumbprint
`58204858E163CE7DA173DB8AB09CD9B8359C3954`, vence **2028-10-23**, y
**TimeStamper vacío**: no hay sello de tiempo. Lo mismo para el exe instalado
en `%LOCALAPPDATA%\Olyvia\editor-ia-desktop.exe` (también firmado por Tauri,
también sin sello). «Valid» aquí significa sólo que la raíz self-signed está
instalada en el almacén de **esta** máquina; en la máquina de un usuario el
mismo archivo figura como editor desconocido.

## 1. Estado actual del árbol (verificado)

### 1.1 Firma

- `apps/desktop/src-tauri/tauri.conf.json` (bloque `bundle.windows`):
  `certificateThumbprint: "58204858E163CE7DA173DB8AB09CD9B8359C3954"`,
  `digestAlgorithm: "sha256"`, **`tsp: false`** y sin `timestampUrl`: la
  configuración actual no pide sello de tiempo a ningún servidor TSA, y la
  medición de arriba lo confirma. `installMode: "currentUser"` (sin UAC).
- La clave pública del cert está en la raíz del repo
  (`editor-ia-selfsigned.cer`): el flujo hoy es «instalar mi propia raíz para
  confiar en mi propia build», válido para desarrollo, no para distribución.
- `docs/AUDIT.md:13-14` ya registraba «firma local válida… pendiente
  re-empaquetar con este ciclo»; el número de bytes de esa línea
  (218.731.520) corresponde a la build anterior: el instalador actual pesa
  239.580.312 bytes.
- Tauri firma el instalador **y** los binarios de la app (verificado con el
  exe instalado); no hace falta firmar a mano nada adicional.

### 1.2 Actualizaciones

> Actualización 2026-10-27: el simulacro descrito en esta sección **ya no
> existe**. Se eliminó `updater-service.ts` (releases ficticias, latencia y
> descarga simuladas) y la ventana ahora informa «sin canal configurado»;
> ver «Lote actualizador honesto» en `docs/IMPROVEMENT-QUEUE.md`. El resto de
> esta sección queda como registro del estado previo y del diseño propuesto.

- El «updater» actual es **un simulacro completo**:
  `apps/desktop/src/features/updater/updater-service.ts` declara
  `AVAILABLE_RELEASES` hardcodeado (líneas 46-75, versiones 0.2.0 y
  0.3.0-beta.1 ficticias), `checkForUpdates()` sólo espera 800 ms y compara
  semver contra esa tabla (líneas 140-160), y `CURRENT_APP_VERSION` está
  fija a `'0.1.0'` (línea 39). `AppUpdaterModal.tsx` tiene la UX ya armada —
  píldoras de canal Estable/Beta (líneas 172-186), progreso de descarga,
  «¡Actualización descargada y verificada!» — pero nada toca la red ni el
  disco.
- No hay plugin de updater en Rust: `apps/desktop/src-tauri/Cargo.toml:31-32`
  sólo declara `tauri-plugin-dialog` y `tauri-plugin-opener`. La config no
  tiene sección `plugins` ni `createUpdaterArtifacts`.
- Lo que hoy sí actualiza la app es `scripts/actualizar-olyvia.ps1` (doble
  clic desde `Actualizar Olyvia.cmd`): compila y **copia el exe sobre la
  instalación** `%LOCALAPPDATA%\Olyvia\` en la máquina de desarrollo. Es un
  atajo de desarrollo, no un canal de distribución.

### 1.3 Motores externos: la arquitectura ya existe en tres capas

1. **Empotrado en el instalador** (`bundle.resources` de
   `tauri.conf.json`): `ffmpeg.exe` (105.431.112 B), `ffprobe.exe`
   (105.228.360 B), 7 DLLs de FFmpeg (~156,5 MB con `avcodec-63.dll` de
   91,1 MB a la cabeza), `yt-dlp.exe` (17.887.352 B) y `onnxruntime.dll`
   (12.418.080 B). ONNX Runtime **no** es un motor externo para el usuario:
   ya va dentro del instalador.
2. **Modelos locales gestionados por la app, con hash verificado** — el
   patrón que P4 #15 pide extender ya funciona para los modelos in-app en
   `apps/desktop/src-tauri/src/commands/models.rs`: catálogo estático `MODELS`
   (líneas 56-116) con `u2netp`, `real-esrgan-x4plus` y `seeta-face`, cada uno
   con URL de origen, **SHA-256 fijado**, bytes exactos y **licencia del
   peso**; `download_file_verified` (líneas 361-461) baja por streaming, calcula
   el hash sobre el stream, compara contra el fijado y **descarta el archivo
   si no coincide** (líneas 446-456); `verify_model_hash` (líneas 152-169)
   re-verifica modelos ya instalados antes de cargar pesos; `download_model`
   emite progreso por evento `model-download` (líneas 509-513). La UI vive en
   `apps/desktop/src/features/settings/CapabilitiesCard.tsx`.
3. **Motores loopback que el usuario ya tiene**: la app no incluye esos pesos
   ni runtimes:
   - Ollama/LM Studio como proveedor OpenAI-compatible local
     (`commands/providers.rs:132`, puerto 11434; validación anti-SSRF con
     test incluido en las líneas 1092-1106, que rechaza p. ej.
     `http://127.0.0.1:11434@evil.example`);
   - XTTS API Server / GPT-SoVITS para clonación de voz
     (`commands/voice_clone.rs:1-8`: «La app no incluye un modelo neuronal de
     clonación… ambos por HTTP en loopback… no acepta URLs remotas»);
   - Wav2Lip para lip-sync vía el adaptador `scripts/lipsync-engine/server.py`
     (`commands/lip_sync.rs:1-7`; el adaptador declara `WAV2LIP_DIR`,
     `LIPSYNC_CHECKPOINT` y advierte en sus líneas 18-22 que Wav2Lip es de uso
     **personal/investigación** y que «el adaptador no descarga ni
     redistribuye pesos»).

### 1.4 El onboarding de hoy es texto fino, no un flujo

- `apps/desktop/src/features/localization/LocalizationView.tsx:999`:
  «Requiere XTTS o GPT-SoVITS local» como `fine-print`; selector de motor en
  las líneas 1026-1027; «Wav2Lip (adaptador incluido)» en 1216 y el aviso de
  licencia no comercial en 1257.
- `apps/desktop/src/features/settings/SettingsHome.tsx:321`: «Compatible con
  la API de chat de OpenAI: OpenAI, un endpoint local (Ollama, LM Studio…)».
- `commands/capabilities.rs:53-94` ya mide capacidades y devuelve un **motivo**
  accionable cuando falta algo («Falta descargar el modelo (X MB). Está en
  Ajustes → Capacidades.», líneas 74-79) siguiendo la regla fundacional del
  archivo (líneas 3-7: estado medido, «nunca un botón que rota»).
- Para Ollama/XTTS/Wav2Lip no hay catálogo, ni descarga asistida, ni
  verificación: el usuario tiene que saber por su cuenta qué instalar y de
  dónde. `SECURITY.md:122` deja constancia del principio opuesto al deseado
  para MCP («la app no firma ni audita esos paquetes») — razonable para MCP,
  que ejecuta código de terceros por diseño, pero P4 #15 pide lo contrario
  para los motores de IA: auditar lo que se trae.

### 1.5 Dónde está el peso (para el análisis de actualizaciones delta)

Medido con `ls`/`du` sobre el árbol:

| Componente del paquete | Tamaño (sin comprimir) | Cambia con cada versión de la app |
| --- | --- | --- |
| `editor-ia-desktop.exe` (frontend Vite embebido: 32.848.352 B de `dist`) | 146.394.112 B | Sí, casi siempre |
| `ffmpeg.exe` + `ffprobe.exe` | 210.659.472 B | Casi nunca |
| 7 DLLs de FFmpeg | ~156.491.040 B | Casi nunca |
| `yt-dlp.exe` | 17.887.352 B | Esporádico |
| `onnxruntime.dll` | 12.418.080 B | Casi nunca |
| **Instalador NSIS comprimido resultante** | **239.580.312 B (~228,5 MiB)** | — |

El ~73% del payload sin comprimir son FFmpeg+DLLs+yt-dlp+ONNX Runtime que
cambian poco; ese es el argumento cuantitativo detrás del diseño de fases de
la sección 4.

## 2. Firma pública del instalador con TSA (P4 #14, parte firma)

### 2.1 Por qué el self-signed no sirve para distribución

SmartScreen y los antivirus deciden hoy por **reputación de archivo y firma**
(verificado con fuentes externas, sección 6): un binario con firma válida de
una CA pública arranca sin la pantalla azul «Windows protegió tu PC» una vez
acumulada reputación; uno self-signed la genera **siempre**, en todas las
máquinas que no tengan la raíz instalada. Además, una firma **sin sello de
tiempo** (el estado actual, TimeStamper vacío) queda huérfana cuando el
certificado vence (2028-10-23): Windows pasa a considerarla inválida aunque el
binario no haya cambiado.

### 2.2 Opciones comparadas

| Opción | Costo (orden de magnitud, a cotizar) | Reputación SmartScreen | HSM/token | Encaje con Tauri | Veredicto |
| --- | --- | --- | --- | --- | --- |
| **Self-signed (hoy)** | 0 | Ninguna; advertencia siempre | No | Ya configurado | Sólo desarrollo/QA interno |
| **OV en archivo** (Sectigo, SSL.com, Certum; validación de organización) | ~100–250 USD/año | Se construye con descargas y tiempo; advertencia las primeras semanas | No (PKCS#12 con clave en disco) | `certificateThumbprint` tras importar al almacén de Windows, camino actual intacto | **Recomendada si Trusted Signing no está disponible en la región** |
| **EV con token** (~$250–400/año) | Alto | Ya no garantiza pase instantáneo (reportes 2025-2026: EV firmado igual activa SmartScreen en archivos sin reputación) | Sí, token físico obligatorio | Mismo camino | Sólo si aparece un requisito de tienda/driver que la exija |
| **Trusted Signing (renombrado «Azure Artifact Signing»)** | 9,99 USD/mes Basic (5.000 firmas), 99,99/mes Premium | Firma desde HSM de Microsoft; reputación se acumula igual | Gestionado por Microsoft | No usa thumbprint de almacén: requiere `signCommand` (Tauri lo soporta como comando custom con `%1`) | **Recomendada si la región está soportada** y hay suscripción Azure de pago; verificación de región pendiente |

Notas sobre la tabla: los precios de certificados OV/EV son rangos de mercado
sin cotizar en esta sesión; los de Trusted Signing vienen de fuentes de
enero-2026 (sección 6) y el servicio sigue **restringido por región** — esa
verificación (¿está Argentina soportada?) es una tarea del plan de fases, no
un hecho afirmado aquí.

### 2.3 Sello de tiempo (TSA): diseño concreto

- En `tauri.conf.json`: `tsp: true` + `timestampUrl` apuntando a un servidor
  RFC 3161 público (p. ej. `http://timestamp.digicert.com`). La referencia de
  configuración de Tauri v2 define exactamente esos campos:
  `timestampUrl` («URL of an RFC 3161 / timestamp server») y `tsp`
  (default `false`), más `signCommand` para delegar en una herramienta
  externa. Hoy el repo tiene `tsp: false` y ningún `timestampUrl`.
- Con SHA-256 como digest (ya configurado) el sello RFC 3161 SHA-256 alcanza
  para Windows 10+; no se propone dual-hash SHA-1 salvo que se detecte soporte
  de Windows 7, que el repo no declara.
- El sello **sólo aporta valor con una CA pública**: sobre el cert
  self-signed actual ayuda a la flota interna (donde la raíz está instalada)
  a sobrevivir a la expiración de 2028, pero no cambia nada para un usuario
  final. Por eso la fase del sello y la fase del certificado público van
  juntas en el plan.
- Verificación como parte del empaquetado: tras `package-windows.ps1`
  (`scripts/package-windows.ps1`, que hoy sólo verifica que exista un exe
  >1 MB), exigir con `Get-AuthenticodeSignature` (o `signtool verify /pa /all`)
  que `Status` sea `Valid` **y** que `TimeStamperCertificate` no sea nulo; el
  script falla si falta cualquiera de las dos. Es el mismo espíritu de «no hay
  verde sin instalador real» que ya tiene el script.

### 2.4 Recomendación de firma

1. Mantener el self-signed **sólo** para el ciclo de desarrollo/QA, con nombre
   y documentación que lo digan («firma de desarrollo, no distribuir»).
2. Contratar OV o Trusted Signing según disponibilidad regional (decisión
   externalizable a una tarde de trámites, no un proyecto).
3. Activar `tsp: true` + `timestampUrl` en cuanto haya cert, y verificar
   firma+sello en cada empaquetado.
4. Reputación: esperar acumulación (descargas, edad del archivo); renovar el
   cert **antes** de vencer porque la reputación no se transfiere
   automáticamente al cert nuevo (fuente externa, sección 6).

## 3. Canal de actualizaciones (P4 #14, parte updates)

### 3.1 Opciones comparadas

| Opción | Firma | Delta | Costo de integración | Veredicto |
| --- | --- | --- | --- | --- |
| **`tauri-plugin-updater` (oficial)** | Obligatoria e ineludible: claves `tauri signer generate`, pubkey en `plugins.updater.pubkey`, el binario descargado se verifica contra `.sig` minisign | **No soporta**; baja el bundle completo (verificado en docs v2, sección 6) | Bajo: plugin + config + mover el mock al plugin | **Recomendada** |
| Updater casero (extender el patrón `models.rs` con HTTP propio + firma propia) | A voluntad (misma cripto: sha256 + firma ed25519 del manifiesto) | Sí, se podría implementar por capas | Alto: reinventar descarga con reintentos, progreso, install modes, rollback | Descartada para fase 1; sus ideas vuelven en la fase delta |
| Sin updater (descarga manual desde la web) | La del instalador | — | Ya funciona hoy de facto | Queda como fallback ante endpoint caído |
| Sustituir la UI por el plugin sin mock (borrar `AppUpdaterModal`) | — | — | Bajo, pero se pierde la UX de canales y novedades ya armada | Descartada: la UI existente se conecta, no se tira |

### 3.2 Diseño con el plugin oficial

La documentación de Tauri v2 (sección 6) fija los puntos que el diseño
adopta; todos están verificados contra esa fuente:

- **Artefactos**: `bundle.createUpdaterArtifacts: true` hace que el build NSIS
  genere `Olyvia_0.1.0_x64-setup.exe` (el mismo instalador de siempre, reusado
  por el updater) más `Olyvia_0.1.0_x64-setup.sig`.
- **Claves**: `tauri signer generate` una sola vez; la **pública** va en
  `plugins.updater.pubkey` (queda horneada en cada build; rotarla exige
  publicar una versión que traiga la nueva — el `UpdaterBuilder` de runtime
  soporta rotación, anotado para el runbook de incidentes); la **privada**
  entra al empaquetado por `TAURI_SIGNING_PRIVATE_KEY` (+ password opcional),
  como secreto de CI, nunca en el repo.
- **Endpoint y manifiesto**: `plugins.updater.endpoints` es un **array de
  URLs** con variables `{{current_version}}`, `{{target}}`, `{{arch}}`; ante
  un no-2xx cae al siguiente. El formato estático es un JSON con `version` y
  `platforms["windows-x86_64"].{url,signature}`, donde `signature` es el
  contenido literal del `.sig`. TLS exigido en producción. Un servidor
  dinámico responde `204` cuando no hay nada nuevo. Ejemplo de manifiesto:

  ```json
  {
    "version": "0.2.0",
    "pub_date": "2026-11-05T12:00:00Z",
    "notes": "Resumen de novedades en español…",
    "platforms": {
      "windows-x86_64": {
        "url": "https://…/Olyvia_0.2.0_x64-setup.exe",
        "signature": "<contenido íntegro del .sig>"
      }
    }
  }
  ```

- **Instalación**: en Windows la app sale y el instalador NSIS corre
  silencioso; `plugins.updater.windows.installMode: "passive"` (default
  recomendado) encaja con el `installMode: "currentUser"` ya configurado.
- **Canales**: la UI ya los tiene (`AppUpdaterModal.tsx:172-186`, píldoras
  «Estable»/«Beta», persistidas en `localStorage` con la clave
  `editoria.updater.config.v1` de `updater-service.ts:38`). El diseño los
  mapea a **dos manifiestos estáticos** (`…/stable/latest.json`,
  `…/beta/latest.json`): así el canal es una URL, no lógica extra.
- **Realidad sobre el manifiesto**: el plugin **no verifica una firma del
  manifiesto**; el ancla de seguridad es la firma minisign del binario, y la
  integridad del manifiesto la da el transporte (TLS) más dónde se aloja. Para
  cumplir el «manifiesto firmado» del pedido sin inventar cripto propia, el
  diseño es: alojar el JSON como asset de un **GitHub Release** del repo
  (o archivo committeado en un repo de releases con rama protegida), de modo
  que el manifiesto tenga historia auditable y no sea mutable por un CDN
  comprometido; y documentar que la verificación real de contenido es la del
  `.sig`. Como endurecimiento opcional de una fase posterior, se puede añadir
  una segunda firma del JSON (misma clave minisign) verificada por la app
  antes de llamar al plugin — costo: updater custom parcial; beneficio: defensa
  ante hostiles que controlen el host estático. Se deja como decisión abierta,
  no como fase comprometida.

### 3.3 Actualizaciones delta

**Tauri v2 no las soporta**: el plugin descarga siempre el bundle completo
(verificado en la documentación oficial, sección 6). Con el instalador actual
de ~228,5 MiB por versión, las opciones son:

| Estrategia | Ahorro estimado | Costo | Veredicto |
| --- | --- | --- | --- |
| **Aceptar instalador completo** | 0 | 0 (el plugin ya lo hace) | **Fase 1**: 228 MiB es grande pero tolerable para una app de escritorio |
| **Separar el «paquete de medios»** (ffmpeg+DLLs+yt-dlp+ort, ~73% del payload) en una descarga post-instalación con hash verificado, reusando el mecanismo de `models.rs`; el instalador queda con el núcleo (~146 MB sin comprimir) y las versiones de app cambian sólo eso | Del orden de un tercio a la mitad del peso por update (estimación no medida) | Alto: NSIS con recursos condicionales, primer arranque con red (también ofrecer instalador completo offline), desinstalador consciente de las dos capas | **Fase posterior, con medición previa** — contradice parcialmente la idea de «instalador autosuficiente», así que es una decisión explícita del plan |
| Parches binarios (bsdiff/courgette) sobre el exe | Máximo teórico | Muy alto (generación por par de versiones, verificación, fallback) | Descartada |

La separación por capas tiene un efecto secundario valioso que no es el delta:
los recursos de FFmpeg/yt-dlp pasarían a ser **versionados y verificados por
hash** con el mismo catálogo de `models.rs`, lo que permite actualizar
yt-dlp.exe (que se pudre solo por cambios de los sitios) sin tocar la app.

### 3.4 Recomendación de actualizaciones

Adoptar `tauri-plugin-updater` con claves propias, `createUpdaterArtifacts`,
manifiestos estáticos por canal alojados en GitHub Releases (asset del
release de cada versión), endpoints con fallback (Release + espejo R2/estático
opcional), e instalar en modo `passive`. Migrar `AppUpdaterModal` al plugin
real: `check()` → `downloadAndInstall()` con eventos de progreso; la versión
actual sale de la API de Tauri (`getVersion`), no de la constante
`updater-service.ts:39`; el mock (`AVAILABLE_RELEASES`, el `setTimeout` de
800 ms) se elimina. Para parches de seguridad se define política: el canal
estable publica la versión corregida y el diálogo de la app pasa a
obligatorio por versión crítica (bandera en el manifiesto `notes`/canal — el
plugin no tiene campo `mandatory`, así que la obligatoriedad se resuelve en la
UI leyendo un campo propio del JSON de notas o del endpoint dinámico).

## 4. Onboarding de motores externos (P4 #15)

### 4.1 Principios (ya establecidos en el repo, no inventados)

- Estado **medido**, motivo accionable, «nunca un botón que rota»
  (`commands/capabilities.rs:3-7`).
- Local-first: los motores corren en loopback; la app rechaza URLs remotas
  (`voice_clone.rs`, `providers.rs:1092-1106`).
- Auditoría de pesos: «es una app cerrada de pago, así que el peso se audita
  igual que el código — la licencia del repositorio no cubre automáticamente
  el archivo» (`models.rs:5-6`) y «Pesos de IA sin licencia verificada» están
  descartados en `docs/ROADMAP.md:263`.
- El usuario ejecuta instaladores de terceros bajo su decisión — la app no
  instala software silenciosamente (principio ya escrito para MCP en
  `SECURITY.md:121-122`; aquí se aplica con la diferencia de que **sí** se
  audita por hash lo que la app descarga).

### 4.2 Opciones comparadas

| Opción | Descripción | Veredicto |
| --- | --- | --- |
| **Estado actual+** | Sólo detección y textos con instrucciones | Insuficiente: P4 #15 pide onboarding claro; hoy es un `fine-print` |
| **Wizard «Motores locales» con descarga asistida** (recomendada) | Vista nueva que enumera motores con estado medido, descarga el instalador/pesos oficiales **verificando hash**, guía la instalación (el usuario ejecuta el instalador) y prueba la conexión | Recomendada |
| **Motores embebidos en el instalador** | Bundlar Ollama/XTTS/Wav2Lip | Descartada con motivo: sumarían GB al instalador (Ollama solo ~1 GB con runtime), exigen redistribuir pesos con licencias ajenas (Wav2Lip no comercial, `server.py:18-22`) y contradicen «Motores/IA externos **fuera del instalador**», que es literalmente el enunciado del punto #15 |

### 4.3 Diseño: catálogo de motores con hash

Extender el patrón de `models.rs` a un catálogo de **motores** (`EngineSpec`):
URL oficial de descarga, versión, **SHA-256 del instalador/artefacto**, bytes,
licencia, URL de licencia, cómo se verifican sus modelos, y cómo se prueba la
conexión. La descarga del instalador usa exactamente el mecanismo existente
(`download_file_verified`, `models.rs:361-461`: streaming + SHA-256 + bytes +
descarte si difiere) hacia una carpeta de datos de la app; la ejecución del
instalador es siempre un **acto del usuario** (botón «Abrir instalador…» con
confirmación), nunca un `ShellExecute` silencioso. Estado por motor con los
cuatro valores que la UI ya sabe pintar (no instalado / instalando / listo con
versión / error con motivo).

Detalle por motor (lo verificado del repo primero; los hashes concretos de
cada release de terceros **no están medidos en esta sesión** — poblarlos es
tarea de la fase, igual que se hizo para `MODELS`:

> «Los checksums se fijaron descargando cada archivo una vez y calculando
> SHA-256» — `models.rs:53-55`):

| Motor | Instalación fuera del instalador | Pesos y su verificación | Evidencia actual |
| --- | --- | --- | --- |
| **Ollama** | `winget install Ollama.Ollama` o el zip standalone `ollama-windows-amd64.zip` de GitHub Releases (fuentes sección 6); el catálogo pinnearía versión+hash del zip elegido | Los pesos los baja `ollama pull` dentro de su propio almacén con **digests SHA-256 que Ollama ya expone** en sus manifiestos; la app no re-verifica esos GB: fija modelo+digest en su configuración y muestra el digest al usuario. Smoke test: consulta de prueba | `providers.rs:132,704`; texto en `SettingsHome.tsx:321` |
| **XTTS API Server / GPT-SoVITS** | Proyectos Python de terceros: guía paso a paso por versión (venv, CUDA opcional) + adaptador loopback si hace falta, replicando el patrón de `scripts/lipsync-engine/server.py` | Checkpoints descargables con SHA-256 conocido → mismos `ModelFileSpec` con hash que `MODELS`; donde el motor baja sus propios pesos, verificación «mejor esfuerzo» documentada + prueba de voz real antes de dar la capacidad por lista | `voice_clone.rs:1-8` (contrato y límites ya implementados); aviso en `LocalizationView.tsx:999` |
| **Wav2Lip** | Adaptador incluido (`scripts/lipsync-engine/server.py`), pesos los pone el usuario | **No redistribuir pesos jamás** (licencia no comercial, LRS2). El catálogo exige confirmación de uso aceptable — mismo patrón que la confirmación de derechos de `SECURITY.md:147-149` — y sugiere MuseTalk (MIT) como motor con licencia comercial posible | `lip_sync.rs:1-7`; aviso de licencia en `LocalizationView.tsx:1257` |
| **ONNX Runtime** | Nada: ya viaja en el instalador (`bundle.resources`, `onnxruntime.dll`) | Modelos in-app ya verificados por `models.rs` | `capabilities.rs:82-84` |

### 4.4 Recomendación de onboarding

Una vista «Motores locales» (entrada desde Configuración y desde el motivo de
capacidad desactivada, que ya dice «Está en Ajustes → Capacidades»,
`capabilities.rs:74-79`) con: tarjeta por motor, estado medido, descarga del
artefacto oficial con hash verificado, botón de abrir instalador con
confirmación explícita, «Probar conexión» que llama a los comandos existentes
(`providers.rs`, `voice_clone.rs`, `lip_sync.rs` ya validan y devuelven
errores con mensaje en español), y bloque de licencia del peso visible antes
de instalar (el mismo dato que `MODELS` ya muestra en `ModelInfo`).
Nada de esto sustituye al usuario leyendo la licencia de Wav2Lip: la UI lo
dice explícitamente, como ya lo hace `LocalizationView.tsx:1257`.

## 5. Plan de fases

Orden pensado para que nada bloquee nada y cada fase termine verificada
(regla de trabajo de `docs/ROADMAP.md:281-283`). Cero de este documento es
código; cada fase produce código y verificación propias cuando se ejecute.

- **Fase A — Sello de tiempo + verificación de firma en el empaquetado**
  (pequeña, sin compras): `tsp: true` + `timestampUrl` en `tauri.conf.json`;
  extender `scripts/package-windows.ps1` para fallar si la firma no es `Valid`
  o si falta el TimeStamper; actualizar el dato del instalador en
  `docs/AUDIT.md:13-14` con la build nueva. *Criterio de aceptación*: el
  instalador generado tiene `Status: Valid` y `TimeStamperCertificate`
  presente, medido con `Get-AuthenticodeSignature`.
- **Fase B — Certificado público** (decisión de compra/región, paralela a A):
  verificar si Trusted Signing cubre la región; si no, cotizar OV. Importar al
  almacén, actualizar `certificateThumbprint`, re-empaquetar, medir
  SmartScreen en una máquina limpia. *Criterio*: instalador firmado por CA
  pública, con sello, sin advertencia bloqueante tras acumular descargas
  (la advertencia inicial de poca reputación se documenta, no se combate con
  hacks).
- **Fase C — Updater real** (no depende de B): plugin
  `tauri-plugin-updater` + `tauri signer generate` + `createUpdaterArtifacts`;
  manifiestos stable/beta como assets de GitHub Release; migración de
  `AppUpdaterModal` del mock al plugin con versión real; prueba end-to-end de
  actualizar la instalación `0.1.x` → siguiente versión desde el canal con
  firma verificada. *Criterio*: una instalación vieja se actualiza sola desde
  el manifiesto publicado, la firma minisign se verifica y el install mode es
  `passive`.
- **Fase D — Onboarding de motores** (independiente de A-C): catálogo
  `EngineSpec` con hashes fijados (misma disciplina que `models.rs:53-55`),
  vista «Motores locales», descarga verificada + instalación por el usuario +
  prueba de conexión por motor, empezando por Ollama (el más simple) y el
  adaptador Wav2Lip (ya existe). *Criterio*: desde una máquina limpia, activar
  dubbing y clonación de voz sin salir de la app ni leer el repo, y con cada
  artefacto descargado validado por SHA-256.
- **Fase E — Capas/delta (opcional, condicionada a medición)**: separar el
  paquete de medios del instalador con hashes verificados y updater por capas;
  medir antes el ahorro real (instalador núcleo vs actual) y decidir con ese
  número. *Criterio*: una update típica de app no re-descarga FFmpeg.

## 6. Fuentes

**Repo (leído en esta sesión):** `docs/AUDIT.md:13-14,116-118`;
`docs/ROADMAP.md:197-283`; `apps/desktop/src-tauri/tauri.conf.json`
(bundle.windows, bundle.resources); `apps/desktop/src-tauri/Cargo.toml:31-32`;
`apps/desktop/src/features/updater/updater-service.ts:38-160`;
`apps/desktop/src/features/updater/AppUpdaterModal.tsx:172-186,287`;
`apps/desktop/src-tauri/src/commands/models.rs:5-6,53-169,361-461`;
`apps/desktop/src-tauri/src/commands/capabilities.rs:3-7,53-94`;
`apps/desktop/src-tauri/src/commands/voice_clone.rs:1-8`;
`apps/desktop/src-tauri/src/commands/lip_sync.rs:1-7`;
`apps/desktop/src-tauri/src/commands/providers.rs:132,704,1092-1106`;
`scripts/lipsync-engine/server.py:1-22`; `scripts/package-windows.ps1`;
`scripts/actualizar-olyvia.ps1`; `SECURITY.md:121-122,147-149`;
`apps/desktop/src/features/localization/LocalizationView.tsx:999,1216,1257`;
`apps/desktop/src/features/settings/SettingsHome.tsx:321`;
`apps/desktop/src/features/settings/CapabilitiesCard.tsx`.

**Comandos ejecutados en esta sesión:** `git status`/`git branch` (rama
`feat/motion-graphics` confirmada); `Get-AuthenticodeSignature` sobre
`target\release\bundle\nsis\Olyvia_0.1.0_x64-setup.exe` y sobre
`%LOCALAPPDATA%\Olyvia\editor-ia-desktop.exe` (resultados en la introducción y
§1.1); mediciones de tamaño con `ls`/`du` (§1.5).

**Web (consultadas 2026-10-26):**

- Tauri v2 — plugin updater (firma obligatoria, `tauri signer generate`,
  `pubkey`, endpoints con `{{current_version}}/{{target}}/{{arch}}`, formato
  estático del manifiesto, `createUpdaterArtifacts`, `installMode`, ausencia
  de delta): <https://v2.tauri.app/plugin/updater/>
- Tauri v2 — referencia de configuración (`certificateThumbprint`,
  `digestAlgorithm`, `timestampUrl` RFC 3161, `tsp`, `signCommand`):
  <https://v2.tauri.app/reference/config/>
- Trusted Signing/Azure Artifact Signing (renombre, precios 9,99/99,99 USD
  por mes, restricción regional, límites frente a EV):
  <https://www.reddit.com/r/electronjs/comments/1vb02xu/hello_what_is_the_least_expensive_way_to_sign_my>
- SmartScreen basado en reputación 2025-2026 (EV sin pase garantizado,
  acumulación por archivo, renovaciones sin reputación heredada):
  <https://nhimg.org/articles/smartscreen-reputation-is-overriding-code-signing-trust-for-new-software>
- Instalación de Ollama en Windows (`winget install Ollama.Ollama`, zips
  standalone en GitHub Releases): <https://github.com/ollama/ollama/releases>

**No verificado en esta sesión (y declarado como tal):** disponibilidad
regional de Trusted Signing para Argentina; precios vigentes de certificados
OV/EV; los hashes SHA-256 de instaladores y pesos de Ollama/XTTS/GPT-SoVITS
versiones concretas; el tamaño comprimido real de un instalador «sólo núcleo»
(la estimación de §3.3 no se midió).
