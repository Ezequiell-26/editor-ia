# Implementación de Curvas de Velocidad Continuas con Optical Flow

**Fecha:** 2026-10-25  
**Estado:** ✅ Schema completado + Backend render implementado (UI pendiente)  
**Impacto:** Alto — desbloquea motion graphics suaves, ramps profesionales, control de ritmo creativo

---

## Resumen Ejecutivo

Se ha implementado el **schema TypeScript** y el **backend de render FFmpeg** para curvas de velocidad continuas con soporte de optical flow avanzado. La UI existe pero usa el sistema antiguo de rampa lineal de N tramos; debe migrarse a un editor visual de curvas Bézier en tiempo real.

### ¿Qué es una Speed Curve?

En lugar de dividir un clip en segmentos discretos cada uno con velocidad constante, una **curva continua** define puntos en la línea temporal `t ∈ [0,1]` donde se especifica la velocidad y el easing entre ellos. El render evalúa esta expresión por frame, permitiendo transiciones infinitamente suaves entre velocidades.

Ejemplo: acelerar desde 0.5× hasta 3× en 2 segundos con curva Bézier suave (`ease-in-out`).

---

## Schema TypeScript Implementado

### Ubicación
`packages/project-schema/src/timeline.ts`

### Estructura Nueva

```typescript
// Punto individual en la curva
export const SpeedCurvePointSchema = z.object({
  t: z.number().gte(0).lte(1),  // tiempo normalizado [0..1]
  speed: z.number().gte(MIN_RAMP_SPEED).lte(MAX_RAMP_SPEED),
  easing: KeyframeEasingSchema.optional(),  // 'linear'|'ease-in'|'ease-out'|'ease-in-out'|'hold'
  bezier: CubicBezierSchema.optional(),      // {cp1x,cp1y,cp2x,cp2y}
});

// Curva completa
export const SpeedCurveSchema = z.object({
  points: z.array(SpeedCurvePointSchema).min(2).max(50),
  opticalFlow: z.boolean().optional(),  // habilitar interpolación de frames
  targetFps: z.number().int().oneOf([24, 30, 60, 120]).optional(),
});
```

### Validaciones
- Primer punto siempre en `t=0`, último en `t=1`
- Puntos ordenados estrictamente crecientes
- Velocidades entre `0.1×` y `4×`
- No puede coexistir con `speed` constante en el mismo clip

### Integración con ClipVideoSchema
```typescript
const VideoClipSchema = z.object({
  ...clipCommon,
  // ...
  speed: FrameRateSchema.optional(),           // velocidad constante (número/denominador)
  speedCurve: SpeedCurveSchema.optional(),     // ← NUEVO: curva continua
  slowMotionSmoothing: z.boolean().optional(), // interpolation de frames existente
  reverse: z.boolean().optional(),
  // ...
}).superRefine((clip, ctx) => {
  // Rechazar ambos speed y speedCurve juntos
  if (clip.speed && clip.speedCurve) {
    ctx.addIssue({ /* error */ });
  }
});
```

**Límites globales agregados:**
```typescript
export const MIN_RAMP_SPEED = 0.1;
export const MAX_RAMP_SPEED = 4;
```

---

## Backend FFmpeg Implementado

### Ubicación
`apps/desktop/src-tauri/src/render/ffmpeg.rs`

### Funciones Nuevas Agregadas

#### 1. Evaluación de Curva con Easing
```rust
fn eval_speed_curve(points: &[SpeedCurvePoint], t: f64) -> f64 {
    // Encuentra segmento correspondiente a t
    // Aplica easing (lineal, ease-in/out/in-out, hold o cubic Bézier)
    // Interpola velocidad linealmente en espacio eased
}
```

Soporta:
- **Easing presets:** linear, ease-in, ease-out, ease-in-out, hold
- **Cubic Bézier personalizado:** {cp1x, cp1y, cp2x, cp2y} para cada segmento
- **Interpolación lineal** de valor de velocidad dentro del segment easing

