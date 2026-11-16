# 06 — Layout UI de AlaukCut (`editor.html`, ~1.900 líneas)

HTML server-rendered con comentarios de diseño extensos (pt-BR, "pedido
do Alan"). i18n por `data-i18n`. 5 pantallas HTML: `index.html` (home),
`editor.html` (editor), `ativar.html` (licencia), `oferta.html`
(oferta/upsell), `previa_dupla.html` (preview dual).

## Estructura del editor (de arriba a abajo)

```
┌─ topo-menus ────────────────────────────────────────────────┐
│ Arquivo | Versão | Atualização | Configurações | Ajuda       │
├─ topo-centro: nombre proyecto + "✓ Salvo automaticamente"   │
├─ topo-der: histórico | layout | (ajuda robot) | ✨Edição    │
│   automática (asistente) | ⌨Atalhos | ⬆Exportar             │
├─ barra-abas (11 pestañas del panel izquierdo)               │
├─ meio: [panel-izq] [painel-previa] [painel-inspetor+IA]     │
├─ regiao-timeline                                            │
└─ ia-coluna (columna IA derecha, colapsable)                 │
```

## Barra de pestañas (panel izquierdo, `data-painel`)

| Aba | Contenido |
|---|---|
| `midia` | Importar, seleccionar todo, contadores, medios "perdidos" (archivos movidos) con "Procurar sozinho", lista de medios, drag&drop area, botón grabar, menú de telas |
| `audio` | Biblioteca de sonidos (`lista-sons`) |
| `texto` | Cartão de texto padrão + estilos |
| `stickers` | Emojis animados + stickers con buscador ("filtrar… seta roxa") |
| `efeitos` | Catálogo de efectos por clip |
| `transicoes` | Transiciones (GLSL + cinemáticas) |
| `legendas` | Subtítulos/legendas |
| `filtros` | Filtros/LUTs |
| `animacoes` | **Hyperframes** (animaciones HTML→video) |
| `templates` | Templates de proyecto |

## Monitor de preview (`painel-previa`)

- **Modo "una tela / dos telas"**: toggle `btn-uma-tela`/`btn-dos-telas`.
  Con dos pantallas aparece `monitor-origem` ("Reprodutor-Arquivo") a la
  izquierda — equivalente al Source/Program de DaVinci: doble click en un
  clip de Mídia lo abre ahí, se marcan Início(I)/Fim(O) y se inserta el
  tramo. `previa_dupla.js` maneja la comparación.
- Título "Reprodutor-Linha do tempo 01".

## Inspector (`painel-inspetor`)

- `inspetor-cabecalho` = sub-pestañas dinámicas por contexto de selección.
- `inspetor-corpo` = propiedades (los 5 `inspetor_*.js` llenan esto).
- **Colapsable**: `btn-propriedades` es una lengüeta en la borda cuando está
  cerrado (solo existe con dos pantallas).
- **Conversa IA abajo del inspector**: `ia-conversa` — barra de 34 px
  "💬 Pedir ao Claude", expandible; NO tapa preview ni timeline.

## Timeline (`regiao-timeline`)

- `timeline-barra` izquierda: `tl-nova-trilha`, deshacer/refazer,
  `tl-dividir`, cortar izq/der de la aguja (Q/W), marcadores, etc.
- Tracks con clips, handles de trim, playhead, minimapa.

## Columna IA (`ia-coluna`, derecha)

- Dos sub-pestañas: **"Edição com IA"** y **"Hyperframes"**.
- Estado vacío: "Nenhuma IA conectada ainda" + botón "Conectar uma IA".
- La conversación puede vivir acá o en el inspector (mismo componente).

## Otras pantallas

- `index.html`: home (proyectos recientes, oferta, licencia, ajustes).
- `ativar.html`: activación de licencia.
- `oferta.html`: pantalla de oferta/upsell.
- Diálogos: proyectos, importar, exportar (por formato), ayuda
  contextual (`help_base.js`/`help_alaukcut.js`), novidades (changelog).

## Patrones de UX dignos de copiar en Olyvia

1. **Monitor dual Source/Program** (estilo DaVinci) para revisión de clips.
2. **Inspector colapsable a lengüeta** que no roba ancho cuando no se usa.
3. **Chat IA embebido en inspector** — la petición no tapa el video.
4. **"Salvo automaticamente"** persistente en topbar.
5. **Medios perdidos con auto-relink** ("Procurar sozinho").
6. **Grabación con espera/preview** (`gravar_espera_*` — countdown antes
   de empezar, cuadro de espera guardable).
7. Menús top con submenús hover; iconos SVG de traço consistente.
