# Cobertura de Open Design

Auditoría de la integración portable de [Open Design](https://github.com/nexu-io/open-design).
El comando reproducible es:

```bash
npm run audit:open-design
```

Última corrida: **2391 comprobaciones, 0 fallos, 2.743 archivos, 30,5 MB**.

## Qué se integró

| Categoría | Incluido | Evidencia |
| --- | ---: | --- |
| Sistemas de diseño | 152 | `catalog.json` → `designSystems`, tokens y guías verificados |
| Reglas de craft | 11 | `craft/` |
| Plantillas de prompt | 189 | 45 de imagen y 40 de video de plugins oficiales; 2 excluidas sin licencia |
| Plantillas de diseño | 154 | 99 base + 55 recetas de ejemplos con licencia declarada |
| Skills | 131 | 57 base + 27 scenarios/atoms + 45 referencias de ejemplos + 2 comunitarias MIT |
| HyperFrames renderizables | 13 | HTML/CSS sin scripts, fuentes locales, licencias OFL |
| Previews HyperFrames | 9 | MP4 oficiales de composiciones con scripts/GSAP, solo lectura |
| Imagen IA | integrada | Pollinations/gateway, 45 plantillas de imagen, Medios/timeline |
| Workflows reales | 6 | Critique, corrección con crítica, direcciones, patch, handoff, brief guiado |
| Design Extract | integrado | paleta desde imagen en canvas y desde URL pública (CSS inline + hojas del mismo host, con bloqueo SSRF); no navega la página |

## Exclusiones declaradas

- **Remotion**: 1 composición HyperFrames excluida por completo; no se copia su runtime.
- **Scripts/GSAP**: 9 composiciones se incluyen sólo como preview MP4; su HTML no se ejecuta.
- **Plugins comunitarios sin licencia**: 6 excluidos; 2 de andamiaje tampoco se distribuyen.
- **Skills base sin licencia**: 112 excluidas; 16 plantillas base sin licencia o con copyleft.
- **Runtime de Open Design**: no se copia Node/Chrome/plugins; la app usa su propia arquitectura Tauri/Rust/React.
- **Código ejecutable en skills**: los `scripts/` de las skills comunitarias se eliminan; quedan sólo documentos y contratos.

## Invariantes que verifica el auditor

- Los conteos del catálogo coinciden con los arrays.
- Cada sistema tiene `tokens.css`, `DESIGN.md`, tokens/componentes declarados y previews existentes.
- Cada prompt, plantilla y skill tiene su archivo y licencia permitida.
- Cada HyperFrame tiene HTML y preview, sin `<script>` ni URLs remotas.
- Los 9 previews tienen MP4 y PNG.
- Existen las licencias OFL de Shrikhand, Libre Baskerville y Space Grotesk.
- No hay extensiones ejecutables (`.js`, `.py`, `.ts`) en el paquete; sólo HTML/CSS/JSON/MD/fuentes/imágenes/MP4.
- Los `LICENSE` y `NOTICE` sin extensión están permitidos.

## Límites

La auditoría valida el paquete generado, no sustituye una revisión legal de cada
obra upstream. Las licencias y autores quedan en `catalog.json`, `NOTICE.md` y
`THIRD-PARTY-NOTICES.md`.