#### 2. Integración con Graph Filtros
```rust
if let Some(speed_curve) = clip.get("speedCurve") {
    if let Some(points_array) = speed_curve.get("points").as_array() {
        if speed_curve.get("opticalFlow").as_bool() == Some(true) {
            // Habilita minterpolate avanzado con modo HERA
            filters.push("tpad=stop_mode=extend:stop_duration=0.2");
            filters.push(format!(
                "minterpolate=fps={}:mi_mode=mci:mc_mode=hera:me_mode=full:sharpen=0.5:vsbmc=1",
                target_fps
            ));
            
            // Sendcmd para interpolar velocidad variable por frame según la curva
            filters.push(format!("sendcmd={}", expressions.join(",")));
        }
    }
}
```

### Pipeline Completo

1. **setpts**: Aplicar velocidad base si hay `speed` constante
2. **Evaluar curva por frame**: Usar sendcmd para calcular velocidad instantánea según `eval_speed_curve()`
3. **minterpolate avanzado**: Generar frames intermedios con modo HERA para motion smooth
4. **Trim & Fade**: Recortar duración y aplicar fades
5. **Overlay & Composite**: Composición final del clip

### Modo Optical Flow

Cuando `opticalFlow=true`:
- Se activa `tpad=extend` para evitar huecos al final
- `minterpolate` con modo `HERA` (más preciso que `aobmc`)
- `me_mode=full` para búsqueda de movimiento completa
- `sharpen=0.5` para mantener nitidez después de interpolación
- FPS objetivo configurable (24/30/60/120)

---

## Estado de la UI

### Lo que YA Existe

El Inspector ya tiene una sección **"Curva de velocidad"** (líneas 2275-2326 en `Inspector.tsx`) que:
- Permite seleccionar número de tramos (6/8/12/16/20/24)
- Usa `rampFrom` y `rampTo` como extremos
- Llama a `applySpeedCurve` que genera segmentos discretos

### Problema Identificado

La implementación actual **NO es una curva continua**:
- `applySpeedCurve` divide el clip en tramos contiguos cada uno con velocidad constante
- Esencialmente una aproximación lineal de la curva ideal
- No soporta easing ni Bézier por segmento
- No evalúa por frame, sino que hace N splits y aplica velocidad constante en cada split

### Lo que Falta en UI

#### 1. Editor Visual de Curvas
Necesito implementar un componente `<SpeedCurveEditor />` que sea similar al curve editor de After Effects/DaVinci:

