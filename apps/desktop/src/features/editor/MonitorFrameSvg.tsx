import { useId } from 'react';
import type { MonitorFrame } from '@editor-ia/project-schema';
import { fittedContentBox, type PerspectiveViewport } from './perspective';
import { frameBox, frameColors, frameShape, monitorFramePreset } from './monitor-frames';

interface MonitorFrameSvgProps {
  readonly frame: MonitorFrame;
  readonly viewport: PerspectiveViewport;
}

/**
 * Marco decorativo del clip (paridad con `Molduras.desenho` de AlaukCut):
 * SVG vectorial alrededor del content-box `object-fit`. Los 6 estilos:
 * 1 trazo simple · 2 trazo doble · 3 órbita · 4 neón · 5 floteante ·
 * 6 polaroid.
 */
export function MonitorFrameSvg({ frame, viewport }: MonitorFrameSvgProps) {
  const gradientId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const preset = monitorFramePreset(frame.preset);
  const content = fittedContentBox({
    width: viewport.width,
    height: viewport.height,
    ...(viewport.mediaWidth !== undefined ? { mediaWidth: viewport.mediaWidth } : {}),
    ...(viewport.mediaHeight !== undefined ? { mediaHeight: viewport.mediaHeight } : {}),
  });
  if (content.width <= 0 || content.height <= 0) return null;

  const box = frameBox(preset, content);
  const shape = frameShape(preset, box);
  const colors = frameColors(preset, frame);
  const stroke = colors.gradient ? `url(#${gradientId})` : colors.color;
  const innerInset = shape.strokeWidth * 1.7;
  const innerBox = {
    x: box.x + innerInset,
    y: box.y + innerInset,
    width: Math.max(1, box.width - innerInset * 2),
    height: Math.max(1, box.height - innerInset * 2),
  };
  const innerShape = frameShape(preset, innerBox);

  return (
    <svg
      className="monitor-frame"
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
    >
      {colors.gradient ? (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={colors.color} />
            <stop offset="1" stopColor={colors.color2} />
          </linearGradient>
        </defs>
      ) : null}
      {preset.style === 4 ? (
        <>
          <path
            d={shape.path}
            fill="none"
            stroke={stroke}
            strokeWidth={shape.strokeWidth * 3.2}
            strokeOpacity={0.28}
            strokeLinejoin="round"
          />
          <path
            d={shape.path}
            fill="none"
            stroke={stroke}
            strokeWidth={shape.strokeWidth * 0.55}
            strokeLinejoin="round"
          />
        </>
      ) : preset.style === 5 ? (
        <>
          <path
            d={shape.path}
            fill="none"
            stroke={stroke}
            strokeWidth={shape.strokeWidth * 0.55}
            strokeOpacity={0.7}
            transform="translate(0 3)"
          />
          <path
            d={shape.path}
            fill="rgba(255,255,255,0.14)"
            stroke={stroke}
            strokeWidth={Math.max(0.5, shape.strokeWidth * 0.4)}
            strokeOpacity={0.7}
            strokeLinejoin="round"
          />
        </>
      ) : preset.style === 6 ? (
        <path
          d={`${shape.path} ${innerShape.path}`}
          fill={colors.color}
          fillRule="evenodd"
        />
      ) : preset.style === 3 ? (
        <>
          <path
            d={shape.path}
            fill="none"
            stroke={stroke}
            strokeWidth={shape.strokeWidth * 0.55}
            strokeLinejoin="round"
          />
          <path
            d={innerShape.path}
            fill="none"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth={Math.max(0.4, shape.strokeWidth * 0.28)}
          />
        </>
      ) : (
        <>
          <path
            d={shape.path}
            fill="none"
            stroke={stroke}
            strokeWidth={shape.strokeWidth * (preset.style > 1 ? 0.7 : 0.55)}
            strokeLinejoin="round"
          />
          {preset.style > 1 ? (
            <path
              d={innerShape.path}
              fill="none"
              stroke="rgba(255,255,255,0.45)"
              strokeWidth={Math.max(0.4, shape.strokeWidth * 0.35)}
            />
          ) : null}
        </>
      )}
    </svg>
  );
}
