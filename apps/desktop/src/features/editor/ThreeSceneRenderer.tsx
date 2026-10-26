import { useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import type * as THREE from 'three';

export interface ThreeSceneRendererProps {
  readonly width?: number;
  readonly height?: number;
  readonly rotationDeg?: [number, number, number];
  readonly scale?: number;
  readonly modelUrl?: string;
}

function Box3D({ rotationDeg = [0, 0, 0], scale = 1 }: { rotationDeg: [number, number, number]; scale: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (!meshRef.current) return;
    // Smooth interpolation demo
    meshRef.current.rotation.x += (Math.sin(state.clock.getElapsedTime()) * 0.1) / 60;
  });

  return (
    <mesh ref={meshRef} position={[0, 0, 0]} scale={[scale, scale, scale]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#2a9df8" metalness={0.5} roughness={0.4} />
    </mesh>
  );
}

export function ThreeSceneRenderer({
  width = 400,
  height = 400,
  rotationDeg = [0, 0, 0],
  scale = 1,
}: ThreeSceneRendererProps) {
  const glRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!glRef.current) return;
    const gl = glRef.current.getContext('webgl2');
    if (gl) {
      console.log('WebGL2 context created for 3D preview');
    }
  }, []);

  return (
    <div style={{ width, height, background: '#1a1a1a', borderRadius: 8, overflow: 'hidden' }}>
      <Canvas shadows camera={{ position: [0, 0, 5], fov: 45 }}>
        <PerspectiveCamera makeDefault position={[0, 0, 5]} />
        <OrbitControls enableZoom={false} autoRotate />
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        <directionalLight position={[5, 10, 5]} intensity={1} castShadow />
        <Box3D rotationDeg={rotationDeg} scale={scale} />
      </Canvas>
      <canvas ref={glRef} style={{ display: 'none' }} />
    </div>
  );
}
