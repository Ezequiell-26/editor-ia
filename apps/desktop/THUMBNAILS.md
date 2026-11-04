# Sistema de Thumbnails - Guía de Uso

## 📁 Estructura de Directorios

```
public/thumbnails/
├── effects/          # Thumbnails para efectos visuales y de audio
├── transitions/      # Thumbnails para transiciones
├── motion/          # Thumbnails para motion graphics templates
└── presets/         # Thumbnails para presets visuales
```

## 🎨 Formatos Soportados

El sistema soporta los siguientes formatos de imagen:
- ✅ **SVG** (recomendado) - Escalable, pequeño tamaño
- ✅ **JPG** - Para capturas de pantalla reales
- ✅ **PNG** - Para imágenes con transparencia
- ✅ **WebP** - Mejor compresión que JPG

## 🚀 Generación Automática de Thumbnails

### Script de Generación SVG

Ya incluido en el proyecto, genera thumbnails SVG placeholder:

```bash
node scripts/generate-thumbnails.js
```

Este script genera automáticamente:
- 15 efectos básicos
- 10 transiciones comunes
- 6 motion graphics templates
- 6 presets visuales

### Personalizar el Generador

Edita `scripts/generate-thumbnails.js` para:

1. **Añadir nuevos efectos:**
```javascript
const EFFECTS = [
  { id: 'mi-efecto', name: 'Mi Efecto', category: 'color', pattern: 'color' },
  // ... más efectos
];
```

2. **Cambiar colores:**
```javascript
const COLORS = {
  blur: ['#667eea', '#764ba2'],
  color: ['#f093fb', '#f5576c'],
  // ... más categorías
};
```

3. **Crear nuevos patrones:**
```javascript
const PATTERNS = {
  'mi-patron': (color1, color2) => `
    <defs>...</defs>
    <rect ... />
    <!-- Tu SVG personalizado -->
  `,
};
```

## 📸 Capturas de Pantalla Reales

### Método 1: Captura Manual

1. Abre el editor de video
2. Aplica el efecto/transición al video
3. Captura screenshot (Windows: Win+Shift+S)
4. Recorta a 320x180px (aspect ratio 16:9)
5. Guarda en la carpeta correspondiente

### Método 2: Exportar Frames con FFmpeg

```bash
# Aplicar efecto y exportar frame
ffmpeg -i input.mp4 -vf "efecto" -frames:v 1 -s 320x180 thumbnail.jpg
```

Ejemplos específicos:

```bash
# Blur
ffmpeg -i input.mp4 -vf "gblur=sigma=5" -frames:v 1 -s 320x180 blur.jpg

# Sharpen
ffmpeg -i input.mp4 -vf "unsharp=5:5:1.0" -frames:v 1 -s 320x180 sharpen.jpg

# Saturation
ffmpeg -i input.mp4 -vf "eq=saturation=2.0" -frames:v 1 -s 320x180 saturation.jpg
```

### Método 3: Script Automatizado (Python)

```python
# generate_real_thumbnails.py
import subprocess
import os

EFFECTS = [
    ('blur', 'gblur=sigma=5'),
    ('sharpen', 'unsharp=5:5:1.0'),
    ('saturation', 'eq=saturation=2.0'),
]

INPUT_VIDEO = 'sample.mp4'
OUTPUT_DIR = 'public/thumbnails/effects'

for effect_id, ffmpeg_filter in EFFECTS:
    output = f'{OUTPUT_DIR}/{effect_id}.jpg'
    cmd = [
        'ffmpeg', '-y',
        '-i', INPUT_VIDEO,
        '-vf', ffmpeg_filter,
        '-frames:v', '1',
        '-s', '320x180',
        output
    ]
    subprocess.run(cmd)
    print(f'✓ Generated: {output}')
```

## 🔧 Integración en el Código

### Añadir Nuevo Efecto

1. **Crear el thumbnail:**
```bash
# Genera thumbnail.svg o thumbnail.jpg
```

2. **Asegurar que el ID coincida:**
```typescript
// El ID del efecto debe coincidir con el nombre del archivo
const manifest = {
  id: 'mi-efecto-nuevo', // Debe existir mi-efecto-nuevo.svg o .jpg
  name: 'Mi Efecto Nuevo',
  // ...
};
```

3. **El sistema lo cargará automáticamente:**
```typescript
thumbnail: `/thumbnails/effects/${manifest.id}.svg`
```

### Fallback Automático

Si no existe el thumbnail, se muestra:
1. Icono genérico de la categoría
2. Gradiente de color según tipo
3. Nombre del efecto

## 🎯 Especificaciones de Thumbnails

### Dimensiones Recomendadas

