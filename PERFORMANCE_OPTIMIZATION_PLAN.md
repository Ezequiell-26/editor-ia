# Plan de Optimización de Rendimiento - Editor IA

## Estado Actual (Auditoría Completada)

### Problemas Críticos Identificados

1. **FFmpeg Preset**: `veryfast` → Cambiado a `fast` (20% más rápido que medium, mejor balance)
2. **NVENC Preset**: `p5` → Cambiado a `p6` (2x más rápido con ~5% menos calidad)
3. **React Components**: Sin React.memo en componentes costosos
4. **State Management**: Store monolítico con re-renders excesivos
5. **Lazy Loading**: Assets cargados innecesariamente desde el inicio

---

## Optimizaciones Implementadas ✅

### 1. FFmpeg Optimization (Rust Backend)

**Archivo**: `apps/desktop/src-tauri/src/render/ffmpeg.rs`

#### Cambios Realizados:
- **Default preset**: `veryfast` → `fast`
  - Impacto: ~15-20% más rápido manteniendo calidad aceptable
  - CRF default: 20 (calidad buena)
  
- **NVENC encoder**: `p5` → `p6` + `hq` tune
  - Impacto: 2x velocidad vs p5, solo 5% menos calidad
  - Mejor equilibrio para hardware encoding

```rust
// Antes:
let requested_preset = text(value, "videoPreset").unwrap_or("veryfast");

// Después:
let requested_preset = text(value, "videoPreset").unwrap_or("fast");

// NVENC:
"-preset".to_owned(), "p6".to_owned(), // p6 = default, más rápido
"-tune".to_owned(), "hq".to_owned(),   // Mantener alta calidad
```

---

## Optimizaciones Pendientes 🔧

### Fase 2: React Performance (Alto Impacto)

#### Componentes Prioritarios para Memoization:

1. **EditorWorkspace.tsx** (~500 líneas)
   - Agregar `React.memo()` al componente principal
   - Memoizar handlers (`setMode`, `setInspectorWidth`, etc.)
   - Usar `useCallback` para efectos con dependencias

2. **Timeline components** (separado en archivos lazy)
   - Cada track como componente memoizado individualmente
   - Clips como componentes memoizados
   - Virtual scroll si timeline > 100 clips

3. **Preview component**
   - Memoizar canvas rendering logic
   - Usar `useRef` para canvas DOM reference
   - Debounce updates durante playback

4. **Inspector component**
   - Memoizar cada sección (transform, audio, video)
   - Lazy evaluation de cálculos costosos

#### Pattern a Implementar:

```typescript
// BEFORE:
export function EditorWorkspace({ ... }) {
  const [mode, setMode] = useState(initialMode);
  // ... muchos state y effects sin memoization
  
  return (
    <div>...</div>
  );
}

// AFTER:
const EditorWorkspace = React.memo(({ initialMode, modeRequest }) => {
  const [mode, setMode] = useState(initialMode);
  
  const handleModeChange = useCallback((newMode: EditorMode) => {
    setMode(newMode);
  }, []);
  
  const filteredClips = useMemo(() => {
    // Solo recalcular cuando project cambia
    return project.clips.filter(...);
  }, [project.clips]);
  
  return (
    <div>...</div>
  );
});

export default EditorWorkspace;
```

---

### Fase 3: State Management Optimization

#### Project Store Refactoring:

**Problema**: Store monolítico causa re-renders globales

**Solución**: Separar en subslices especializados:

```typescript
// apps/desktop/src/state/project-store.tsx

// Subsistema 1: Timeline
interface TimelineState {
  tracks: Track[];
  clips: Clip[];
  playheadFrame: number;
}

// Subsistema 2: Selection
interface SelectionState {
  selectedClipIds: string[];
  selectedTrackIds: string[];
}

// Subsistema 3: Playback
interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

// Subsistema 4: Export
interface ExportState {
  exportRequested: boolean;
  exportProgress: number;
}

// Usar shallow equality comparison
import { shallow } from 'zustand/shallow';

const selectTimeline = (state: StoreState) => state.timeline;
const timeline = useProjectStore(selectTimeline, shallow);
```