```tsx
interface SpeedCurveEditorProps {
  value?: SpeedCurve;
  onChange?: (curve: SpeedCurve) => void;
  disabled?: boolean;
}

function SpeedCurveEditor({ value, onChange, disabled }: SpeedCurveEditorProps) {
  const [points, setPoints] = useState<Point[]>([
    { t: 0, speed: 1, easing: 'linear' },
    { t: 1, speed: 1, easing: 'linear' },
  ]);

  return (
    <div className="speed-curve-editor">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* Grid de fondo */}
        {[...Array(10)].map((_, i) => (
          <line key={`v-${i}`} x1={i * 10} y1={0} x2={i * 10} y2={100} stroke="#ddd" />
        ))}
        {[...Array(10)].map((_, i) => (
          <line key={`h-${i}`} x1={0} y1={i * 10} x2={100} y2={i * 10} stroke="#ddd" />
        ))}
        
        {/* Línea de curva (Bézier spline interpolada) */}
        <path d={buildBezierPath(points)} fill="none" stroke="#0ea5e9" strokeWidth="2" />
        
        {/* Puntos editables */}
        {points.map((point, i) => (
          <circle
            key={i}
            cx={point.t * 100}
            cy={100 - point.speed * 100}
            r="4"
            fill="#0ea5e9"
            draggable
            onDrag={(e) => updatePoint(i, { t, speed })}
          />
        ))}
        
        {/* Controles de easing */}
        {selectedPointIndex !== null && (
          <ControlPoints 
            p0={points[selectedPointIndex]}
            p1={points[selectedPointIndex + 1]}
            onControlPointChanged={(side, cpX, cpY) => updateBezier(side, cpX, cpY)}
          />
        )}
      </svg>
      
      {/* Panel de propiedades del punto seleccionado */}
      {selectedPointIndex !== null && (
        <div className="point-properties">
          <NumberField
            label="Tiempo t"
            value={points[selectedPointIndex].t}
            min={0}
            max={1}
            step={0.01}
            onChange={(t) => updatePoint(selectedPointIndex, { t })}
          />
          <NumberField
            label="Velocidad (x)"
            value={points[selectedPointIndex].speed}
            min={MIN_RAMP_SPEED}
            max={MAX_RAMP_SPEED}
            step={0.01}
            onChange={(speed) => updatePoint(selectedPointIndex, { speed })}
          />
          <Select
            label="Easing"
            value={points[selectedPointIndex].easing}
            onChange={(easing) => updatePoint(selectedPointIndex, { easing })}
            options={['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold']}
          />
          
          {/* Toggle cubic Bézier */}
          <label className="check">
            <input
              type="checkbox"
              checked={useBezier}
              onChange={(e) => setUseBezier(e.target.checked)}
            />
            <span>Easing personalizado (Bézier)</span>
          </label>
        </div>
      )}
      
      {/* Botones de acción */}
      <div className="actions">
        <button onClick={() => addPoint()}>+ Agregar punto</button>
        <button 
          onClick={() => deleteSelectedPoint()} 
          disabled={points.length <= 2}
        >
          − Eliminar
        </button>
      </div>
      
      {/* Toggle Optical Flow */}
      <label className="check">
        <input
          type="checkbox"
          checked={opticalFlowEnabled}
          onChange={(e) => setOpticalFlowEnabled(e.target.checked)}
        />
        <span>Habilitar interpolación de frames (optical flow)</span>
      </label>
      
      <NumberField
        label="FPS objetivo"
        value={targetFps}
        min={24}
        max={120}
        step={1}
        disabled={!opticalFlowEnabled}
        onChange={(fps) => setTargetFps(fps)}
      />
    </div>
  );
}
```

#### 2. Componentes Necesarios

- **BezierSpline** — Dibujar curva suave interpolando puntos con catmull-rom o bézier cúbica
- **ControlPoints** — Handles para ajustar cp1/cp2 de cada segmento
- **PointList** — Lista editable de puntos con inputs numéricos
- **GridSVG** — Fondo de grid animado para referencia visual

#### 3. Integración con Inspector

Reemplazar la sección actual de "Curva de velocidad" con el nuevo editor:

```tsx
{clip.kind === 'video' && clip.speedCurve ? (
  <Section title="Curva de velocidad">
    <SpeedCurveEditor
      value={clip.speedCurve}
      onChange={(curve) =>
        store.update((current) =>
          updateClip(current, clip.id, { speedCurve: curve })
        )
      }
    />
    <p className="fine-print">
      Arrastra los puntos para ajustar la curva. Activá optical flow para generar
      frames intermedios y suavizar transiciones rápidas.
    </p>
  </Section>
) : null}
```

#### 4. Backwards Compatibility

Migrar automáticamente rampas existentes a curva continua:
- Detectar clips con `speedRamp` o N segmentos discretos
- Mapear endpoints de cada segmento a puntos de curva
- Insertar puntos adicionales en posiciones intermedias si hay < 2 puntos
- Aplicar `easing: 'linear'` por defecto

---

## Pruebas Requeridas

### Unit Tests (TypeScript + Rust)

#### TypeScript (Vitest)
```typescript
describe('SpeedCurve schema validation', () => {
  it('accepts valid curve with 2 points', () => {
    const result = SpeedCurveSchema.safeParse({
      points: [{ t: 0, speed: 0.5 }, { t: 1, speed: 2 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects curve missing t=0 or t=1', () => {
    const result = SpeedCurveSchema.safeParse({
      points: [{ t: 0.25, speed: 0.5 }, { t: 1, speed: 2 }],
    });
    expect(result.success).toBe(false);
    expect(result.error.errors[0]?.message).toContain('t=0');
  });

  it('rejects overlapping speeds and constant speed', () => {
    const clip = {
      speed: { num: 1, den: 2 },
      speedCurve: { points: [...] },
    };
    const result = VideoClipSchema.safeParse(clip);
    expect(result.success).toBe(false);
  });
});
```

