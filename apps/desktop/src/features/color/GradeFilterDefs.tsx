import { memo } from 'react';
import type { GradeFilterSpec, SvgPrimitive } from './color-engine';

/**
 * Hidden SVG defs holding the real per-channel grade filters.
 *
 * CSS `filter: url(#id)` references these. Every attribute is derived from
 * numeric, schema-validated grade values — no user string ever reaches markup,
 * so the defs are safe to build as React elements (no innerHTML).
 * `colorInterpolationFilters="sRGB"` keeps the tables in display space, which
 * is what the curve editor and the FFmpeg `curves` filter both assume.
 */
function Primitive({ primitive }: { readonly primitive: SvgPrimitive }) {
  const { tag, attrs, funcs } = primitive;
  if (tag === 'feColorMatrix') {
    return <feColorMatrix {...attrs} />;
  }
  if (tag === 'feGaussianBlur') {
    return <feGaussianBlur {...attrs} />;
  }
  if (tag === 'feConvolveMatrix') {
    return <feConvolveMatrix {...attrs} />;
  }
  return (
    <feComponentTransfer {...attrs}>
      {funcs?.r ? <feFuncR type="table" tableValues={funcs.r} /> : null}
      {funcs?.g ? <feFuncG type="table" tableValues={funcs.g} /> : null}
      {funcs?.b ? <feFuncB type="table" tableValues={funcs.b} /> : null}
    </feComponentTransfer>
  );
}

export const GradeFilterDefs = memo(function GradeFilterDefs({
  specs,
}: {
  readonly specs: readonly GradeFilterSpec[];
}) {
  if (specs.length === 0) return null;
  return (
    <svg
      className="color-grade-defs"
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      <defs>
        {specs.map((spec) => (
          <filter
            key={spec.id}
            id={spec.id}
            colorInterpolationFilters="sRGB"
            x="0"
            y="0"
            width="1"
            height="1"
          >
            {spec.primitives.map((primitive, index) => (
              <Primitive key={`${spec.id}-${index}`} primitive={primitive} />
            ))}
          </filter>
        ))}
      </defs>
    </svg>
  );
});
