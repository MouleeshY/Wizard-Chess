import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface DustBurstHandle {
  emit: (
    x: number,
    y: number,
    z: number,
    count: number,
    spread?: number,
    upwardSpeed?: number
  ) => void;
}

interface DustParticle {
  active: boolean;
  age: number;
  maxAge: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  rotSpeed: THREE.Vector3;
  baseScale: number;
  shade: number;
}

const MAX_DUST = 160;

export const DustBurstSystem = forwardRef<DustBurstHandle>(
  function DustBurstSystem(_, ref) {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const cursorRef = useRef(0);
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const tempColor = useMemo(() => new THREE.Color(), []);

    const particles = useMemo<DustParticle[]>(() => {
      return Array.from({ length: MAX_DUST }, () => ({
        active: false,
        age: 0,
        maxAge: 0.5,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        rotSpeed: new THREE.Vector3(),
        baseScale: 1,
        shade: 1,
      }));
    }, []);

    useImperativeHandle(ref, () => ({
      emit(x, y, z, count, spread = 0.28, upwardSpeed = 0.75) {
        for (let i = 0; i < count; i++) {
          const idx = cursorRef.current;
          cursorRef.current = (cursorRef.current + 1) % MAX_DUST;

          const p = particles[idx];
          const angle = Math.random() * Math.PI * 2;
          const radialOffset = 0.1 + Math.random() * spread;
          const radialSpeed = 0.35 + Math.random() * 1.15;

          p.active = true;
          p.age = 0;
          p.maxAge = 0.36 + Math.random() * 0.42;
          p.pos.set(
            x + Math.cos(angle) * radialOffset,
            y + Math.random() * 0.08,
            z + Math.sin(angle) * radialOffset
          );
          p.vel.set(
            Math.cos(angle) * radialSpeed,
            upwardSpeed * (0.45 + Math.random() * 0.9),
            Math.sin(angle) * radialSpeed
          );
          p.rot.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
          );
          p.rotSpeed.set(
            (Math.random() - 0.5) * 6,
            (Math.random() - 0.5) * 6,
            (Math.random() - 0.5) * 6
          );
          p.baseScale = 0.55 + Math.random() * 0.95;
          p.shade = 0.68 + Math.random() * 0.32;
        }
      },
    }));

    useFrame((_, delta) => {
      const mesh = meshRef.current;
      if (!mesh) return;

      const dt = Math.min(delta, 0.05);
      let anyUpdated = false;

      for (let i = 0; i < MAX_DUST; i++) {
        const p = particles[i];
        if (!p.active) {
          dummy.scale.set(0, 0, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          continue;
        }

        anyUpdated = true;
        p.age += dt;
        if (p.age >= p.maxAge) {
          p.active = false;
          dummy.scale.set(0, 0, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          continue;
        }

        const life = p.age / p.maxAge;
        p.vel.multiplyScalar(1 - dt * 2.6);
        p.vel.y -= dt * 1.1;
        p.pos.addScaledVector(p.vel, dt);
        if (p.pos.y < 0.02) {
          p.pos.y = 0.02;
          p.vel.y = Math.abs(p.vel.y) * 0.25;
        }

        p.rot.x += p.rotSpeed.x * dt;
        p.rot.y += p.rotSpeed.y * dt;
        p.rot.z += p.rotSpeed.z * dt;

        const scale = p.baseScale * Math.sin(life * Math.PI);
        dummy.position.copy(p.pos);
        dummy.rotation.copy(p.rot);
        dummy.scale.setScalar(Math.max(0, scale));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        const c = p.shade * (1 - life * 0.25);
        tempColor.setRGB(c * 0.78, c * 0.74, c * 0.68);
        mesh.setColorAt(i, tempColor);
      }

      if (anyUpdated) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          mesh.instanceColor.needsUpdate = true;
        }
      }
    });

    return (
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, MAX_DUST]}
        frustumCulled={false}
      >
        <dodecahedronGeometry args={[0.075, 0]} />
        <meshStandardMaterial
          color="#ffffff"
          roughness={0.95}
          metalness={0.02}
          transparent
          opacity={0.78}
          depthWrite={false}
        />
      </instancedMesh>
    );
  }
);
