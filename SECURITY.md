# Seguridad

Editor IA es local-first: los proyectos, los medios y las claves se quedan en la
máquina del usuario. Este documento describe **qué protege el código que existe
hoy** y qué queda fuera de alcance.

## Almacén de credenciales

La clave del proveedor de IA se guarda en el **Administrador de credenciales de
Windows** (Windows Credential Manager) mediante la crate `keyring` (servicio
`editor-ia.provider`). No se persiste en el proyecto, ni en `localStorage`, ni en
el archivo de ajustes, ni en los logs.

- La UI envía la clave una sola vez al comando nativo `save_provider`; el proceso
  Rust la escribe en el almacén y devuelve únicamente `hasKey`.
- La clave se lee en Rust sólo cuando se está por hacer una llamada al proveedor.
- Los errores del proveedor no incluyen la clave ni el encabezado `Authorization`.
- `clear_provider_key` borra la entrada del almacén.
- El proveedor simulado no hace red y no usa claves.

Además, el formato de proyecto **rechaza** cualquier clave con forma de
credencial, incluso dentro del namespace `x-`. La lista cerrada es:
`api_key`, `apikey`, `access_token`, `refresh_token`, `secret`, `password`,
`passwd`, `authorization`, `auth_token`, `bearer_token`, `cookie`,
`private_key`. Un `.editoria.json` que las contenga no valida, así que se puede
compartir o versionar sin secretos.

## Proveedores de IA

- Los endpoints compatibles con OpenAI reciben el brief y el modelo elegido. No
  reciben archivos del proyecto ni la clave por otro canal que el encabezado de
  autenticación.
- Las llamadas a un endpoint que no sea local requieren una confirmación explícita
  de costo antes de ejecutarse. Editor IA no estima precios que no puede conocer.
- La respuesta del modelo se trata como texto no confiable: se extrae un JSON
  acotado, se validan cantidad y longitudes de escenas y recién entonces la UI
  ofrece aplicarlo. El modelo no puede ejecutar comandos ni escribir archivos.
- El plan aplicado queda en `provenance.operations` con proveedor, modelo, costo
  declarado y revisión esperada.

## Derechos de medios

Cada asset declara `rights`:

- `rights.license.commercialUse`: `allowed`, `requires-attribution`,
  `not-for-redistribution` o `unknown`.
- `rights.provenance`: origen (`user-imported`, `downloaded`,
  `generated-by-provider`, `generated-locally`, `template-default`),
  `acquiredAt`, y cuando corresponde `sourceUrl`, `provider` y `termsSnapshot`.

Un asset no puede estar `status: "ready"` con `commercialUse: "unknown"`. La UI
exige confirmar derechos antes de importar y de montar. El renderer vuelve a
comprobar cada asset referenciado: si falta el archivo, el tamaño no coincide
con el registrado en la importación o la licencia es desconocida, el trabajo
falla con `ASSET_NOT_READY` en lugar de producir un MP4.

La licencia MIT del repositorio cubre solo el código propio. No otorga derechos
sobre medios de stock, fuentes, voces instaladas en Windows ni dependencias de
terceros. Remotion no forma parte de esta versión; su licencia debe validarse
antes de integrarlo.

## Rutas y sistema de archivos

- Los paths del proyecto son relativos, usan `/` y se rechazan si son absolutos,
  tienen letra de unidad, `..`, segmentos vacíos, barras invertidas o caracteres
  reservados. La regla está duplicada en TypeScript y en Rust.
- Rust canonicaliza el path y comprueba que siga dentro de la raíz del proyecto
  antes de leer, miniar o renderizar un medio.
- La importación copia el original a `media/` con un nombre saneado y único; no
  sobrescribe ni borra el archivo fuente.
- El guardado de proyecto escribe un temporal en el mismo directorio y hace
  `rename`; un fallo deja intacto el archivo anterior.
- Los temporales de render y subtítulos viven en la caché de la app y se borran
  al terminar o cancelar.

## Procesos externos

- FFmpeg y FFprobe se ejecutan con un vector de argumentos construido en Rust a
  partir de valores validados. No hay shell, no se interpola texto del modelo y
  los ejecutables se eligen con un diálogo o desde Ajustes.
- El render usa perfiles allowlisted (MP4/MOV, H.264/H.265, AAC).
- El comando de cancelación mata el proceso hijo y no reporta un archivo.
- La narración local ejecuta un script PowerShell **fijo, embebido en el
  binario**; el texto se entrega por `stdin` y el nombre de la voz por variable
  de entorno.
- La app no abre una terminal ni ejecuta comandos escritos por el usuario.

## Verificación del render

Un resultado `completed` exige todas estas comprobaciones con FFprobe:

1. el archivo existe;
2. pesa al menos el mínimo del perfil;
3. la duración está dentro de la tolerancia de frames;
4. la resolución coincide con el perfil.

El progreso se reporta, se puede cancelar y el estado final es `completed`,
`failed` o `cancelled`. Nunca se devuelve una ruta de salida para un render que no
pasó la verificación.

## Logs

Los mensajes de error de FFmpeg se sanean reemplazando la raíz del proyecto y el
perfil del usuario por marcadores, y se limitan a las últimas líneas. La UI no
muestra rutas absolutas de proyectos en sus estados. Los logs no contienen claves
de proveedor.

## Qué no está implementado

- Firma de código del instalador y actualizaciones automáticas.
- Publicación en redes, descarga de stock, investigación con fuentes y agentes
  autónomos con escritura libre.
- Cifrado de los proyectos en reposo: quedan protegidos por los permisos del
  sistema de archivos de Windows.
- Sandbox adicional para FFmpeg más allá del proceso hijo y los argumentos
  allowlisted.

## Cómo reportar una vulnerabilidad

- **No abras un issue público** con un exploit, un archivo de proyecto de otra
  persona o datos sensibles. Está prohibido adjuntar credenciales, tokens, claves
  privadas, cookies o cabeceras de autenticación en el reporte.
- Incluí versión/commit, sistema operativo, pasos de reproducción, impacto y una
  prueba de concepto mínima. Saneá cualquier dato de terceros.
- Usá el canal privado que indique el maintainer del repositorio. Si todavía no
  está publicado, no envíes el detalle por un issue.
- Se responde dentro de los 5 días hábiles con confirmación de recibido y una
  estimación de arreglo, sin prometer un SLA que el proyecto no pueda sostener.