| Tipo | Resolución | Aspect Ratio |
|------|-----------|--------------|
| Efectos | 320x180 | 16:9 |
| Transiciones | 320x180 | 16:9 |
| Motion Graphics | 320x180 | 16:9 |
| Presets | 320x180 | 16:9 |

### Optimización

**Para JPG:**
```bash
# Optimizar con ImageMagick
convert input.jpg -quality 85 -strip -resize 320x180 output.jpg
```

**Para PNG:**
```bash
# Optimizar con pngquant
pngquant --quality=80-95 --speed 1 input.png -o output.png
```

**Para WebP:**
```bash
# Convertir a WebP
cwebp -q 85 input.jpg -o output.webp
```

## 🎨 Estilos y Temas

### Personalizar Gradientes

Edita `src/styles/thumbnail-browser.css`:

```css
.thumbnail-placeholder {
  background: linear-gradient(135deg, #TU_COLOR1 0%, #TU_COLOR2 100%);
}
```

### Badges Personalizados

Añade nuevas variantes en `ThumbnailBrowser.tsx`:

```typescript
export interface ThumbnailItem {
  badge?: string;
  badgeVariant?: 'pro' | 'standard' | 'basic' | 'new' | 'premium' | 'featured';
}
```

Luego en CSS:

```css
.thumbnail-badge.premium {
  background: linear-gradient(135deg, #ffd700 0%, #ffed4e 100%);
  color: #000000;
}
```

## 📊 Gestión de Assets

### Organización

```
thumbnails/
├── effects/
│   ├── audio/          # Efectos de audio
│   │   ├── reverb.svg
│   │   └── eq.svg
│   └── video/          # Efectos de video
│       ├── blur.svg
│       └── sharpen.svg
```

### Naming Convention

- Usa kebab-case: `mi-efecto-especial.svg`
- Evita espacios y caracteres especiales
- Mantén nombres cortos y descriptivos
- El nombre debe coincidir exactamente con el ID del efecto

## 🔍 Troubleshooting

### El thumbnail no aparece

1. **Verifica la ruta:**
   ```javascript
   console.log(`/thumbnails/effects/${effectId}.svg`);
   ```

2. **Verifica el formato del archivo:**
   - Debe ser `.svg`, `.jpg`, `.png` o `.webp`
   - El nombre debe coincidir exactamente con el ID

3. **Verifica los permisos:**
   ```bash
   # Windows PowerShell
   Get-Acl public/thumbnails/effects/blur.svg
   ```

### El thumbnail se ve pixelado

- Aumenta la resolución base
- Usa SVG en lugar de raster
- Verifica la calidad de compresión JPG

### Los thumbnails cargan lento

1. **Optimiza las imágenes:**
   - Reduce el tamaño del archivo
   - Usa WebP en lugar de JPG
   - Implementa lazy loading (ya incluido)

2. **Usa CDN:**
   ```typescript
   thumbnail: `https://cdn.tuapp.com/thumbnails/effects/${id}.svg`
   ```

## 🚀 Próximas Mejoras

### Video Previews

Reemplazar SVG estáticos con video loops:

```typescript
<video 
  src={`/thumbnails/effects/${id}.mp4`}
  autoPlay 
  loop 
  muted 
  width="320" 
  height="180"
/>
```

### Thumbnails Dinámicos

Generar previews en tiempo real con Canvas:

```typescript
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
// Aplicar efecto y capturar frame
```

### Cache de Thumbnails

```typescript
// Service Worker para cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('thumbnails-v1').then((cache) => {
      return cache.addAll([
        '/thumbnails/effects/blur.svg',
        // ... más thumbnails
      ]);
    })
  );
});
```

## 📚 Recursos Adicionales

- [FFmpeg Filters Documentation](https://ffmpeg.org/ffmpeg-filters.html)
- [SVG Optimization Guide](https://jakearchibald.github.io/svgomg/)
- [ImageMagick Documentation](https://imagemagick.org/script/command-line-options.php)
- [WebP Conversion Guide](https://developers.google.com/speed/webp/docs/using)

## 💡 Tips & Tricks

1. **Batch Processing:** Usa scripts para generar múltiples thumbnails de una vez
2. **Consistent Style:** Mantén un estilo visual coherente en todos los thumbnails
3. **Performance:** Limita el tamaño de archivo a < 50KB por thumbnail
4. **Accessibility:** Siempre incluye texto alternativo descriptivo
5. **Versioning:** Usa sufijos de versión para thumbnails actualizados (`blur-v2.svg`)

---

**Última actualización:** Noviembre 2026  
**Mantenedor:** Equipo Olyvia AI Video Editor
