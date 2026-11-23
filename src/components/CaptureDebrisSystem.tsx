import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBox, usePlane } from '@react-three/cannon';
import type { Color } from 'chess.js';
import * as THREE from 'three';
import type { DebrisBurstData } from '../game/chessTypes';
import {
  getMarbleTextures,
  getObsidianTextures,
} from '../utils/proceduralTextures';
import {
  playDebrisClatterSequence,
  playRockShatter,
} from '../utils/soundEffects';

const SHARD_COUNT = 34;
const FADE_START = 2.55;
const FADE_END = 3.45;

export function BoardPhysicsColliders() {
  // Board top slab (top face at y = 0)
  useBox(() => ({
    type: 'Static',
    position: [0, -0.07, 0],
    args: [8.75, 0.14, 8.75],
  }));

  // Carved stone altar plinth beneath the board
  useBox(() => ({
    type: 'Static',
    position: [0, -0.38, 0],
    args: [8.55, 0.56, 8.55],
  }));

  // Raised arena terrace curbs framing the sunken graveyard trench (top at y = -0.45)
  useBox(() => ({
    type: 'Static',
    position: [0, -0.75, -10.4],
    args: [36, 0.6, 8.8],
  }));
  useBox(() => ({
    type: 'Static',
    position: [0, -0.75, 11.2],
    args: [36, 0.6, 10.4],
  }));
  useBox(() => ({
    type: 'Static',
    position: [-11.8, -0.75, 0],
    args: [11.6, 0.6, 12.4],
  }));
  useBox(() => ({
    type: 'Static',
    position: [11.8, -0.75, 0],
    args: [11.6, 0.6, 12.4],
  }));

  // Sunken graveyard trench floor (top at y = -0.62)
  usePlane(() => ({
    type: 'Static',
    position: [0, -0.62, 0],
    rotation: [-Math.PI / 2, 0, 0],
  }));

  return null;
}

interface ShardSpec {
  id: number;
  shape: 'dodeca' | 'tetra' | 'slab';
  dims: [number, number, number];
  spawnOffset: [number, number, number];
  velocity: [number, number, number];
  angularVelocity: [number, number, number];
  rotation: [number, number, number];
}

function PhysicsStoneShard({
  spec,
  origin,
  material,
}: {
  spec: ShardSpec;
  origin: [number, number, number];
  material: THREE.MeshPhysicalMaterial;
}) {
  const [ref] = useBox<THREE.Mesh>(() => ({
    mass: 0.28,
    args: spec.dims,
    position: [
      origin[0] + spec.spawnOffset[0],
      origin[1] + spec.spawnOffset[1],
      origin[2] + spec.spawnOffset[2],
    ],
    rotation: spec.rotation,
    velocity: spec.velocity,
    angularVelocity: spec.angularVelocity,
    linearDamping: 0.16,
    angularDamping: 0.22,
  }));

  return (
    <mesh
      ref={ref}
      castShadow
      receiveShadow
      material={material}
      scale={spec.shape === 'slab' ? [1, 1, 1] : [spec.dims[0], spec.dims[1], spec.dims[2]]}
    >
      {spec.shape === 'dodeca' ? (
        <dodecahedronGeometry args={[0.68, 0]} />
      ) : spec.shape === 'tetra' ? (
        <tetrahedronGeometry args={[0.78, 0]} />
      ) : (
        <boxGeometry args={spec.dims} />
      )}
    </mesh>
  );
}

function createBurstMaterial(color: Color): THREE.MeshPhysicalMaterial {
  const textures =
    color === 'w' ? getMarbleTextures() : getObsidianTextures();

  return new THREE.MeshPhysicalMaterial({
    color: color === 'w' ? '#ece4d4' : '#353a45',
    map: textures.map,
    bumpMap: textures.bumpMap,
    bumpScale: color === 'w' ? 0.016 : 0.02,
    roughnessMap: textures.roughnessMap,
    roughness: color === 'w' ? 0.52 : 0.65,
    metalness: color === 'w' ? 0.05 : 0.16,
    clearcoat: color === 'w' ? 0.3 : 0.38,
    clearcoatRoughness: color === 'w' ? 0.28 : 0.22,
    transparent: true,
    opacity: 1,
  });
}

function CaptureDebrisBurst({
  burst,
  onExpired,
}: {
  burst: DebrisBurstData;
  onExpired: (id: number) => void;
}) {
  const ageRef = useRef(0);
  const expiredRef = useRef(false);
  const material = useMemo(
    () => createBurstMaterial(burst.color),
    [burst.color]
  );

  useEffect(() => {
    playRockShatter();
    playDebrisClatterSequence();
    return () => {
      material.dispose();
    };
  }, [material]);

  const shards = useMemo<ShardSpec[]>(() => {
    const [dirX, dirZ] = burst.strikeDir;
    const shapes: ShardSpec['shape'][] = ['dodeca', 'tetra', 'slab'];
    return Array.from({ length: SHARD_COUNT }, (_, i) => {
      const angle =
        (i / SHARD_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.48;
      const radialRadius = 0.06 + Math.random() * 0.22;
      const heightBand = 0.1 + Math.random() * 0.88;
      const speed = 2.8 + Math.random() * 4.8;
      const strikeBias = 1.6 + Math.random() * 2.4;

      return {
        id: i,
        shape: shapes[i % 3],
        dims: [
          0.08 + Math.random() * 0.14,
          0.07 + Math.random() * 0.14,
          0.08 + Math.random() * 0.14,
        ],
        spawnOffset: [
          Math.cos(angle) * radialRadius,
          heightBand,
          Math.sin(angle) * radialRadius,
        ],
        velocity: [
          Math.cos(angle) * speed + dirX * strikeBias,
          3.1 + Math.random() * 5.2,
          Math.sin(angle) * speed + dirZ * strikeBias,
        ],
        angularVelocity: [
          (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 20,
        ],
        rotation: [
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI,
        ],
      };
    });
  }, [burst.id, burst.strikeDir]);

  useFrame((_, delta) => {
    if (expiredRef.current) return;

    ageRef.current += Math.min(delta, 0.05);
    if (ageRef.current >= FADE_START) {
      const fadeProgress = Math.min(
        (ageRef.current - FADE_START) / (FADE_END - FADE_START),
        1
      );
      material.opacity = 1 - fadeProgress;
      if (material.depthWrite) {
        material.depthWrite = false;
      }
    }

    if (ageRef.current >= FADE_END) {
      expiredRef.current = true;
      onExpired(burst.id);
    }
  });

  return (
    <group>
      {shards.map((shard) => (
        <PhysicsStoneShard
          key={shard.id}
          spec={shard}
          origin={burst.position}
          material={material}
        />
      ))}
    </group>
  );
}

export function CaptureDebrisSystem({
  bursts,
  onBurstExpired,
}: {
  bursts: DebrisBurstData[];
  onBurstExpired: (id: number) => void;
}) {
  return (
    <group>
      <BoardPhysicsColliders />
      {bursts.map((burst) => (
        <CaptureDebrisBurst
          key={burst.id}
          burst={burst}
          onExpired={onBurstExpired}
        />
      ))}
    </group>
  );
}
