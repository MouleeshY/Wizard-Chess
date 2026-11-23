import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  cloneTexturesWithRepeat,
  getChamberStoneTextures,
  getOakWoodTextures,
  type StoneTextureSet,
} from '../utils/proceduralTextures';
import { WallBrazier3D } from './WallBrazier3D';
import { playDoorUnlock } from '../utils/soundEffects';

interface StoneChamber3DProps {
  hasStarted: boolean;
  isDoorUnlocked: boolean;
}

function StoneMaterial({
  textures,
  color = '#7f8591',
  roughness = 0.88,
  bumpScale = 0.045,
}: {
  textures: StoneTextureSet;
  color?: string;
  roughness?: number;
  bumpScale?: number;
}) {
  return (
    <meshStandardMaterial
      color={color}
      map={textures.map}
      bumpMap={textures.bumpMap}
      bumpScale={bumpScale}
      roughnessMap={textures.roughnessMap}
      roughness={roughness}
      metalness={0.08}
    />
  );
}

function GothicPillar({
  position,
  height = 8.4,
  scaleXZ = 1,
  textures,
  capTextures,
}: {
  position: [number, number, number];
  height?: number;
  scaleXZ?: number;
  textures: StoneTextureSet;
  capTextures: StoneTextureSet;
}) {
  const shaftHeight = height - 1.5;

  return (
    <group position={position} scale={[scaleXZ, 1, scaleXZ]}>
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.65, 0.5, 1.65]} />
        <StoneMaterial textures={capTextures} color="#686d78" />
      </mesh>
      <mesh position={[0, 0.65, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.35, 0.35, 1.35]} />
        <StoneMaterial textures={capTextures} color="#727884" />
      </mesh>
      <mesh position={[0, 0.92, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.58, 0.66, 0.22, 16]} />
        <StoneMaterial textures={capTextures} color="#767c88" />
      </mesh>

      <mesh position={[0, 1.0 + shaftHeight / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.48, 0.52, shaftHeight, 16]} />
        <StoneMaterial textures={textures} color="#79808c" />
      </mesh>

      {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((angle, idx) => (
        <mesh
          key={idx}
          position={[
            Math.cos(angle) * 0.48,
            1.0 + shaftHeight / 2,
            Math.sin(angle) * 0.48,
          ]}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[0.14, 0.15, shaftHeight, 12]} />
          <StoneMaterial textures={textures} color="#828894" />
        </mesh>
      ))}

      <mesh position={[0, height - 0.42, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.74, 0.52, 0.48, 16]} />
        <StoneMaterial textures={capTextures} color="#7a808d" />
      </mesh>
      <mesh position={[0, height - 0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.55, 0.24, 1.55]} />
        <StoneMaterial textures={capTextures} color="#6c727e" />
      </mesh>
    </group>
  );
}

function PointedGothicArch({
  position,
  rotationY = 0,
  span = 7.0,
  springY = 6.2,
  rise = 3.2,
  textures,
}: {
  position: [number, number, number];
  rotationY?: number;
  span?: number;
  springY?: number;
  rise?: number;
  textures: StoneTextureSet;
}) {
  const segmentsPerSide = 6;
  const halfSpan = span / 2;

  const archBlocks = useMemo(() => {
    const items: {
      pos: [number, number, number];
      rotZ: number;
      len: number;
    }[] = [];

    for (const side of [-1, 1]) {
      for (let i = 0; i < segmentsPerSide; i++) {
        const t0 = i / segmentsPerSide;
        const t1 = (i + 1) / segmentsPerSide;
        const tm = (t0 + t1) / 2;

        const x0 = side * halfSpan * (1 - t0);
        const x1 = side * halfSpan * (1 - t1);
        const y0 = rise * Math.sin((t0 * Math.PI) / 2);
        const y1 = rise * Math.sin((t1 * Math.PI) / 2);

        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy) + 0.08;
        const angle = Math.atan2(dy, dx);

        items.push({
          pos: [side * halfSpan * (1 - tm), (y0 + y1) / 2, 0],
          rotZ: angle,
          len,
        });
      }
    }
    return items;
  }, [halfSpan, rise]);

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <group position={[0, springY, 0]}>
        {archBlocks.map((b, idx) => (
          <mesh
            key={idx}
            position={b.pos}
            rotation={[0, 0, b.rotZ]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[b.len, 0.52, 0.88]} />
            <StoneMaterial textures={textures} color="#767c89" />
          </mesh>
        ))}

        <mesh position={[0, rise + 0.08, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.52, 0.72, 1.02]} />
          <StoneMaterial textures={textures} color="#8a909d" />
        </mesh>

        <mesh position={[0, rise + 0.75, 0]} receiveShadow>
          <boxGeometry args={[span + 0.6, 0.7, 0.95]} />
          <StoneMaterial textures={textures} color="#5d636e" />
        </mesh>
      </group>
    </group>
  );
}

