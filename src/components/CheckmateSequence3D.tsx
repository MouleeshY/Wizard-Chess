import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Color, Square } from 'chess.js';
import * as THREE from 'three';
import { squareToCoords, squareToWorldPosition } from '../game/chessTypes';
import { KingBodyGeometry, KingCrownGeometry } from './ChessPiece3D';
import type { DustBurstHandle } from './DustBurstSystem';
import type { CameraShakeHandle } from './CameraShakeRig';
import { playCrownClang, playStoneThud } from '../utils/soundEffects';

export interface OrbitControlsHandle {
  target: THREE.Vector3;
  update: () => void;
}

interface CheckmateSequence3DProps {
  kingSquare: Square;
  kingColor: Color;
  controlsRef: RefObject<OrbitControlsHandle | null>;
  dustRef: RefObject<DustBurstHandle | null>;
  shakeRef: RefObject<CameraShakeHandle | null>;
  onCrownDropped?: () => void;
  onSequenceComplete: () => void;
}

const CROWN_REST_Y = 0.24;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeInQuad(t: number): number {
  return t * t;
}

export function CheckmateSequence3D({
  kingSquare,
  kingColor,
  controlsRef,
  dustRef,
  shakeRef,
  onCrownDropped,
  onSequenceComplete,
}: CheckmateSequence3DProps) {
  const { camera } = useThree();

  const bodyRef = useRef<THREE.Group>(null);
  const crownRef = useRef<THREE.Group>(null);

  const elapsedRef = useRef(0);
  const kneelThudPlayedRef = useRef(false);
  const bounce1PlayedRef = useRef(false);
  const bounce2PlayedRef = useRef(false);
  const bounce3PlayedRef = useRef(false);
  const titleFiredRef = useRef(false);

  const coords = useMemo(() => squareToCoords(kingSquare), [kingSquare]);
  const kingWorld = useMemo(
    () => squareToWorldPosition(coords.fileIndex, coords.rankIndex, 0),
    [coords.fileIndex, coords.rankIndex]
  );

  // Facing rotation: White faces -Z (0), Black faces +Z (PI)
  const facingY = kingColor === 'w' ? 0 : Math.PI;
  const forwardSignZ = kingColor === 'w' ? -1 : 1;

  // Target camera framing inside the chamber looking at the kneeling king & fallen crown
  const desiredTarget = useMemo(
    () =>
      new THREE.Vector3(
        kingWorld[0] * 0.9,
        0.48,
        kingWorld[2] + forwardSignZ * 0.25
      ),
    [kingWorld, forwardSignZ]
  );

  const desiredCamPos = useMemo(() => {
    const sideOffset = kingWorld[0] > 1.2 ? -2.2 : 2.2;
    const zOffset = kingColor === 'b' ? 3.2 : -2.9;
    return new THREE.Vector3(
      THREE.MathUtils.clamp(kingWorld[0] + sideOffset, -10.5, 10.5),
      2.3,
      THREE.MathUtils.clamp(kingWorld[2] + zOffset, -10.2, 11.8)
    );
  }, [kingWorld, kingColor]);

  useEffect(() => {
    elapsedRef.current = 0;
    kneelThudPlayedRef.current = false;
    bounce1PlayedRef.current = false;
    bounce2PlayedRef.current = false;
    bounce3PlayedRef.current = false;
    titleFiredRef.current = false;
  }, [kingSquare, kingColor]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    elapsedRef.current += dt;
    const t = elapsedRef.current;

    // 1. Slowly move camera in toward the losing king
    camera.position.x = THREE.MathUtils.damp(
      camera.position.x,
      desiredCamPos.x,
      1.6,
      dt
    );
    camera.position.y = THREE.MathUtils.damp(
      camera.position.y,
      desiredCamPos.y,
      1.6,
      dt
    );
    camera.position.z = THREE.MathUtils.damp(
      camera.position.z,
      desiredCamPos.z,
      1.6,
      dt
    );

    if (controlsRef.current) {
      controlsRef.current.target.x = THREE.MathUtils.damp(
        controlsRef.current.target.x,
        desiredTarget.x,
        2.0,
        dt
      );
      controlsRef.current.target.y = THREE.MathUtils.damp(
        controlsRef.current.target.y,
        desiredTarget.y,
        2.0,
        dt
      );
      controlsRef.current.target.z = THREE.MathUtils.damp(
        controlsRef.current.target.z,
        desiredTarget.z,
        2.0,
        dt
      );
      controlsRef.current.update();
    }

    // 2. Losing king kneels (lowers & tilts forward)
    if (bodyRef.current) {
      const kneelStart = 0.35;
      const kneelDuration = 1.3;
      const kt = THREE.MathUtils.clamp((t - kneelStart) / kneelDuration, 0, 1);
      const ke = easeInOutCubic(kt);

      bodyRef.current.position.y = -0.18 * ke;
      bodyRef.current.rotation.x = -0.58 * ke;

      if (kt >= 0.85 && !kneelThudPlayedRef.current) {
        kneelThudPlayedRef.current = true;
        playStoneThud(0.85);
        dustRef.current?.emit(kingWorld[0], 0.04, kingWorld[2], 10, 0.25, 0.65);
      }
    }

    // 3. Separate crown lifts off, drops, and bounces heavily with metallic clang
    if (crownRef.current) {
      let cy = 1.24;
      let cz = 0;
      let cx = 0;
      let rotX = 0;
      let rotZ = 0;

      if (t < 0.45) {
        // Still resting atop the king as camera begins pushing in
        cy = 1.24;
      } else if (t < 0.78) {
        // Lift off and slip forward as king starts bowing
        const p = easeOutCubic((t - 0.45) / 0.33);
        cy = THREE.MathUtils.lerp(1.24, 1.54, p);
        cz = THREE.MathUtils.lerp(0, -0.34, p);
        cx = THREE.MathUtils.lerp(0, 0.06, p);
        rotX = THREE.MathUtils.lerp(0, -0.45, p);
        rotZ = THREE.MathUtils.lerp(0, 0.14, p);
      } else if (t < 1.32) {
        // Gravity fall to the chessboard
        const p = (t - 0.78) / 0.54;
        const dropEase = easeInQuad(p);
        cy = THREE.MathUtils.lerp(1.54, CROWN_REST_Y, dropEase);
        cz = THREE.MathUtils.lerp(-0.34, -0.64, p);
        cx = THREE.MathUtils.lerp(0.06, 0.14, p);
        rotX = THREE.MathUtils.lerp(-0.45, -1.42, p);
        rotZ = THREE.MathUtils.lerp(0.14, 0.3, p);
      } else if (t < 1.72) {
        // First heavy impact & rebound -> triggers Grand Dungeon Doors unlock!
        if (!bounce1PlayedRef.current) {
          bounce1PlayedRef.current = true;
          playCrownClang(1.0);
          onCrownDropped?.();
          const wx = kingWorld[0] + (kingColor === 'w' ? 0.14 : -0.14);
          const wz = kingWorld[2] + forwardSignZ * 0.64;
          dustRef.current?.emit(wx, 0.04, wz, 12, 0.22, 0.72);
          shakeRef.current?.trigger(0.048, 0.26);
        }
        const p = (t - 1.32) / 0.4;
        cy = CROWN_REST_Y + Math.sin(p * Math.PI) * 0.34;
        cz = THREE.MathUtils.lerp(-0.64, -0.77, p);
        cx = THREE.MathUtils.lerp(0.14, 0.18, p);
        rotX = THREE.MathUtils.lerp(-1.42, -1.52, p);
        rotZ = THREE.MathUtils.lerp(0.3, 0.34, p);
      } else if (t < 1.98) {
        // Second bounce
        if (!bounce2PlayedRef.current) {
          bounce2PlayedRef.current = true;
          playCrownClang(0.46);
          const wx = kingWorld[0] + (kingColor === 'w' ? 0.18 : -0.18);
          const wz = kingWorld[2] + forwardSignZ * 0.77;
          dustRef.current?.emit(wx, 0.04, wz, 5, 0.16, 0.42);
        }
        const p = (t - 1.72) / 0.26;
        cy = CROWN_REST_Y + Math.sin(p * Math.PI) * 0.12;
        cz = THREE.MathUtils.lerp(-0.77, -0.83, p);
        cx = THREE.MathUtils.lerp(0.18, 0.2, p);
        rotX = THREE.MathUtils.lerp(-1.52, -1.5, p);
        rotZ = THREE.MathUtils.lerp(0.34, 0.35, p);
      } else if (t < 2.15) {
        // Third subtle settle bounce
        if (!bounce3PlayedRef.current) {
          bounce3PlayedRef.current = true;
          playCrownClang(0.22);
        }
        const p = (t - 1.98) / 0.17;
        cy = CROWN_REST_Y + Math.sin(p * Math.PI) * 0.035;
        cz = THREE.MathUtils.lerp(-0.83, -0.86, p);
        cx = 0.2;
        rotX = -1.5;
        rotZ = 0.35;
      } else {
        cy = CROWN_REST_Y;
        cz = -0.86;
        cx = 0.2;
        rotX = -1.5;
        rotZ = 0.35;
      }

      crownRef.current.position.set(cx, cy, cz);
      crownRef.current.rotation.set(rotX, 0, rotZ);
    }

    // 4. Fade in the "Checkmate" title once the crown settles & doors swing open
    if (t >= 2.75 && !titleFiredRef.current) {
      titleFiredRef.current = true;
      onSequenceComplete();
    }
  });

  return (
    <group position={kingWorld} rotation={[0, facingY, 0]}>
      <group ref={bodyRef}>
        <KingBodyGeometry color={kingColor} isInCheck />
      </group>
      <group ref={crownRef} position={[0, 1.24, 0]}>
        <KingCrownGeometry color={kingColor} isInCheck />
      </group>
    </group>
  );
}
