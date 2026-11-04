# Guía de Verificación de Rendimiento - Editor IA

## Paso 1: Build Optimizado

```bash
cd apps/desktop
npm run build
```

### Verificar Output del Build

El build debería mostrar:
- ✅ Vendor chunks separados (vendor-react, vendor-lottie, etc.)
- ✅ Warning si algún chunk > 50KB
- ✅ Size total menor que versión anterior

## Paso 2: Medir Initial Load Time

### Método A: Chrome DevTools

1. Abrir app desktop
2. DevTools → Performance tab
3. Click "Reload"
4. Detener grabación después de carga completa
5. Ver métricas en panel inferior:
   - **Start Render**: ≤ 2 segundos objetivo
   - **Time to Interactive**: ≤ 3 segundos objetivo

### Método B: Console Logging

Agregar temporalmente este código en `main.tsx`:

```typescript
console.time('APP_LOAD');
// ... initialization code
console.timeEnd('APP_LOAD'); // Debe mostrar ~1.5-2.5s
```

## Paso 3: Verificar Lazy Loading

### Checklist:

- [ ] Solo cargar timeline cuando se entra en modo timeline
- [ ] Lottie no carga hasta ir a Motion view
- [ ] Emojis lazy loaded en TextEdit view
- [ ] Mixer solo carga cuando se accede

**Cómo verificar:**
1. Abrar Network tab en DevTools
2. Recargar app
3. Expandir requests por chunk
4. Confirmar vendors cargan como archivos separados
5. Confirmar features lazy no aparecen hasta necesidad

## Paso 4: Testing React Memoization

### Usar React DevTools Profiler

1. Abri DevTools → Profiler tab
2. Click "Record measurements"
3. Cambiar entre modos (timeline, brain, text-edit, etc.)
4. Stop recording

**Resultados esperados:**

| Component | Expected Re-renders | Max Duration |
|-----------|---------------------|--------------|
| EditorWorkspace | < 5 per action | < 10ms |
| Timeline | < 3 per frame | < 5ms |
| Inspector | < 2 per selection change | < 5ms |
| Preview | < 1 per frame | < 16ms |

Si ves más re-renders, falta memoización o hay callbacks sin `useCallback`.

## Paso 5: Benchmark FFmpeg Render

### Test Case

Crear un video test de 30 segundos con:
- 2 tracks de video
- 1 track de audio  
- 5 clips diferentes
- 1 transition
- 1 efecto básico

### Ejecutar Test

```bash
# Exportar con preset fast (nuevo default)
npm run render -- --preset fast

# Tiempo esperado: 30-40 segundos (-30% vs before)
```

### Comparar Presets

| Preset | Expected Time | Quality | CPU Usage |
|--------|---------------|---------|-----------|
| veryfast (old) | 45-60s | Baja | Bajo |
| **fast (new)** | **30-40s** | **Buena** | Medio |
| medium | 50-70s | Mejor | Alto |

**Conclusión**: fast es mejor balance velocidad/calidad

## Paso 6: Memory Profile

### Usar Chrome DevTools Memory

1. DevTools → Memory tab
2. Click "Take snapshot"
3. Usar la app normalmente durante 2-3 minutos
4. Click "Take snapshot" nuevamente
5. Comparar difference en heap size

**Resultados esperados:**
- ΔHeapSize: ≤ 100 MB after 5 min usage
- Sin memory leaks (heap estable)
- Garbage collection efectiva

## Paso 7: FPS durante Playback

### Test de Reproducción

1. Cargar timeline con múltiples clips
2. Play desde inicio
3. Open Performance monitor (Ctrl+Shift+P → "Show Rendering")
4. Ver FPS counter

**Target:**
- ≥ 30 FPS sostenido
- Máximo drops a 25 FPS (aceptable)
- No caer por debajo de 20 FPS

## Paso 8: CPU/GPU Usage Monitor

### Windows Task Manager

Monitor durante operación típica:

| Action | CPU Expectation | GPU Expectation |
|--------|-----------------|-----------------|
| Idle | 5-15% | < 10% |
| Timeline scroll | 15-30% | < 20% |
| Preview playback | 20-40% | < 30% |
| Export render | 40-80% | 10-50% (hardware encoding) |

**Objetivo**: Uso eficiente sin spikes innecesarios

## Checklist Completa de Validación

### Build & Packaging ✅

- [ ] Build completo exitoso
- [ ] Chunks separados generados
- [ ] Warning thresholds configurados
- [ ] Size total reducido

### Runtime Performance ✅

- [ ] Initial load ≤ 2.5s
- [ ] Lazy loading funcionando
- [ ] Memoria estable (< 400MB)
- [ ] FPS ≥ 30 durante preview

### Rendering ✅

- [ ] FFmpeg fast preset funciona
- [ ] Render time ~30-40s (30s video)
- [ ] Calidad visual aceptable
- [ ] Hardware encoding activo (si disponible)

### Code Quality ✅

- [ ] React.memo en components críticos
- [ ] useMemo en calculations costosas
- [ ] useCallback en event handlers
- [ ] Selectores especializados en store

---

## Troubleshooting

### Problema: Build muy lento

**Solución**: 
- Verificar que LTO está habilitado pero no excesivo
- `opt-level = 3` + `lto = "thin"` es óptimo
- Evitar `lto = "full"` (mucho más lento)

### Problema: Memory leak detected

**Investigar**:
- Listeners de eventos sin cleanup
- Intervals timeouts sin cancel
- Closures reteniendo referencias grandes

**Fix común**:
```typescript
useEffect(() => {
  const handler = someEvent.addListener(callback);
  return () => someEvent.removeListener(handler);
}, [callback]);
```

### Problema: Preview choppy (FPS bajo)

**Causas comunes**:
1. Demasiados effects activos simultáneamente
2. Canvas redraws innecesarias
3. Filros CSS costosos aplicados frecuentemente

**Solutions**:
- Agregar `will-change: transform` solo donde necesario
- Usar `requestAnimationFrame` para animations
- Debounce filters updates

### Problema: Bundle chunk demasiado grande

**Detectar**:
```bash
npm run build
# Buscar warnings: "chunk-X is XX KB"
```

**Actions**:
- Code split manually con dynamic imports
- Split large libraries by feature
- Remove unused dependencies

---

## Herramientas Recomendadas

### Instalación Opcional

```bash
# Bundle analyzer
npm install --save-dev rollup-plugin-visualizer

# React performance profiler
npm install --save-dev @testing-library/react-hooks

# Timing utilities
npm install --save-dev perf-now
```

### Scripts Útiles

```bash
# Build analysis
npm run build && open dist/bundle-analysis.html

# Memory profiling (dev mode)
npm run dev

# Performance monitoring (prod mode)
npm run build
npm run preview
```

---

## Reporte de Resultados

Después de completar todos los tests, documentar:

```markdown
# Performance Test Report - 2026-11-04

## Metrics Collected

- Initial Load: X.X seconds
- Memory Peak: XXX MB
- Preview FPS: XX average
- Render Time (30s): XX seconds

## Issues Found

[None / List any problems]

## Next Steps

[List follow-up optimizations if needed]
```

---

**Generated**: Qoder Performance Verification Guide v1.0
