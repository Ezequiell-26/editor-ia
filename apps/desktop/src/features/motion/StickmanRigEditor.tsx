import { useMemo, useState } from 'react';
import {
  keyframePose,
  poseAtKeyframes,
  solveSkeleton,
  STAND_POSE,
  STICKMAN_BONES,
  STICKMAN_SEGMENTS,
  type StickmanBoneKey,
  type StickmanKeyframe,
  type StickmanPose,
} from './stickman-rig';

const PREVIEW_W = 220;
const PREVIEW_H = 124; // mismo aspecto que 640×360

function deg(rad: number): number {
  return Math.round((rad * 180) / Math.PI);
}

function rad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

interface StickmanRigEditorProps {
  readonly keyframes: readonly StickmanKeyframe[];
  readonly onKeyframesChange: (next: StickmanKeyframe[]) => void;
  readonly maxFrame: number;
  readonly boneColor: string;
}

/**
 * Editor visual del rig del stickman: preview SVG con la misma geometría FK
 * que el motor Rust, sliders por hueso (en grados) y keyframes por frame.
 * Los sliders editan un "borrador"; «Capturar» lo fija como keyframe.
 */
export function StickmanRigEditor({
  keyframes,
  onKeyframesChange,
  maxFrame,
  boneColor,
}: StickmanRigEditorProps) {
  const [draft, setDraft] = useState<StickmanPose>(STAND_POSE);
  const [captureFrame, setCaptureFrame] = useState(0);
  const [previewFrame, setPreviewFrame] = useState(0);

  const previewPose = useMemo(
    () => poseAtKeyframes(keyframes, previewFrame),
    [keyframes, previewFrame],
  );
  const skeleton = useMemo(
    () => solveSkeleton(previewPose, PREVIEW_W, PREVIEW_H),
    [previewPose],
  );
  const draftSkeleton = useMemo(
    () => solveSkeleton(draft, PREVIEW_W, PREVIEW_H),
    [draft],
  );

  const sorted = useMemo(
    () => [...keyframes].sort((a, b) => a.frame - b.frame),
    [keyframes],
  );

  function setBone(key: StickmanBoneKey, degrees: number): void {
    setDraft((prev) => ({ ...prev, [key]: rad(degrees) }));
  }

  function capture(): void {
    const frame = Math.round(Math.min(maxFrame, Math.max(0, captureFrame)));
    const next = sorted.filter((kf) => kf.frame !== frame);
    next.push({ frame, ...draft });
    next.sort((a, b) => a.frame - b.frame);
    onKeyframesChange(next);
  }

  function loadKeyframe(kf: StickmanKeyframe): void {
    setDraft(keyframePose(kf));
    setCaptureFrame(kf.frame);
  }

  function removeKeyframe(frame: number): void {
    onKeyframesChange(sorted.filter((kf) => kf.frame !== frame));
  }

  const joints = skeleton.joints;
  const headR = skeleton.rig.head_r;

  return (
    <div className="stickman-rig">
      <div className="stickman-rig-preview">
        <svg
          viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`}
          width={PREVIEW_W}
          height={PREVIEW_H}
          role="img"
          aria-label="Preview del rig del stickman"
        >
          {STICKMAN_SEGMENTS.map(([a, b]) => (
            <line
              key={`${a}-${b}`}
              x1={joints[a].x}
              y1={joints[a].y}
              x2={joints[b].x}
              y2={joints[b].y}
              stroke={boneColor}
              strokeWidth={3}
              strokeLinecap="round"
            />
          ))}
          {/* Raya tenue del borrador para comparar con la pose interpolada. */}
          {STICKMAN_SEGMENTS.map(([a, b]) => (
            <line
              key={`draft-${a}-${b}`}
              x1={draftSkeleton.joints[a].x}
              y1={draftSkeleton.joints[a].y}
              x2={draftSkeleton.joints[b].x}
              y2={draftSkeleton.joints[b].y}
              stroke={boneColor}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.35}
            />
          ))}
          <circle
            cx={joints.head.x}
            cy={joints.head.y}
            r={headR}
            fill="none"
            stroke={boneColor}
            strokeWidth={2}
          />
          <circle cx={joints.head.x - headR * 0.38} cy={joints.head.y - headR * 0.15} r={headR * 0.16} fill="#141824" />
          <circle cx={joints.head.x + headR * 0.38} cy={joints.head.y - headR * 0.15} r={headR * 0.16} fill="#141824" />
        </svg>
        <p className="fine-print">
          Sólido = pose interpolada en el frame {previewFrame}; punteado = borrador de los sliders.
        </p>
      </div>

      <div className="stickman-rig-controls">
        <label className="field">
          <span>Ver pose en frame</span>
          <input
            type="number"
            min={0}
            max={maxFrame}
            value={previewFrame}
            onChange={(e) =>
              setPreviewFrame(Math.min(maxFrame, Math.max(0, Number(e.target.value) || 0)))
            }
          />
        </label>
        <div className="denoise-controls">
          {STICKMAN_BONES.map(({ key, label }) => {
            const isPixels = key === 'pelvis_dy';
            const value = isPixels ? draft[key] : deg(draft[key]);
            return (
              <label className="field" key={key}>
                <span>
                  {label} ({isPixels ? 'px' : '°'})
                </span>
                <input
                  type="range"
                  min={isPixels ? -120 : -180}
                  max={isPixels ? 120 : 180}
                  step={isPixels ? 1 : 5}
                  value={value}
                  onChange={(e) =>
                    setBone(key, isPixels ? Number(e.target.value) : rad(Number(e.target.value)))
                  }
                />
                <output>{isPixels ? `${Math.round(value)} px` : `${deg(value)}°`}</output>
              </label>
            );
          })}
        </div>
        <div className="actions compact">
          <label className="field">
            <span>Capturar en frame</span>
            <input
              type="number"
              min={0}
              max={maxFrame}
              value={captureFrame}
              onChange={(e) =>
                setCaptureFrame(Math.min(maxFrame, Math.max(0, Number(e.target.value) || 0)))
              }
            />
          </label>
          <button type="button" className="ghost" onClick={capture}>
            Fijar pose en frame {captureFrame}
          </button>
        </div>
      </div>

      <div className="stickman-rig-keys">
        <p className="fine-print">
          Keyframes ({sorted.length}): la animación interpola lineal entre ellos y mantiene el
          extremo fuera de rango.
        </p>
        {sorted.length === 0 ? (
          <p className="fine-print">Sin keyframes — agregá al menos uno para renderizar.</p>
        ) : (
          <ul className="stickman-keyframe-list">
            {sorted.map((kf) => (
              <li key={kf.frame}>
                <button
                  type="button"
                  className="ghost fine-print"
                  onClick={() => loadKeyframe(kf)}
                  title="Cargar esta pose en los sliders"
                >
                  frame {kf.frame}
                </button>
                <button
                  type="button"
                  className="ghost fine-print"
                  onClick={() => removeKeyframe(kf.frame)}
                  aria-label={`Eliminar keyframe ${kf.frame}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