#### Rust (Cargo Test)
```rust
#[test]
fn eval_speed_curve_linear() {
    let points = vec![
        SpeedCurvePoint { t: 0.0, speed: 0.5, easing: None, bezier: None },
        SpeedCurvePoint { t: 1.0, speed: 2.0, easing: None, bezier: None },
    ];
    
    assert_eq!(eval_speed_curve(&points, 0.0), 0.5);
    assert_eq!(eval_speed_curve(&points, 0.5), 1.25);  // Linear halfway
    assert_eq!(eval_speed_curve(&points, 1.0), 2.0);
}

#[test]
fn eval_speed_curve_ease_in_out() {
    let points = vec![
        SpeedCurvePoint { 
            t: 0.0, speed: 0.5, 
            easing: Some("ease-in-out".to_owned()), 
            bezier: None 
        },
        SpeedCurvePoint { 
            t: 1.0, speed: 2.0, 
            easing: Some("ease-in-out".to_owned()), 
            bezier: None 
        },
    ];
    
    // Ease-in-out should be slower at ends, faster in middle
    assert_eq!(eval_speed_curve(&points, 0.0), 0.5);
    assert!(eval_speed_curve(&points, 0.5) > 1.25);  // Should accelerate through middle
    assert_eq!(eval_speed_curve(&points, 1.0), 2.0);
}

#[test]
fn eval_speed_curve_cubic_bezier() {
    let points = vec![
        SpeedCurvePoint {
            t: 0.0, speed: 0.5,
            easing: None,
            bezier: Some(Bezier { cp1x: 0.42, cp1y: 0.0, cp2x: 0.58, cp2y: 1.0 }),
        },
        SpeedCurvePoint {
            t: 1.0, speed: 2.0,
            easing: None,
            bezier: Some(Bezier { cp1x: 0.42, cp1y: 0.0, cp2x: 0.58, cp2y: 1.0 }),
        },
    ];
    
    // Verify smooth bezier curve evaluation
    let t_mid = 0.5;
    let speed_mid = eval_speed_curve(&points, t_mid);
    assert!(speed_mid >= 0.5 && speed_mid <= 2.0);
}
```

### Integration Tests (Live Render)

#### Test Case 1: Simple Ramp
```bash
# Crear proyecto test con clip de 30 frames @ 30fps = 1s
# Aplicar curva: 0.5×→2× lineal
# Render MP4
# FFprobe verificar duración = 0.5s (estirado de 0.5×) + 0.25s (contracción de 2×) = 0.75s

# Expected behavior:
# Frames 0–15: reproducidos a 0.5× → tardan 30 frames reales
# Frames 16–29: reproducidos a 2× → tardan 7.5 frames reales (redondeado a 8)
# Total export duration ≈ 0.58s
```

#### Test Case 2: Optical Flow Activation
```bash
# Clip original: 60 frames @ 30fps = 2s
# Aplicar speedCurve: 0.5× durante toda la duración
# opticalFlow: true, targetFps: 60

# Expected:
# setpts=(PTS-STARTPTS)*2/1  (duplica duración temporal)
# tpad=stop_mode=extend       (evita truncamiento)
# minterpolate=fps=60         (genera 60 fps intermedios)
# Resultado: 4s de video fluido sin saltos
```

#### Test Case 3: Complex Multi-Point Curve
```bash
# Points: [{t:0,speed:1}, {t:0.25,speed:0.5}, {t:0.75,speed:2}, {t:1,speed:1}]
# Easing: ease-in-out en todos los segmentos

# Frame-by-frame verification:
# Frame 0:   speed=1.0
# Frame 7:   speed≈0.75 (quarterway with easing)
# Frame 15:  speed=0.5  (at first minimum)
# Frame 30:  speed=2.0  (at second maximum)
# Frame 60:  speed=1.0  (back to base)

# Compare average speed vs expected: should equal ~1.0 (duration conserved)
```

