import type { CSSProperties } from 'react';
import { layerVisual } from './plan';
import type { MotionPlan } from './templates';

export function MotionPreview({
  plan,
  progress,
}: {
  readonly plan: MotionPlan;
  readonly progress: number;
}) {
  return (
    <div
      className="motion-preview"
      style={{
        aspectRatio: `${plan.width} / ${plan.height}`,
        containerType: 'inline-size',
      }}
      aria-label="Previsualización de motion graphics"
    >
      {plan.layers.map((layer, index) => {
        const visual = layerVisual(layer, progress, plan.durationFrames);
        const common: CSSProperties = {
          position: 'absolute',
          left: `${layer.x * 100}%`,
          top: `${layer.y * 100}%`,
          width: `${layer.width * 100}%`,
          height: `${layer.height * 100}%`,
          opacity: visual.opacity,
          transform: visual.transform,
        };
        if (layer.kind === 'rect') {
          return (
            <div
              key={`${layer.kind}-${index}`}
              data-layer-kind="rect"
              style={{ ...common, background: layer.color, borderRadius: 8 }}
            />
          );
        }
        return (
          <div
            key={`${layer.kind}-${index}`}
            data-layer-kind="text"
            style={{
              ...common,
              color: layer.color,
              fontFamily: layer.fontFamily,
              fontSize: `${(layer.fontSizePx / plan.width) * 100}cqw`,
              fontWeight: layer.weight,
              textAlign: layer.align,
              lineHeight: 1.05,
              whiteSpace: 'pre-wrap',
              overflow: 'hidden',
            }}
          >
            {layer.text}
          </div>
        );
      })}
    </div>
  );
}
