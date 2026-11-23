import { forwardRef, useImperativeHandle, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface ImpactFlashHandle {
  trigger: (x: number, y: number, z: number) => void;
}

const FLASH_DURATION = 0.38;

export const ImpactFlashSystem = forwardRef<ImpactFlashHandle>(
  function ImpactFlashSystem(_, ref) {
    const groupRef = useRef<THREE.Group>(null);
    const lightRef = useRef<THREE.PointLight>(null);
    const sphereRef = useRef<THREE.Mesh>(null);
    const sphereMatRef = useRef<THREE.MeshBasicMaterial>(null);
    const ringRef = useRef<THREE.Mesh>(null);
    const ringMatRef = useRef<THREE.MeshBasicMaterial>(null);

    const ageRef = useRef(FLASH_DURATION + 1);

    useImperativeHandle(ref, () => ({
      trigger(x, y, z) {
        ageRef.current = 0;
        if (groupRef.current) {
          groupRef.current.position.set(x, y, z);
          groupRef.current.visible = true;
        }
      },
    }));

    useFrame((_, delta) => {
      if (ageRef.current > FLASH_DURATION) {
        if (groupRef.current && groupRef.current.visible) {
          groupRef.current.visible = false;
        }
        return;
      }

      const dt = Math.min(delta, 0.05);
      ageRef.current += dt;
      const t = Math.min(ageRef.current / FLASH_DURATION, 1);
      const fade = Math.pow(1 - t, 2.2);

      if (lightRef.current) {
        lightRef.current.intensity = 28 * fade;
      }

      if (sphereRef.current && sphereMatRef.current) {
        const s = 0.25 + t * 0.95;
        sphereRef.current.scale.setScalar(s);
        sphereMatRef.current.opacity = 0.9 * fade;
      }

      if (ringRef.current && ringMatRef.current) {
        const rs = 0.35 + t * 1.75;
        ringRef.current.scale.setScalar(rs);
        ringMatRef.current.opacity = 0.85 * fade;
      }
    });

    return (
      <group ref={groupRef} visible={false}>
        <pointLight
          ref={lightRef}
          position={[0, 0.45, 0]}
          color="#ffba5c"
          intensity={0}
          distance={10}
          decay={1.6}
        />
        <mesh ref={sphereRef} position={[0, 0.38, 0]}>
          <sphereGeometry args={[0.45, 16, 16]} />
          <meshBasicMaterial
            ref={sphereMatRef}
            color="#ffdca8"
            transparent
            opacity={0}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
        <mesh
          ref={ringRef}
          position={[0, 0.05, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.35, 0.52, 28]} />
          <meshBasicMaterial
            ref={ringMatRef}
            color="#ff9b3d"
            transparent
            opacity={0}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      </group>
    );
  }
);
