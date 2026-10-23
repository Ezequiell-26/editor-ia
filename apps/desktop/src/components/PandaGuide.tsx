/**
 * Pando, the in-app guide. The illustration is original SVG: a panda holding
 * a ruler, drawn with flat shapes so it fits the rest of the chrome.
 */
export function PandaGuide({
  message,
  detail,
  compact = false,
}: {
  readonly message: string;
  readonly detail?: string;
  readonly compact?: boolean;
}) {
  return (
    <div className={`panda-guide${compact ? ' compact' : ''}`}>
      <div className="panda-figure-wrap" aria-hidden="true">
        <svg className="panda-figure" viewBox="0 0 220 180" focusable="false">
          <g className="panda-body">
            <ellipse className="panda-leg panda-leg-left" cx="86" cy="146" rx="18" ry="15" />
            <ellipse className="panda-leg panda-leg-right" cx="134" cy="146" rx="18" ry="15" />
            <ellipse className="panda-body-shape" cx="110" cy="116" rx="43" ry="37" />
            <ellipse className="panda-arm panda-arm-left" cx="72" cy="112" rx="14" ry="27" />
            <ellipse className="panda-arm panda-arm-right" cx="148" cy="104" rx="14" ry="27" />
            <g className="panda-head">
              <circle className="panda-ear" cx="73" cy="32" r="16" />
              <circle className="panda-ear" cx="147" cy="32" r="16" />
              <circle className="panda-face" cx="110" cy="64" r="46" />
              <ellipse className="panda-eye-patch" cx="92" cy="62" rx="13" ry="17" transform="rotate(-18 92 62)" />
              <ellipse className="panda-eye-patch" cx="128" cy="62" rx="13" ry="17" transform="rotate(18 128 62)" />
              <circle className="panda-eye" cx="93" cy="62" r="5" />
              <circle className="panda-pupil" cx="94" cy="63" r="2.4" />
              <circle className="panda-eye" cx="127" cy="62" r="5" />
              <circle className="panda-pupil" cx="126" cy="63" r="2.4" />
              <ellipse className="panda-nose" cx="110" cy="80" rx="7" ry="5" />
              <path
                className="panda-mouth"
                d="M110 85v5m0 0q-6 7-12 1m12-1q6 7 12 1"
              />
              <circle className="panda-cheek" cx="74" cy="82" r="5" />
              <circle className="panda-cheek" cx="146" cy="82" r="5" />
            </g>
            <path className="panda-scarf" d="M80 103q30 14 60 0l-4 13q-26 10-52 0z" />
            <g className="panda-ruler">
              <rect x="141" y="66" width="13" height="64" rx="2" transform="rotate(-17 147 98)" />
              <path d="M145 76h6M145 84h6M145 92h6M145 100h6M145 108h6M145 116h6" transform="rotate(-17 147 98)" />
            </g>
          </g>
        </svg>
      </div>
      <div className="panda-speech">
        <strong>{message}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
    </div>
  );
}
