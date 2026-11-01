# Open Design · aviso de atribución

Estos recursos provienen de **Open Design** (<https://github.com/nexu-io/open-design>),
licenciado bajo Apache License 2.0. Commit sincronizado: `fa19ff40e34dd50a9b01888b0339a1b2e1e68cc7`.

Olyvia incluye una selección portable de ese proyecto:

- 152 paquetes de sistemas de diseño (manifiesto, DESIGN.md, tokens.css, componentes y previews).
- 11 reglas de craft.
- 189 plantillas de prompt con licencia declarada (CC-BY-4.0, Apache-2.0 o MIT),
  incluidas 45 plantillas de imagen y 40 de video de los plugins oficiales.
  Se excluyeron 2 plantillas sin licencia reutilizable.
- 154 plantillas de diseño como recetas de generación; 16
  quedaron fuera por licencia copyleft o por depender de un upstream sin licencia
  verificable. Cada receta conserva su licencia, archivo LICENSE y enlace de origen
  en `catalog.json`. Las previews sólo se muestran cuando el ejemplo no carga
  scripts ni recursos remotos.
- 131 skills como biblioteca de referencia; 120 quedaron
  fuera por las mismas reglas. Las skills con modo `utility` son sólo lectura:
  no se ofrecen como receta del generador de diseño.
- 13 composiciones HyperFrames autocontenidas (HTML + CSS
  @keyframes + fuentes locales), licencia Apache-2.0, derivadas de
  frontend-slides (MIT). 10 quedaron fuera por usar scripts,
  Remotion o recursos remotos. Las fuentes son de Google Fonts (OFL-1.1) y se
  incluyen como archivos locales; el texto de cada licencia está en
  `hyperframes/licenses/`. No se ejecuta JavaScript en ellas.
- 2 skills
  comunitarias MIT (Hallmark y Humanize PPT) copiadas completas como referencia;
  las que no declaran licencia quedaron fuera. Hallmark conserva su LICENSE de
  Hallmark contributors y Humanize PPT el de LearnPrompt.
- 27 scenarios y
  atoms oficiales (MIT) copiados como documentación de flujo de solo lectura.
  No son recetas del generador.
- 55 recetas
  de ejemplo oficiales (decks y páginas) y
  45 referencias de
  ejemplos con WebGL/GSAP/Remotion. De los ejemplos sólo se copian SKILL.md y
  LICENSE; no se traen scripts, videos ni assets.
- 9 previews MP4 de composiciones con scripts/GSAP,
  incluidas como **material de solo lectura** (Apache-2.0/MIT): no se ejecuta su
  runtime ni se puede editar la composición; sirven para descargar o montar el
  video ya renderizado. 1
  composición Remotion quedó fuera por completo.

Los archivos se copiaron sin modificaciones. Olyvia sólo agrega `catalog.json`
(índice generado) y esta nota. El código de Open Design no se copió: su runtime,
plugins y skills no forman parte de este paquete.

Las marcas, nombres comerciales y logotipos mencionados en los sistemas de
diseño pertenecen a sus titulares. Los tokens se usan como referencia visual y
no implican afiliación ni patrocinio.

Las reglas de craft incluyen adaptaciones de refero_skill (MIT), según se indica en cada archivo.
Cada plantilla de prompt conserva su licencia, autor y URL de origen en
`catalog.json` y en el JSON original.

El texto completo de Apache License 2.0 está en `LICENSE`.
