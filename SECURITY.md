# Seguridad

Editor IA es local-first: el material y los proyectos quedan en la máquina del
usuario. Este documento describe **qué protege el código que existe hoy** y qué
todavía no está implementado. Nada de lo que sigue debe leerse como una garantía
de una versión que aún no existe.

## Almacén de credenciales

**Estado: no implementado.** El plan de producto define que las credenciales de
proveedor van en el almacén seguro del sistema operativo: en Windows, el
Credential Manager vía DPAPI. Nunca en `localStorage`, ni en archivos de
proyecto, ni en logs.

Lo que sí está garantizado y medido hoy es la **prohibición en el formato de
proyecto**: el validador recorre todo el documento `.editoria.json` y rechaza
cualquier clave con forma de credencial, incluso dentro del espacio `x-`. La lista
que se rechaza (ver `packages/project-schema/src/project.ts`) es:

`api_key`, `apikey`, `access_token`, `refresh_token`, `secret`, `password`,
`passwd`, `authorization`, `auth_token`, `bearer_token`, `cookie`, `private_key`.

La regla es deliberada: un campo con esa forma significa que el archivo lo escribió
algo que ignoró el contrato, y la única salida correcta es rechazar el archivo. No
hay excepciones por proyecto, ni flag que la desactive.

Consecuencia practica: **un proyecto `.editoria.json` se puede compartir, adjuntar o
versionar sin exponer secretos**, porque un proyecto que los contenga no valida. Los
tests del esquema cubren ese rechazo; `npm run verify` los corre.

## Gate de licencias y derechos

Cada asset declara su situación en `rights`:

- `rights.license.commercialUse` es un enum cerrado: `allowed`,
  `requires-attribution`, `not-for-redistribution`, `unknown`.
- `rights.provenance` registra `origin` (`user-imported`, `downloaded`,
  `generated-by-provider`, `generated-locally`, `template-default`), `acquiredAt`,
  y cuando corresponde `sourceUrl`, `provider` y `termsSnapshot`.
- `provenance.sources` y `provenance.claims` estan atados por las reglas 10 y 11 de
  integridad referencial de `docs/architecture/PROJECT-FORMAT.md`: un claim no puede
  apuntar a un origen inexistente.

Hoy el formato **expresa y valida** esos estados: las invariables 1 y 2 de la sección
`assets[]` de `docs/architecture/PROJECT-FORMAT.md` están en el código y en los tests.
La invariante 1 es la que importa para derechos de autor: un asset solo puede estar
`status:"ready"` si `commercialUse` **no** es `unknown`; un material sin licencia
declarada no puede entrar a la timeline como si fuera usable. Lo que todavía **no**
existe es el bloqueo en la salida, porque no hay worker de render ni perfiles de
entrega en ejecución (tarea 5). Cuando exista, la regla de producto es que un
`not-for-redistribution` o un `unknown` no puede terminar en un entregable publicado
sin una decisión humana registrada.

La licencia MIT del repositorio alcanza solo al código propio: no otorga derechos
sobre medios de terceros ni sobre material de stock. El archivo
`docs/licensing/THIRD-PARTY-NOTICES.md` aún no existe.

## Superficie que aun no existe

Sin UI, sin comandos nativos, sin worker y sin CI, los riesgos de traversal de rutas,
de ejecución de herramientas externas y de exposición en logs están descritos en el
plan (tareas 4, 5 y 7) pero **no** tienen código que los mitigue todavía. Cualquier
afirmación de endurecimiento verificable sobre esta rama sería falsa.

## Cómo reportar una vulnerabilidad

- **No abras un issue público** con el detalle, un exploit o un archivo de proyecto
  de alguien más. Está prohibido adjuntar credenciales, tokens, claves privadas,
  cookies ni cabeceras de autenticación en el reporte: este proyecto rechaza esos
  campos en su propio formato y no tiene por qué recibirlos por otro canal.
- Redactá el reporte con versión de commit, sistema operativo, pasos de reproducción
  y el impacto. Sanitizá cualquier dato de terceros antes de enviarlo.
- El canal de contacto del maintainer todavía no está publicado en este repositorio
  local; hay que confirmarlo antes de que el proyecto salga a un remoto público. Hasta
  entonces, el reporte se hace por el canal privado que el maintainer indique.
- Se responde en lo posible dentro de los 5 días hábiles, con confirmación de recibido
  y una estimación de arreglo. No se promete un SLA que el proyecto no pueda sostener.