function DungeonExitDoor({
  isUnlocked,
  stoneTextures,
}: {
  isUnlocked: boolean;
  stoneTextures: StoneTextureSet;
}) {
  const oakTex = useMemo(() => getOakWoodTextures(), []);
  const leftLeafRef = useRef<THREE.Group>(null);
  const rightLeafRef = useRef<THREE.Group>(null);
  const boltRef = useRef<THREE.Mesh>(null);
  const portalLightRef = useRef<THREE.PointLight>(null);
  const soundPlayedRef = useRef(false);

  useEffect(() => {
    if (isUnlocked && !soundPlayedRef.current) {
      soundPlayedRef.current = true;
      playDoorUnlock();
    } else if (!isUnlocked) {
      soundPlayedRef.current = false;
    }
  }, [isUnlocked]);

  const doorHeight = 4.8;
  const leafWidth = 1.65;
  const doorSpotTarget = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(0, -0.4, 4);
    return o;
  }, []);

  const goldenBeamRef = useRef<THREE.Mesh>(null);
  const goldenSpotRef = useRef<THREE.SpotLight>(null);

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.05);
    const targetAngle = isUnlocked ? 1.18 : 0;
    const targetBoltX = isUnlocked ? 1.58 : 0;
    const targetLight = isUnlocked ? 26 : 0;
    const targetSpot = isUnlocked ? 48 : 0;

    if (leftLeafRef.current) {
      leftLeafRef.current.rotation.y = THREE.MathUtils.damp(
        leftLeafRef.current.rotation.y,
        -targetAngle,
        2.2,
        dt
      );
    }
    if (rightLeafRef.current) {
      rightLeafRef.current.rotation.y = THREE.MathUtils.damp(
        rightLeafRef.current.rotation.y,
        targetAngle,
        2.2,
        dt
      );
    }
    if (boltRef.current) {
      boltRef.current.position.x = THREE.MathUtils.damp(
        boltRef.current.position.x,
        targetBoltX,
        4.5,
        dt
      );
    }
    if (portalLightRef.current) {
      portalLightRef.current.intensity = THREE.MathUtils.damp(
        portalLightRef.current.intensity,
        targetLight,
        2.6,
        dt
      );
    }
    if (goldenSpotRef.current) {
      goldenSpotRef.current.intensity = THREE.MathUtils.damp(
        goldenSpotRef.current.intensity,
        targetSpot,
        2.2,
        dt
      );
    }
    if (goldenBeamRef.current) {
      const mat = goldenBeamRef.current.material as THREE.MeshBasicMaterial;
      const shimmer = 1 + Math.sin(clock.getElapsedTime() * 2.5) * 0.06;
      mat.opacity = THREE.MathUtils.damp(
        mat.opacity,
        isUnlocked ? 0.14 * shimmer : 0,
        2.4,
        dt
      );
    }
  });

  return (
    <group position={[0, -0.45, -13.15]}>
      <primitive object={doorSpotTarget} />

      {/* Flanking colossal stone columns */}
      <GothicPillar
        position={[-2.5, 0, 0.45]}
        height={7.0}
        scaleXZ={1.18}
        textures={stoneTextures}
        capTextures={stoneTextures}
      />
      <GothicPillar
        position={[2.5, 0, 0.45]}
        height={7.0}
        scaleXZ={1.18}
        textures={stoneTextures}
        capTextures={stoneTextures}
      />

      {/* Sculpted Gothic pointed archway + keystone crest framing the doors */}
      <PointedGothicArch
        position={[0, 0, 0.3]}
        span={3.7}
        springY={4.2}
        rise={1.65}
        textures={stoneTextures}
      />
      <mesh position={[0, doorHeight + 0.85, 0.42]} castShadow receiveShadow>
        <boxGeometry args={[0.62, 0.78, 0.36]} />
        <StoneMaterial textures={stoneTextures} color="#8c929f" />
      </mesh>
      <mesh position={[0, doorHeight + 0.45, 0.2]} castShadow receiveShadow>
        <boxGeometry args={[4.6, 0.75, 0.9]} />
        <StoneMaterial textures={stoneTextures} color="#636975" />
      </mesh>

      {/* Radiant warm golden-amber sanctuary revealed when doors unlock */}
      <mesh position={[0, doorHeight / 2, -0.58]}>
        <planeGeometry args={[3.5, doorHeight + 0.3]} />
        <meshBasicMaterial color="#ffe19e" toneMapped={false} />
      </mesh>
      <pointLight
        ref={portalLightRef}
        position={[0, 2.4, -0.15]}
        color="#ffbe5c"
        intensity={0}
        distance={18}
        decay={1.35}
      />
      <spotLight
        ref={goldenSpotRef}
        position={[0, 3.2, -0.4]}
        target={doorSpotTarget}
        angle={0.58}
        penumbra={0.65}
        intensity={0}
        distance={28}
        decay={1.3}
        color="#ffba4d"
      />
      {/* Volumetric golden light shaft pouring into the chamber */}
      <mesh
        ref={goldenBeamRef}
        position={[0, 2.1, 4.6]}
        rotation={[Math.PI / 2 + 0.14, 0, 0]}
      >
        <coneGeometry args={[3.6, 10.5, 24, 1, true]} />
        <meshBasicMaterial
          color="#ffc566"
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Left oak door leaf (hinged at x = -1.65) */}
      <group ref={leftLeafRef} position={[-leafWidth, 0, 0.1]}>
        <mesh position={[leafWidth / 2, doorHeight / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[leafWidth - 0.04, doorHeight, 0.24]} />
          <meshStandardMaterial
            color="#6f533b"
            map={oakTex.map}
            bumpMap={oakTex.bumpMap}
            bumpScale={0.038}
            roughnessMap={oakTex.roughnessMap}
            roughness={0.76}
            metalness={0.06}
          />
        </mesh>
        {[0.75, 1.85, 3.0, 4.05].map((bandY, idx) => (
          <mesh key={idx} position={[leafWidth / 2, bandY, 0.13]} castShadow>
            <boxGeometry args={[leafWidth - 0.08, 0.14, 0.05]} />
            <meshStandardMaterial color="#1d2026" roughness={0.42} metalness={0.84} />
          </mesh>
        ))}
        <mesh position={[leafWidth - 0.24, 2.1, 0.18]}>
          <torusGeometry args={[0.14, 0.034, 8, 16]} />
          <meshStandardMaterial color="#4a4e59" roughness={0.35} metalness={0.86} />
        </mesh>
      </group>

      {/* Right oak door leaf (hinged at x = +1.65) */}
      <group ref={rightLeafRef} position={[leafWidth, 0, 0.1]}>
        <mesh position={[-leafWidth / 2, doorHeight / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[leafWidth - 0.04, doorHeight, 0.24]} />
          <meshStandardMaterial
            color="#6f533b"
            map={oakTex.map}
            bumpMap={oakTex.bumpMap}
            bumpScale={0.038}
            roughnessMap={oakTex.roughnessMap}
            roughness={0.76}
            metalness={0.06}
          />
        </mesh>
        {[0.75, 1.85, 3.0, 4.05].map((bandY, idx) => (
          <mesh key={idx} position={[-leafWidth / 2, bandY, 0.13]} castShadow>
            <boxGeometry args={[leafWidth - 0.08, 0.14, 0.05]} />
            <meshStandardMaterial color="#1d2026" roughness={0.42} metalness={0.84} />
          </mesh>
        ))}
        <mesh position={[-leafWidth + 0.24, 2.1, 0.18]}>
          <torusGeometry args={[0.14, 0.034, 8, 16]} />
          <meshStandardMaterial color="#4a4e59" roughness={0.35} metalness={0.86} />
        </mesh>
      </group>

      {/* Heavy iron lock bar */}
      <mesh ref={boltRef} position={[0, 2.1, 0.28]} castShadow>
        <boxGeometry args={[1.45, 0.15, 0.08]} />
        <meshStandardMaterial color="#252830" roughness={0.4} metalness={0.86} />
      </mesh>
    </group>
  );
}

