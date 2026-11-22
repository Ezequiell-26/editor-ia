/**
 * Equivalente FFmpeg ≥ 9 del filtro `eq` (eliminado en FFmpeg 9).
 *
 * Misma traducción que `render/ffmpeg/eq_compat.rs`: cada plano de `lutyuv`
 * reproduce la LUT de `vf_eq.c` — contraste/brillo lineales y gamma potencial
 * evaluados por píxel en el dominio 0-255. Los planos identidad (`val`) se
 * omiten porque `lutyuv` los deja pasar por defecto.
 *
 * Los parámetros aceptan placeholders `{param}`: se sustituyen después con
 * `applyTemplate`, así que van siempre entre paréntesis para que expresiones
 * como `1+0.5*{amount}` conserven la precedencia.
 */

export interface EqCompatOptions {
  /** Corrimiento de luz, unidad eq (-1..1 aprox). Default `0`. */
  readonly brightness?: string;
  /** Contraste de luminancia. Default `1`. */
  readonly contrast?: string;
  /** Saturación (contraste de los planos de croma). Default `1`. */
  readonly saturation?: string;
  /** Gamma de luminancia (`gamma * gamma_g`, con gamma_g = 1). Default `1`. */
  readonly gamma?: string;
  /** Opción de timeline, p. ej. `lt(mod(t*{rate},1),{duty})` (sin `enable=`). */
  readonly enable?: string;
}

function planeExpr(contrast: string, brightness: string, gamma: string): string {
  if (contrast === '1' && brightness === '0' && gamma === '1') return 'val';
  const linear = `((${contrast})*(val-127.5)+127.5+((${brightness})*255))`;
  const positive = `clip(${linear},0,255)`;
  if (gamma === '1') return positive;
  // gamma_weight = 1 → mezcla = sólo la potencia (ver eq_compat.rs).
  return `clip(pow((${positive})/255,1/(${gamma}))*255,0,255)`;
}

/** Devuelve el filtro `lutyuv` equivalente a `eq=…`, o `lutyuv` vacío no aplica. */
export function eqCompat(opts: EqCompatOptions): string {
  const planes: string[] = [];
  const y = planeExpr(opts.contrast ?? '1', opts.brightness ?? '0', opts.gamma ?? '1');
  if (y !== 'val') planes.push(`y='${y}'`);
  const uv = planeExpr(opts.saturation ?? '1', '0', '1');
  if (uv !== 'val') planes.push(`u='${uv}'`, `v='${uv}'`);
  if (planes.length === 0) planes.push("y='val'");
  const enable = opts.enable ? `:enable='${opts.enable}'` : '';
  return `lutyuv=${planes.join(':')}${enable}`;
}
