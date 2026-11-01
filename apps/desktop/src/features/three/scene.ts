/**
 * Escenas 3D deterministas con Three.js, cargadas sólo cuando se usan.
 *
 * No hay un segundo timeline: la escena se renderiza frame a frame en un
 * canvas y se hornea a un MP4 que entra a Medios como cualquier asset. El
 * preview y el export siguen siendo los del editor (video normal + FFmpeg).
 */
import type {
  AnimationMixer,
  Group,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import fontData from './fonts/helvetiker_bold.typeface.json';

export type ThreePresetId = 'orbit-cube' | 'torus-dolly' | 'sphere-studio' | 'grid-flythrough';

export interface ThreePreset {
  readonly id: ThreePresetId;
  readonly label: string;
  readonly description: string;
  readonly background: string;
  readonly ground: string;
  readonly accent: string;
  readonly geometry: 'box' | 'torus-knot' | 'icosahedron' | 'sphere';
  readonly metalness: number;
  readonly roughness: number;
}

export const THREE_PRESETS: readonly ThreePreset[] = [
  {
    id: 'orbit-cube',
    label: 'Órbita de cubo',
    description: 'Cubo metálico con borde de acento y cámara orbital.',
    background: '#0b1220',
    ground: '#111827',
    accent: '#35d6ff',
    geometry: 'box',
    metalness: 0.65,
    roughness: 0.25,
  },
  {
    id: 'torus-dolly',
    label: 'Dolly de toroide',
    description: 'Toroide anudado con dolly out y giro continuo.',
    background: '#120b18',
    ground: '#1b1022',
    accent: '#ff5ea8',
    geometry: 'torus-knot',
    metalness: 0.8,
    roughness: 0.2,
  },
  {
    id: 'sphere-studio',
    label: 'Estudio de esfera',
    description: 'Esfera con luz de estudio en movimiento y cámara fija.',
    background: '#0a1410',
    ground: '#0f1f18',
    accent: '#4ade80',
    geometry: 'sphere',
    metalness: 0.35,
    roughness: 0.35,
  },
  {
    id: 'grid-flythrough',
    label: 'Vuelo sobre grilla',
    description: 'Icosaedro sobre una grilla con cámara que avanza.',
    background: '#101012',
    ground: '#18181b',
    accent: '#fbbf24',
    geometry: 'icosahedron',
    metalness: 0.5,
    roughness: 0.3,
  },
];

export interface ThreeSceneOptions {
  readonly preset: ThreePresetId;
  readonly width: number;
  readonly height: number;
  /** Modelo glTF/GLB local ya convertido a URL de asset. */
  readonly modelUrl?: string;
  /** Nombre o índice del clip de animación a reproducir. */
  readonly animation?: string;
  /** Rótulo 3D (sprite con textura de canvas o texto extruido). */
  readonly text?: string;
  /** Profundidad de extrusión en unidades de escena; sin valor usa sprite. */
  readonly textDepth?: number;
}

export interface ModelBox {
  readonly min: { readonly x: number; readonly y: number; readonly z: number };
  readonly max: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * Encaja un modelo importado en el encuadre: escala por su dimensión mayor y lo
 * apoya sobre el piso, centrado en X/Z. Función pura para poder probarla sin
 * WebGL; el resultado se aplica al nodo del modelo.
 */
export function modelPlacement(box: ModelBox): {
  scale: number;
  offset: { x: number; y: number; z: number };
} {
  const width = Math.max(0, box.max.x - box.min.x);
  const height = Math.max(0, box.max.y - box.min.y);
  const depth = Math.max(0, box.max.z - box.min.z);
  const maxDimension = Math.max(width, height, depth);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    throw new Error('el modelo 3D no tiene geometría visible');
  }
  const scale = 2 / maxDimension;
  const centerX = (box.min.x + box.max.x) / 2;
  const centerZ = (box.min.z + box.max.z) / 2;
  return {
    scale,
    offset: {
      x: -centerX * scale,
      y: -1 - box.min.y * scale,
      z: -centerZ * scale,
    },
  };
}

function disposeObject(root: Object3D): void {
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    for (const entry of list) {
      entry.dispose();
    }
  });
}