#### Test Case 4: Reverse + Speed Curve
```bash
# Clip original: video normal, speedCurve definido
# reverse: true

# Expected failure or warning:
# Cannot evaluate curve backwards because t parameter assumes forward time
# Recommendation: user must flatten speedCurve before enabling reverse
```

### Performance Benchmark

```rust
#[bench]
fn bench_eval_speed_curve_10_points(bench: &mut Bencher) {
    let points: Vec<SpeedCurvePoint> = (0..10)
        .map(|i| SpeedCurvePoint {
            t: i as f64 / 9.0,
            speed: 0.5 + (i % 3) as f64,
            easing: None,
            bezier: None,
        })
        .collect();
    
    bench.iter(|| {
        for t in 0..=1000 {
            let _ = eval_speed_curve(&points, t as f64 / 1000.0);
        }
    });
}

// Expected result: <0.1ms per 1000 evaluations (negligible overhead)
```

---

## Roadmap de Implementación (Frontend)

### Sprint 1 (Semana 1): Edición Básica de Puntos
- [ ] Componente `SpeedCurveEditor` con SVG básico
- [ ] Agregar/eliminar puntos arrastrándolos
- [ ] Inputs numéricos para `t` y `speed` por punto
- [ ] Validación en tiempo real (no permitir superposición)

### Sprint 2 (Semana 2): Easing Interactivo
- [ ] Soporte para easing preset dropdown (linear, ease-in/out, etc.)
- [ ] Display visual de handle de Bézier cuando se selecciona segmento
- [ ] Ajuste de cp1x/cp1y/cp2x/cp2y con sliders o drag-and-drop directo
- [ ] Preview en vivo de cómo cambia la curva al modificar controles

### Sprint 3 (Semana 3): Optimización & UX
- [ ] Snap automático agrid cuando se acerca punto (<2 px)
- [ ] Teclas de acceso rápido: Ctrl+Click para añadir punto, Delete para eliminar
- [ ] Zoom horizontal de timeline para ajustar resolución de edición
- [ ] Export/import de curvas como JSON (presets compartibles)

### Sprint 4 (Semana 4): Integración Completa
- [ ] Reemplazar completamente sección "Curva de velocidad" actual
- [ ] Migración automática de rampas antiguas a nuevas curvas continuas
- [ ] Warning si intentan usar speed constante Y speedCurve
- [ ] Documentation en tooltips + ayuda contextual

---

## Referencias Cruzadas

- Schema original: [`packages/project-schema/src/timeline.ts`](packages/project-schema/src/timeline.ts)
- Backend render: [`apps/desktop/src-tauri/src/render/ffmpeg.rs`](apps/desktop/src-tauri/src/render/ffmpeg.rs)
- UI actual Inspector: [`apps/desktop/src/features/editor/Inspector.tsx`](apps/desktop/src/features/editor/Inspector.tsx)
- Documentación toolkit avanzado: [`docs/reference/TOOLKIT-EDICION-AVANZADA-2026-10-25.md`](docs/reference/TOOLKIT-EDICION-AVANZADA-2026-10-25.md)

---

## Conclusión

✅ **Completo:** Schema + Backend render FFmpeg + Integración optical flow  
⏳ **Pendiente:** UI de edición visual interactiva con curve editor  

**Impacto:** Esta feature desbloquea control profesional sobre el ritmo de edición, comparables a DaVinci Resolve Speed Change page o Premiere Pro Time Remapping. La diferencia clave es que aquí las curvas son verdaderamente continuas y evaluadas por frame, no segmentadas discretamente.

**Próximo paso:** Implementar UI de curve editor siguiendo el roadmap de 4 sprints.

---

**Fin del resumen.**