function StandingFireBowl({
  position,
  seed,
  ignited,
  igniteDelay,
  stoneTextures,
}: {
  position: [number, number, number];
  seed: number;
  ignited: boolean;
  igniteDelay: number;
  stoneTextures: StoneTextureSet;
}) {
  return (
    <group position={position}>
      <mesh position={[0, 0.35, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.32, 0.44, 0.7, 12]} />
        <StoneMaterial textures={stoneTextures} color="#585e6b" />
      </mesh>
      <WallBrazier3D
        position={[0, 0.72, 0]}
        rotationY={0}
        seed={seed}
        ignited={ignited}
        igniteDelay={igniteDelay}
        standalone
      />
    </group>
  );
}

function GraveyardTrenchRubble({
  stoneTextures,
}: {
  stoneTextures: StoneTextureSet;
}) {
  const rubbleSpecs = useMemo(() => {
    const items: {
      pos: [number, number, number];
      rot: [number, number, number];
      scale: [number, number, number];
    }[] = [];
    // Deterministic stone fragments scattered inside the sunken perimeter trench
    for (let i = 0; i < 28; i++) {
      const side = i % 4;
      const along = (((i * 37) % 100) / 100 - 0.5) * 10.6;
      const depth = 4.75 + (((i * 53) % 100) / 100) * 1.1;
      const x = side === 0 ? -depth : side === 1 ? depth : along;
      const z = side === 2 ? -depth : side === 3 ? depth : along;
      const s = 0.09 + ((i * 19) % 10) * 0.015;
      items.push({
        pos: [x, -0.56, z],
        rot: [(i * 0.7) % Math.PI, (i * 1.3) % Math.PI, (i * 0.5) % Math.PI],
        scale: [s * 1.3, s * 0.75, s * 1.1],
      });
    }
    return items;
  }, []);

  return (
    <group>
      {rubbleSpecs.map((r, i) => (
        <mesh
          key={i}
          position={r.pos}
          rotation={r.rot}
          scale={r.scale}
          castShadow
          receiveShadow
        >
          <dodecahedronGeometry args={[1, 0]} />
          <StoneMaterial
            textures={stoneTextures}
            color={i % 2 === 0 ? '#5c616c' : '#9c9689'}
          />
        </mesh>
      ))}
    </group>
  );
}