export interface ThreeScene {
  readonly preset: ThreePreset;
  /** Clip de animación elegido del glTF, si existe. */
  readonly animation: { readonly name: string; readonly durationSeconds: number } | null;
  /** Nombres de todos los clips disponibles. */
  readonly animations: readonly string[];
  /** Avanza la escena a `progress` (0..1) y devuelve el canvas dibujado. */
  readonly renderAt: (progress: number) => HTMLCanvasElement;
  readonly dispose: () => void;
}

/** Índice del clip pedido (nombre o índice) o -1. Sin pedido usa el primero. */
export function animationIndex(names: readonly string[], requested?: string): number {
  if (names.length === 0) return -1;
  const raw = requested?.trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) {
    const index = Number(raw);
    return index >= 0 && index < names.length ? index : -1;
  }
  return names.indexOf(raw);
}

export function presetById(id: ThreePresetId): ThreePreset {
  return THREE_PRESETS.find((preset) => preset.id === id) ?? THREE_PRESETS[0]!;
}

/** Posición de cámara para cada preset; lineal y determinista. */
export function cameraPosition(
  id: ThreePresetId,
  progress: number,
): { x: number; y: number; z: number } {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (id === 'orbit-cube') {
    const angle = -0.7 + t * 1.4;
    return { x: Math.sin(angle) * 5.4, y: 2.1 + t * 0.4, z: Math.cos(angle) * 5.4 };
  }
  if (id === 'torus-dolly') {
    return { x: Math.sin(-0.3 + t * 0.6) * (4.6 + t * 3.4), y: 1.6 + t * 0.9, z: Math.cos(-0.3 + t * 0.6) * (4.6 + t * 3.4) };
  }
  if (id === 'sphere-studio') {
    return { x: 0.4, y: 1.8, z: 5.6 };
  }
  return { x: Math.sin(t * 0.35) * 1.6, y: 2.8 - t * 1.1, z: 6.2 - t * 3.4 };
}

/** Rotación del objeto por preset (radianes). */
export function objectRotation(id: ThreePresetId, progress: number): { x: number; y: number } {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (id === 'torus-dolly') return { x: 0.4 + t * 1.4, y: t * Math.PI * 1.6 };
  if (id === 'sphere-studio') return { x: 0, y: t * Math.PI * 0.5 };
  if (id === 'grid-flythrough') return { x: t * 0.9, y: t * Math.PI * 1.2 };
  return { x: 0.2 + t * 0.5, y: t * Math.PI };
}

function geometryFor(THREE: typeof import('three'), kind: ThreePreset['geometry']) {
  if (kind === 'torus-knot') return new THREE.TorusKnotGeometry(1, 0.34, 128, 20);
  if (kind === 'icosahedron') return new THREE.IcosahedronGeometry(1.35, 0);
  if (kind === 'sphere') return new THREE.SphereGeometry(1.45, 48, 32);
  return new THREE.BoxGeometry(1.8, 1.8, 1.8);
}

