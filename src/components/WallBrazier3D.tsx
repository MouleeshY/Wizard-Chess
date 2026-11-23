import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { playBrazierWhoosh } from '../utils/soundEffects';

interface WallBrazier3DProps {
  position: [number, number, number];
  rotationY?: number;
  seed?: number;
  ignited?: boolean;
  igniteDelay?: number;
  standalone?: boolean;
}

const PARTICLE_COUNT = 18;

function smoothNoise1D(t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = Math.sin(i * 127.1) * 43758.5453;
  const b = Math.sin((i + 1) * 127.1) * 43758.5453;
  const ha = a - Math.floor(a);
  const hb = b - Math.floor(b);
  return ha + (hb - ha) * u;
}

function fbmNoise1D(t: number): number {
  return (
    smoothNoise1D(t) * 0.55 +
    smoothNoise1D(t * 2.3 + 17.1) * 0.3 +
    smoothNoise1D(t * 5.1 + 43.7) * 0.15
  );
}

interface FlameParticle {
  offset: number;
  speed: number;
  radius: number;
  angle: number;
  swirl: number;
  baseScale: number;
}

export function WallBrazier3D({
  position,
  rotationY = 0,
  seed = 1,
  ignited = true,
  igniteDelay = 0,
  standalone = false,
}: WallBrazier3DProps) {
  const bowlZ = standalone ? 0 : 0.38;
  const lightRef = useRef<THREE.PointLight>(null);
  const emberRef = useRef<THREE.MeshStandardMaterial>(null);
  const flameMeshRef = useRef<THREE.InstancedMesh>(null);

  const igniteStartRef = useRef<number | null>(null);
  const whooshPlayedRef = useRef(false);
  const intensityLevelRef = useRef(ignited ? 1 : 0.12);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    if (!ignited) {
      igniteStartRef.current = null;
      whooshPlayedRef.current = false;
      intensityLevelRef.current = 0.12;
    } else if (igniteStartRef.current === null) {
      igniteStartRef.current = -1; // armed to capture clock time on next frame
    }
  }, [ignited]);

  const particles = useMemo<FlameParticle[]>(() => {
    return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const h1 = Math.abs(Math.sin((i + 1) * 12.9898 + seed * 78.233));
      const h2 = Math.abs(Math.sin((i + 1) * 93.989 + seed * 19.13));
      const h3 = Math.abs(Math.sin((i + 1) * 45.164 + seed * 51.7));
      return {
        offset: i / PARTICLE_COUNT + (h1 % 0.12),
        speed: 0.75 + (h2 % 0.55),
        radius: 0.03 + (h3 % 0.16),
        angle: h1 * Math.PI * 2,
        swirl: 1.5 + (h2 % 2.5),
        baseScale: 0.8 + (h3 % 0.65),
      };
    });
  }, [seed]);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();
    const dt = Math.min(delta, 0.05);

    if (ignited) {
      if (igniteStartRef.current === -1) {
        igniteStartRef.current = t;
      }
      const sinceArm = t - (igniteStartRef.current ?? t);
      if (sinceArm >= igniteDelay) {
        if (!whooshPlayedRef.current) {
          whooshPlayedRef.current = true;
          playBrazierWhoosh(0.85 + (seed % 4) * 0.09);
        }
        const surge = Math.min((sinceArm - igniteDelay) / 0.35, 1);
        const target = surge < 0.6 ? 1.35 : 1.0;
        intensityLevelRef.current = THREE.MathUtils.damp(
          intensityLevelRef.current,
          target,
          8,
          dt
        );
      }
    }

    const level = intensityLevelRef.current;
    const flicker = fbmNoise1D(t * 6.5 + seed * 13.7);

    if (lightRef.current) {
      lightRef.current.intensity = (10.5 + (flicker - 0.5) * 9.5) * level;
      lightRef.current.position.x = (flicker - 0.5) * 0.08;
      lightRef.current.position.y = 0.7 + (flicker - 0.5) * 0.08;
    }

    if (emberRef.current) {
      emberRef.current.emissiveIntensity = (2.0 + flicker * 1.4) * Math.max(0.35, level);
    }

    const mesh = flameMeshRef.current;
    if (!mesh) return;

    const flameScaleFactor = Math.max(0.18, level);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i];
      const life = (t * p.speed + p.offset) % 1;

      const rise = life * 0.82 * flameScaleFactor;
      const inward = 1 - life * 0.72;
      const wobble = Math.sin(t * 7 + p.angle + life * 5) * 0.055 * life;
      const angle = p.angle + t * p.swirl * 0.45;

      dummy.position.set(
        Math.cos(angle) * p.radius * inward + wobble,
        0.3 + rise,
        bowlZ + Math.sin(angle) * p.radius * inward
      );

      const scaleCurve = Math.sin(life * Math.PI) * flameScaleFactor;
      const sx = p.baseScale * scaleCurve * (1 - life * 0.35);
      const sy = p.baseScale * scaleCurve * (1.25 + life * 0.45);
      dummy.scale.set(sx, sy, sx);
      dummy.rotation.set(wobble * 2, angle, -wobble * 2);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      if (life < 0.35) {
        tempColor.setRGB(3.2, 2.2, 0.75);
      } else if (life < 0.72) {
        tempColor.setRGB(2.8, 1.05, 0.2);
      } else {
        tempColor.setRGB(1.6, 0.32, 0.05);
      }
      mesh.setColorAt(i, tempColor);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {!standalone && (
        <>
          <mesh position={[0, 0, 0.04]} castShadow>
            <boxGeometry args={[0.26, 0.56, 0.08]} />
            <meshStandardMaterial color="#1d1e22" roughness={0.65} metalness={0.75} />
          </mesh>
          <mesh position={[0, 0.08, 0.22]} castShadow>
            <boxGeometry args={[0.1, 0.1, 0.36]} />
            <meshStandardMaterial color="#1d1e22" roughness={0.65} metalness={0.75} />
          </mesh>
          <mesh position={[0, -0.09, 0.19]} rotation={[-0.65, 0, 0]} castShadow>
            <boxGeometry args={[0.07, 0.07, 0.38]} />
            <meshStandardMaterial color="#1d1e22" roughness={0.65} metalness={0.75} />
          </mesh>
        </>
      )}

      <mesh position={[0, 0.17, bowlZ]} castShadow receiveShadow>
        <cylinderGeometry args={[0.34, 0.16, 0.24, 12]} />
        <meshStandardMaterial color="#25272d" roughness={0.6} metalness={0.55} />
      </mesh>
      <mesh position={[0, 0.29, bowlZ]}>
        <cylinderGeometry args={[0.37, 0.35, 0.055, 12]} />
        <meshStandardMaterial color="#1b1c20" roughness={0.5} metalness={0.75} />
      </mesh>

      <mesh position={[0, 0.28, bowlZ]}>
        <cylinderGeometry args={[0.27, 0.24, 0.05, 12]} />
        <meshStandardMaterial
          ref={emberRef}
          color="#ff4800"
          emissive="#ff5e14"
          emissiveIntensity={2.2}
          toneMapped={false}
          roughness={0.8}
        />
      </mesh>

      <pointLight
        ref={lightRef}
        position={[0, 0.7, bowlZ + 0.04]}
        color="#ff7e2e"
        intensity={10.5}
        distance={23}
        decay={1.4}
      />

      <instancedMesh
        ref={flameMeshRef}
        args={[undefined, undefined, PARTICLE_COUNT]}
        frustumCulled={false}
      >
        <coneGeometry args={[0.08, 0.24, 6]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
