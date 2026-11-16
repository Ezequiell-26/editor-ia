# 2026-11-13 — Fix regresión FFmpeg 9 `eq`→`lutyuv` + tests de máscara

## Contexto

Al consolidar la oleada 3, el gate `render_live` de CI fallaba en
`render_live_pipeline_produces_a_verified_mp4` (EINVAL en libx264/aac).

## Causa raíz (verificada, no supuesta)

`render/ffmpeg/eq_compat.rs` reescribe el filtro `eq` (eliminado en
FFmpeg 9) a `lutyuv`. Generaba:

```
clip((pos)/255*lw+pow((pos)/255,1/g)*gw)*255,0,255)
```

El `*255` quedaba FUERA del primer argumento de `clip()` → el eval de
ffmpeg lo leía como `clip` de 1 arg + cola inválida:
`Invalid chars ',0,255)'` → filtergraph EINVAL → encoders caían por
EOF secundario.

Reproducido directo contra `ffmpeg.exe` con la expresión exacta;
biseccionado (`pow`, `clip` anidado OK; la combinación rota fallaba).

## Fix

`clip(((pos)/255*lw+pow((pos)/255,1/g)*gw)*255,0,255)` — `*255` dentro
del primer arg. Validado contra el binario FFmpeg real antes de compilar.

## Segundo hallazgo (mismo sweep de tests)

`cargo test render::ffmpeg` mostró 2 tests de máscara de polígono
rotos por el WIP de freehand: el path polygon ahora respeta `feather`
(antes lo ignoraba → borde duro). El frontend ya envía `feather: 0.08`
por defecto (Inspector.tsx:896), así que es mejora real, no regresión.
Ajustado: alpha invertido sin doble paréntesis
(`alpha(X,Y)*(1-(…))`) y aserción del test actualizada (la cobertura va
envueltap en `if(lte(feather…))`, `1-(mod(` literal ya no aplica).

## Evidencia

- `eq_compat` tests: 6/6 (nueva aserción de regresión `clip(((clip(`)
- `render_live -- --ignored` con EDITOR_IA_RUN_RENDER_TESTS=1: 12/12
- `render::ffmpeg` completo: 174/174

## Fix extra: ambigüedad aria-label "Pausar"/"Reproducir"

`App.teclado.test.tsx` fallaba con "Found multiple elements" — NO era
SourceMonitor (ya renombrado a 'Pausar fuente') sino **MinimalEditor**
(el modo simple estilo CapCut, PT/ES mezclado): su transporte usaba
`aria-label="Pausar"`/`"Reproduzir"` idéntico a Transport. Fix:
'Pausar modo simple' / 'Reproduzir modo simple'. 20/20 tests verdes,
tsc limpio. Deuda i18n anotada: MinimalEditor mezcla PT ('Reproduzir',
'Detalhes', 'Capturar quadro') con ES.

## Lección

Cuando un filtergraph falla con errores de encoder genéricos, subir el
límite de stderr (`sanitize_log`) o reproducir el `-vf` exacto contra el
binario — el error real siempre está en el parse del filtro, no en el
encoder.