export async function createThreeScene(options: ThreeSceneOptions): Promise<ThreeScene> {
  const width = Math.max(64, Math.round(options.width));
  const height = Math.max(64, Math.round(options.height));
  const preset = presetById(options.preset);
  const THREE = await import('three');
  if (typeof WebGLRenderingContext === 'undefined') {
    throw new Error('Este WebView no soporta WebGL para escenas 3D.');
  }
  let renderer: WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
  } catch {
    throw new Error('No se pudo crear el contexto WebGL de la escena 3D.');
  }
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene: Scene = new THREE.Scene();
  scene.background = new THREE.Color(preset.background);
  scene.fog = new THREE.Fog(new THREE.Color(preset.background), 10, 20);

  const camera: PerspectiveCamera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
  camera.lookAt(0, 0.35, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, preset.ground, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(3.5, 5.5, 4);
  scene.add(key);
  const rim = new THREE.PointLight(new THREE.Color(preset.accent), 14, 18, 2);
  rim.position.set(-3.2, 1.6, -2.4);
  scene.add(rim);

  const group: Group = new THREE.Group();
  scene.add(group);
  let mesh: Mesh | null = null;
  let material: InstanceType<typeof THREE.MeshStandardMaterial> | null = null;
  let edges: InstanceType<typeof THREE.LineSegments> | null = null;
  let model: Object3D | null = null;
  let mixer: AnimationMixer | null = null;
  let animationSeconds = 0;
  let animation: ThreeScene['animation'] = null;
  let animations: readonly string[] = [];
  if (options.modelUrl) {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(options.modelUrl);
      model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const placement = modelPlacement({
        min: { x: box.min.x, y: box.min.y, z: box.min.z },
        max: { x: box.max.x, y: box.max.y, z: box.max.z },
      });
      model.scale.setScalar(placement.scale);
      model.position.set(placement.offset.x, placement.offset.y, placement.offset.z);
      group.add(model);
      animations = gltf.animations.map(
        (clip, index) => clip.name || `animation-${index}`,
      );
      const selectedIndex = animationIndex(animations, options.animation);
      if (options.animation?.trim() && selectedIndex < 0) {
        throw new Error(
          `animación "${options.animation.trim()}" no existe; disponibles: ${
            animations.join(', ') || 'ninguna'
          }`,
        );
      }
      const chosen = selectedIndex >= 0 ? gltf.animations[selectedIndex] : undefined;
      if (chosen) {
        mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(chosen).play();
        animationSeconds = chosen.duration;
        animation = {
          name: chosen.name || animations[gltf.animations.indexOf(chosen)] || 'animation-0',
          durationSeconds: chosen.duration,
        };
      }
    } catch (cause) {
      renderer.dispose();
      const reason = (cause instanceof Error ? cause.message : String(cause)).slice(0, 240);
      throw new Error(
        reason.includes('geometría visible') || reason.startsWith('animación')
          ? reason
          : `No se pudo cargar el modelo 3D importado: ${reason || 'error desconocido'}`,
      );
    }
  } else {
    material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(preset.accent),
      metalness: preset.metalness,
      roughness: preset.roughness,
    });
    mesh = new THREE.Mesh(geometryFor(THREE, preset.geometry), material);
    mesh.position.y = 0.45;
    group.add(mesh);
    edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 24),
      new THREE.LineBasicMaterial({ color: new THREE.Color(preset.accent), transparent: true, opacity: 0.5 }),
    );
    edges.position.copy(mesh.position);
    group.add(edges);
  }

  let textSprite: import('three').Sprite | null = null;
  let textTexture: import('three').CanvasTexture | null = null;
  let textMesh: Mesh | null = null;
  const label = options.text?.trim().slice(0, 120);
  const textDepth = Math.max(0, Math.min(0.6, Number(options.textDepth ?? 0)));
  if (label && textDepth > 0) {
    const { FontLoader } = await import('three/examples/jsm/loaders/FontLoader.js');
    const { TextGeometry } = await import('three/examples/jsm/geometries/TextGeometry.js');
    const font = new FontLoader().parse(
      fontData as unknown as Parameters<InstanceType<typeof FontLoader>['parse']>[0],
    );
    const geometry = new TextGeometry(label, {
      font,
      size: 0.9,
      depth: textDepth,
      curveSegments: 5,
      bevelEnabled: true,
      bevelThickness: 0.018,
      bevelSize: 0.012,
      bevelSegments: 2,
    });
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const span = box ? Math.max(box.max.x - box.min.x, 0.001) : 0.001;
    const scale = Math.min(1, 3.5 / span);
    geometry.scale(scale, scale, scale);
    geometry.center();
    const textMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#f8fafc'),
      metalness: 0.35,
      roughness: 0.28,
      emissive: new THREE.Color(preset.accent),
      emissiveIntensity: 0.16,
    });
    textMesh = new THREE.Mesh(geometry, textMaterial);
    textMesh.position.set(0, 1.78, 0.18);
    scene.add(textMesh);
  } else if (label) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      let fontSize = 108;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      do {
        context.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
        if (context.measureText(label).width <= 940) break;
        fontSize -= 8;
      } while (fontSize > 40);
      context.shadowColor = 'rgba(0, 0, 0, 0.55)';
      context.shadowBlur = 18;
      context.fillStyle = '#f8fafc';
      context.fillText(label, canvas.width / 2, canvas.height / 2);
      context.shadowBlur = 0;
      context.lineWidth = 2;
      context.strokeStyle = preset.accent;
      context.strokeText(label, canvas.width / 2, canvas.height / 2);
      textTexture = new THREE.CanvasTexture(canvas);
      textTexture.colorSpace = THREE.SRGBColorSpace;
      textTexture.minFilter = THREE.LinearFilter;
      textSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: textTexture,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      );
      textSprite.scale.set(3.9, 0.975, 1);
      textSprite.position.set(0, 1.72, 0);
      textSprite.renderOrder = 20;
      scene.add(textSprite);
    }
  }

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(5.2, 64),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(preset.ground), metalness: 0.1, roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.05;
  scene.add(ground);
  const grid = new THREE.GridHelper(10, 20, new THREE.Color(preset.accent), new THREE.Color(preset.ground));
  grid.position.y = -1.04;
  scene.add(grid);

  let disposed = false;

  return {
    preset,
    animation,
    animations,
    renderAt(progress) {
      if (disposed) throw new Error('La escena 3D ya fue liberada.');
      const position = cameraPosition(preset.id, progress);
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(0, 0.35, 0);
      const t = Math.max(0, Math.min(1, progress));
      if (mixer) {
        // Un glTF animado manda: no se suma la rotación automática del preset.
        group.rotation.set(0, 0, 0);
        if (animationSeconds > 0) {
          // Evita el borde exacto del loop (en `duration` el clip vuelve al inicio).
          mixer.setTime(Math.min(animationSeconds * 0.999, t * animationSeconds));
        }
      } else {
        const rotation = objectRotation(preset.id, progress);
        group.rotation.set(rotation.x, rotation.y, 0);
      }
      rim.position.set(
        Math.cos(t * Math.PI * 2) * 4.2,
        1.4 + Math.sin(t * Math.PI) * 2.4,
        Math.sin(t * Math.PI * 2) * 4.2,
      );
      group.position.y = preset.id === 'sphere-studio' ? Math.sin(t * Math.PI * 2) * 0.18 : 0;
      renderer.render(scene, camera);
      return renderer.domElement;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (mixer) {
        mixer.stopAllAction();
        if (model) mixer.uncacheRoot(model);
        mixer = null;
      }
      if (model) disposeObject(model);
      mesh?.geometry.dispose();
      material?.dispose();
      if (edges) {
        edges.geometry.dispose();
        (edges.material as { dispose: () => void }).dispose();
      }
      if (textSprite) {
        scene.remove(textSprite);
        (textSprite.material as { dispose: () => void }).dispose();
      }
      if (textMesh) {
        scene.remove(textMesh);
        textMesh.geometry.dispose();
        (textMesh.material as { dispose: () => void }).dispose();
      }
      textTexture?.dispose();
      ground.geometry.dispose();
      (ground.material as { dispose: () => void }).dispose();
      grid.geometry.dispose();
      renderer.dispose();
    },
  };
}