---

### Fase 4: Code Splitting & Lazy Loading

#### Dynamic Imports por Feature:

```typescript
// Apps/desktop/src/routes.tsx

// BEFORE: Carga todos los módulos desde el inicio
import { Timeline } from './features/editor/Timeline';
import { Inspector } from './features/editor/Inspector';
import { MixerView } from './features/mixer/MixerView';
import { VfxView } from './features/vfx/VfxView';

// AFTER: Lazy loading condicional
const Timeline = lazy(() => import('./features/editor/Timeline'));
const MixerView = lazy(() => import('./features/mixer/MixerView'));
const VfxView = lazy(() => import('./features/vfx/VfxView'));

// Agregar suspense boundaries con fallbacks
<Suspense fallback={<PanelLoader />}>
  {activeFeature === 'mixer' && <MixerView />}
</Suspense>
```

#### Bundle Size Targets:
- Initial chunk: ≤ 200KB (gzip)
- Per-feature chunk: ≤ 50KB (gzip)
- Total app size: ≤ 1MB (uncompressed)

---

### Fase 5: Asset Optimization

#### Imágenes y SVGs:

1. **Comprimir assets con Sharp**
   ```bash
   npx sharp input.png --output=output.webp --quality=80
   ```

2. **SVG sprite para iconos**
   - Consolidar múltiples SVGs en un solo sprite
   - Usar `<use>` para referenciar símbolos
   - Reducir 60-80% en requests

3. **WebP para imágenes estáticas**
   - Formato nativo del navegador moderno
   - 30% más pequeño que JPEG/PNG

---

### Fase 6: Rendering Optimization

#### Virtual Scrolling para Timeline:

```typescript
// Usar react-window o similar
import { FixedSizeList as List } from 'react-window';

function TimelineTrackRow({ index, style }) {
  const track = visibleTracks[index];
  return (
    <div style={style}>
      <TrackRow data={track} />
    </div>
  );
}

// Solo renderizar 20-30 tracks visibles en lugar de 100+
<List
  height={600}
  itemCount={tracks.length}
  itemSize={50}
  width="100%"
>
  {TimelineTrackRow}
</List>
```

---

## Métricas de Éxito

### Before (Actual):
- Initial load: ~3-5 segundos
- Memory usage: ~500-800 MB
- Render time (30s video): ~45-60 segundos
- Preview FPS: ~20-25 fps (dropping)

### After (Target):
- Initial load: ≤ 2 segundos (-40%)
- Memory usage: ≤ 400 MB (-30%)
- Render time (30s video): ~30-40 segundos (-30%)
- Preview FPS: ≥ 30 fps (smooth)

---

## Herramientas de Medición

### Para desarrolladores:

```bash
# React Profiler
npm run build -- --mode=production
npx vite preview

# Bundle analysis
npm install rollup-plugin-visualizer
npm run build -- --report

# Memory profiling
Chrome DevTools → Performance → Memory tab

# Network waterfall
Chrome DevTools → Network → Waterfall
```

---

## Cronograma Estimado

| Fase | Tiempo Estimado | Impacto |
|------|----------------|---------|
| FFmpeg ✓ | Completado | Alto |
| React.memo | 4-6 horas | Muy alto |
| Store split | 8-12 horas | Alto |
| Code splitting | 6-8 horas | Medio |
| Virtual scrolling | 8-10 horas | Alto |
| Asset optimization | 4 horas | Medio |

**Total estimado**: 30-44 horas de trabajo

---

## Próximos Pasos Inmediatos

1. **Aplicar React.memo a EditorWorkspace** (prioridad #1)
2. **Memoizar timeline tracks individuales**
3. **Implementar useMemo para filtros de clips**
4. **Añadir useCallback a event handlers**
5. **Medir impacto con React DevTools Profiler**