export function StoneChamber3D({
  hasStarted,
  isDoorUnlocked,
}: StoneChamber3DProps) {
  const baseStone = useMemo(() => getChamberStoneTextures(), []);

  const floorTex = useMemo(
    () => cloneTexturesWithRepeat(baseStone, 8, 8),
    [baseStone]
  );
  const wallTex = useMemo(
    () => cloneTexturesWithRepeat(baseStone, 6, 3),
    [baseStone]
  );
  const pillarTex = useMemo(
    () => cloneTexturesWithRepeat(baseStone, 1.5, 3),
    [baseStone]
  );
  const capTex = useMemo(
    () => cloneTexturesWithRepeat(baseStone, 1, 1),
    [baseStone]
  );

  // Sunken arena floor: graveyard trench sits at y = -0.62 around the board plinth
  const trenchY = -0.62;
  const outerFloorY = -0.45;

  return (
    <group>
      {/* Sunken Graveyard Trench Floor framing the 8x8 board */}
      <mesh position={[0, trenchY - 0.15, 0]} receiveShadow>
        <boxGeometry args={[12.4, 0.3, 12.4]} />
        <StoneMaterial
          textures={floorTex}
          color="#464b56"
          roughness={0.9}
          bumpScale={0.055}
        />
      </mesh>

      {/* Raised Arena Terrace Floor surrounding the sunken graveyard trench */}
      <mesh position={[0, outerFloorY - 0.3, -10.4]} receiveShadow>
        <boxGeometry args={[36, 0.6, 8.8]} />
        <StoneMaterial textures={floorTex} color="#585e6a" />
      </mesh>
      <mesh position={[0, outerFloorY - 0.3, 11.2]} receiveShadow>
        <boxGeometry args={[36, 0.6, 10.4]} />
        <StoneMaterial textures={floorTex} color="#585e6a" />
      </mesh>
      <mesh position={[-11.8, outerFloorY - 0.3, 0]} receiveShadow>
        <boxGeometry args={[11.6, 0.6, 12.4]} />
        <StoneMaterial textures={floorTex} color="#585e6a" />
      </mesh>
      <mesh position={[11.8, outerFloorY - 0.3, 0]} receiveShadow>
        <boxGeometry args={[11.6, 0.6, 12.4]} />
        <StoneMaterial textures={floorTex} color="#585e6a" />
      </mesh>

      {/* Wide stepped stone entrance descent behind the player side */}
      <mesh position={[0, -0.35, 6.7]} receiveShadow>
        <boxGeometry args={[9.2, 0.35, 1.4]} />
        <StoneMaterial textures={pillarTex} color="#636976" />
      </mesh>
      <mesh position={[0, -0.1, 7.8]} receiveShadow>
        <boxGeometry args={[9.8, 0.4, 1.4]} />
        <StoneMaterial textures={pillarTex} color="#6b717f" />
      </mesh>

      {/* Carved stone altar plinth supporting the chessboard */}
      <mesh position={[0, -0.38, 0]} castShadow receiveShadow>
        <boxGeometry args={[8.55, 0.56, 8.55]} />
        <StoneMaterial textures={capTex} color="#5a606c" />
      </mesh>

      {/* Enclosing chamber stone walls */}
      <mesh position={[-5.75, 4.8, -13.9]} receiveShadow>
        <boxGeometry args={[24.5, 15, 0.8]} />
        <StoneMaterial textures={wallTex} color="#505662" />
      </mesh>
      <mesh position={[5.75, 4.8, -13.9]} receiveShadow>
        <boxGeometry args={[24.5, 15, 0.8]} />
        <StoneMaterial textures={wallTex} color="#505662" />
      </mesh>
      <mesh position={[0, 8.6, -13.9]} receiveShadow>
        <boxGeometry args={[5.5, 7.6, 0.8]} />
        <StoneMaterial textures={wallTex} color="#505662" />
      </mesh>

      <mesh position={[-15.6, 4.8, 1]} receiveShadow>
        <boxGeometry args={[0.8, 15, 34]} />
        <StoneMaterial textures={wallTex} color="#525864" />
      </mesh>
      <mesh position={[15.6, 4.8, 1]} receiveShadow>
        <boxGeometry args={[0.8, 15, 34]} />
        <StoneMaterial textures={wallTex} color="#525864" />
      </mesh>
      <mesh position={[0, 4.8, 17.8]} receiveShadow>
        <boxGeometry args={[36, 15, 0.8]} />
        <StoneMaterial textures={wallTex} color="#484e59" />
      </mesh>

      {/* Vaulted stone ceiling framing the cold moonlight abyss */}
      <mesh position={[0, 12.2, -9.8]} receiveShadow>
        <boxGeometry args={[34, 0.8, 10.5]} />
        <StoneMaterial textures={wallTex} color="#464b56" />
      </mesh>
      <mesh position={[0, 12.2, 10.2]} receiveShadow>
        <boxGeometry args={[34, 0.8, 13.5]} />
        <StoneMaterial textures={wallTex} color="#464b56" />
      </mesh>
      <mesh position={[-10.2, 12.2, -0.5]} receiveShadow>
        <boxGeometry args={[13.5, 0.8, 9.5]} />
        <StoneMaterial textures={wallTex} color="#464b56" />
      </mesh>
      <mesh position={[10.2, 12.2, -0.5]} receiveShadow>
        <boxGeometry args={[13.5, 0.8, 9.5]} />
        <StoneMaterial textures={wallTex} color="#464b56" />
      </mesh>

      {/* Massive Iron-Bound Double Oak Exit Doors (unlock on Checkmate) */}
      <DungeonExitDoor isUnlocked={isDoorUnlocked} stoneTextures={capTex} />

      {/* Rear Gothic Arcade Pillars (z = -11.4) */}
      {[-10.5, -4.6, 4.6, 10.5].map((x, idx) => (
        <GothicPillar
          key={`rear-${idx}`}
          position={[x, outerFloorY, -11.4]}
          height={8.6}
          textures={pillarTex}
          capTextures={capTex}
        />
      ))}

      {/* Rear Pointed Gothic Arches */}
      {[-7.55, 7.55].map((x, idx) => (
        <PointedGothicArch
          key={`rear-arch-${idx}`}
          position={[x, 1.5, -11.4]}
          span={5.9}
          springY={4.8}
          rise={3.0}
          textures={capTex}
        />
      ))}

      {/* Left Colonnade Pillars & Pointed Arches (x = -13.4) */}
      {[-11.4, -5.0, 2.0, 9.0].map((z, idx) => (
        <GothicPillar
          key={`left-${idx}`}
          position={[-13.4, outerFloorY, z]}
          height={8.6}
          textures={pillarTex}
          capTextures={capTex}
        />
      ))}
      {[-8.2, -1.5, 5.5].map((z, idx) => (
        <PointedGothicArch
          key={`left-arch-${idx}`}
          position={[-13.4, 1.5, z]}
          rotationY={Math.PI / 2}
          span={6.8}
          springY={4.8}
          rise={3.0}
          textures={capTex}
        />
      ))}

      {/* Right Colonnade Pillars & Pointed Arches (x = +13.4) */}
      {[-11.4, -5.0, 2.0, 9.0].map((z, idx) => (
        <GothicPillar
          key={`right-${idx}`}
          position={[13.4, outerFloorY, z]}
          height={8.6}
          textures={pillarTex}
          capTextures={capTex}
        />
      ))}
      {[-8.2, -1.5, 5.5].map((z, idx) => (
        <PointedGothicArch
          key={`right-arch-${idx}`}
          position={[13.4, 1.5, z]}
          rotationY={Math.PI / 2}
          span={6.8}
          springY={4.8}
          rise={3.0}
          textures={capTex}
        />
      ))}

      {/* Graveyard trench stone rubble */}
      <GraveyardTrenchRubble stoneTextures={capTex} />

      {/* Standing Corner Fire-Bowl Braziers framing the Sunken Arena */}
      <StandingFireBowl
        position={[-6.8, outerFloorY, 4.9]}
        seed={11}
        ignited={hasStarted}
        igniteDelay={0.08}
        stoneTextures={capTex}
      />
      <StandingFireBowl
        position={[6.8, outerFloorY, 4.9]}
        seed={12}
        ignited={hasStarted}
        igniteDelay={0.18}
        stoneTextures={capTex}
      />

      {/* 6 Sequentially Ignited Wall/Pillar-Mounted Braziers */}
      <WallBrazier3D
        position={[-12.7, 3.0, 2.0]}
        rotationY={Math.PI / 2}
        seed={1}
        ignited={hasStarted}
        igniteDelay={0.0}
      />
      <WallBrazier3D
        position={[12.7, 3.0, 2.0]}
        rotationY={-Math.PI / 2}
        seed={2}
        ignited={hasStarted}
        igniteDelay={0.14}
      />
      <WallBrazier3D
        position={[-12.7, 3.0, -5.0]}
        rotationY={Math.PI / 2}
        seed={3}
        ignited={hasStarted}
        igniteDelay={0.28}
      />
      <WallBrazier3D
        position={[12.7, 3.0, -5.0]}
        rotationY={-Math.PI / 2}
        seed={4}
        ignited={hasStarted}
        igniteDelay={0.42}
      />
      <WallBrazier3D
        position={[-4.6, 3.0, -10.7]}
        rotationY={0}
        seed={5}
        ignited={hasStarted}
        igniteDelay={0.56}
      />
      <WallBrazier3D
        position={[4.6, 3.0, -10.7]}
        rotationY={0}
        seed={6}
        ignited={hasStarted}
        igniteDelay={0.7}
      />
    </group>
  );
}
