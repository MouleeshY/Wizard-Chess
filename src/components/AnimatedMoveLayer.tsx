import { useEffect, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Color, Square } from 'chess.js';
import * as THREE from 'three';
import {
  squareToWorldPosition,
  type ActiveMoveAnimation,
} from '../game/chessTypes';
import { PieceGeometry } from './ChessPiece3D';
import type { DustBurstHandle } from './DustBurstSystem';
import type { CameraShakeHandle } from './CameraShakeRig';
import type { ImpactFlashHandle } from './ImpactFlashSystem';
import {
  playCaptureImpact,
  playStoneScrape,
  playStoneThud,
} from '../utils/soundEffects';

interface AnimatedMoveLayerProps {
  animation: ActiveMoveAnimation | null;
  dustRef: RefObject<DustBurstHandle | null>;
  shakeRef: RefObject<CameraShakeHandle | null>;
  flashRef: RefObject<ImpactFlashHandle | null>;
  onCaptureImpact: (params: {
    victimSquare: Square;
    victimColor: Color;
    position: [number, number, number];
    strikeDir: [number, number];
  }) => void;
  onAnimationComplete: (animationId: number) => void;
}

const CAPTURE_APPROACH_END = 0.52;
const CAPTURE_WINDUP_END = 0.78;
const CAPTURE_IMPACT_TIME = 0.9;
const CAPTURE_SETTLE_END = 1.25;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeInCubic(t: number): number {
  return t * t * t;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function lerpAngle(a: number, b: number, t: number): number {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

/** Smoothly bends a Knight hop along the long 2-square L-leg first before turning */
function sampleKnightLArc(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  easedT: number
): [number, number] {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const longAlongX = Math.abs(dx) > Math.abs(dz);
  const cornerX = longAlongX ? toX : fromX;
  const cornerZ = longAlongX ? fromZ : toZ;

  // Quadratic Bezier through the L-corner weighted toward the 2-square leg
  const u = 1 - easedT;
  const x = u * u * fromX + 2 * u * easedT * cornerX + easedT * easedT * toX;
  const z = u * u * fromZ + 2 * u * easedT * cornerZ + easedT * easedT * toZ;
  return [x, z];
}

export function AnimatedMoveLayer({
  animation,
  dustRef,
  shakeRef,
  flashRef,
  onCaptureImpact,
  onAnimationComplete,
}: AnimatedMoveLayerProps) {
  const primaryGroupRef = useRef<THREE.Group>(null);
  const secondaryGroupRef = useRef<THREE.Group>(null);
  const promotedGroupRef = useRef<THREE.Group>(null);

  const elapsedRef = useRef(0);
  const dustTimerRef = useRef(0);
  const completedIdRef = useRef<number | null>(null);
  const takeoffBurstIdRef = useRef<number | null>(null);
  const scrapeSoundIdRef = useRef<number | null>(null);
  const impactBurstIdRef = useRef<number | null>(null);
  const riseBurstIdRef = useRef<number | null>(null);

  useEffect(() => {
    elapsedRef.current = 0;
    dustTimerRef.current = 0;
  }, [animation?.id]);

  useFrame((_, delta) => {
    if (!animation) return;

    const dt = Math.min(delta, 0.05);
    elapsedRef.current += dt;
    dustTimerRef.current += dt;

    const elapsed = elapsedRef.current;

    const [pFromX, , pFromZ] = squareToWorldPosition(
      animation.primary.fromCoords.fileIndex,
      animation.primary.fromCoords.rankIndex
    );
    const [pToX, , pToZ] = squareToWorldPosition(
      animation.primary.toCoords.fileIndex,
      animation.primary.toCoords.rankIndex
    );

    const baseFacingY = animation.primary.color === 'w' ? 0 : Math.PI;

    // ------------------------------------------------------------------
    // 1. DRAMATIC CAPTURE CHOREOGRAPHY (Approach -> Rearing Strike -> Shatter)
    // ------------------------------------------------------------------
    if (animation.kind === 'capture' && animation.capture) {
      const cap = animation.capture;
      const [vX, , vZ] = squareToWorldPosition(
        cap.victimCoords.fileIndex,
        cap.victimCoords.rankIndex
      );

      const dx = vX - pFromX;
      const dz = vZ - pFromZ;
      const dist = Math.hypot(dx, dz) || 1;
      const dirX = dx / dist;
      const dirZ = dz / dist;

      const standoff = Math.min(0.78, dist * 0.56);
      const approachX = vX - dirX * standoff;
      const approachZ = vZ - dirZ * standoff;
      const attackYaw = Math.atan2(-dirX, -dirZ);

      let px = pFromX;
      let py = 0;
      let pz = pFromZ;
      let rotX = 0;
      let rotY = baseFacingY;
      let rotZ = 0;

      if (elapsed < CAPTURE_APPROACH_END) {
        const t = elapsed / CAPTURE_APPROACH_END;
        const e = easeInOutCubic(t);

        if (animation.primary.isKnightHop) {
          [px, pz] = sampleKnightLArc(pFromX, pFromZ, approachX, approachZ, e);
          py = Math.sin(e * Math.PI) * 1.1;
          rotX = Math.cos(e * Math.PI) * 0.36;
          if (takeoffBurstIdRef.current !== animation.id) {
            takeoffBurstIdRef.current = animation.id;
            dustRef.current?.emit(pFromX, 0.04, pFromZ, 12, 0.26, 0.9);
          }
        } else {
          px = THREE.MathUtils.lerp(pFromX, approachX, e);
          pz = THREE.MathUtils.lerp(pFromZ, approachZ, e);
          if (scrapeSoundIdRef.current !== animation.id) {
            scrapeSoundIdRef.current = animation.id;
            playStoneScrape(CAPTURE_APPROACH_END);
          }
        }

        rotY = lerpAngle(baseFacingY, attackYaw, Math.min(t * 1.4, 1));

        if (dustTimerRef.current >= 0.04) {
          dustTimerRef.current = 0;
          if (!animation.primary.isKnightHop || t < 0.25 || t > 0.75) {
            dustRef.current?.emit(px, 0.03, pz, 2, 0.2, 0.45);
          }
        }
      } else if (elapsed < CAPTURE_WINDUP_END) {
        // Rearing strike / wind-up specific to piece class
        const t =
          (elapsed - CAPTURE_APPROACH_END) /
          (CAPTURE_WINDUP_END - CAPTURE_APPROACH_END);
        const e = easeOutCubic(t);
        rotY = attackYaw;

        if (animation.primary.isKnightHop) {
          // Dramatic Knight Rearing Strike (warhorse rears up onto hind legs!)
          px = approachX - dirX * 0.12 * e;
          pz = approachZ - dirZ * 0.12 * e;
          py = 0.56 * e;
          rotX = 0.62 * e;
        } else if (cap.strikeStyle === 'slam') {
          px = approachX - dirX * 0.14 * e;
          pz = approachZ - dirZ * 0.14 * e;
          py = 0.44 * e;
          rotX = 0.32 * e;
        } else if (cap.strikeStyle === 'sweep') {
          px = approachX - dirX * 0.1 * e;
          pz = approachZ - dirZ * 0.1 * e;
          py = 0.16 * e;
          rotY = attackYaw - 0.85 * e;
          rotX = 0.2 * e;
          rotZ = 0.26 * e;
        } else {
          px = approachX - dirX * 0.2 * e;
          pz = approachZ - dirZ * 0.2 * e;
          py = 0.04 * e;
          rotX = 0.24 * e;
        }
      } else if (elapsed < CAPTURE_IMPACT_TIME) {
        // Snappy slam/strike into victim
        const t =
          (elapsed - CAPTURE_WINDUP_END) /
          (CAPTURE_IMPACT_TIME - CAPTURE_WINDUP_END);
        const e = easeInCubic(t);
        rotY = attackYaw;

        const strikeX = vX - dirX * 0.16;
        const strikeZ = vZ - dirZ * 0.16;

        if (animation.primary.isKnightHop) {
          px = THREE.MathUtils.lerp(approachX - dirX * 0.12, strikeX, e);
          pz = THREE.MathUtils.lerp(approachZ - dirZ * 0.12, strikeZ, e);
          py = THREE.MathUtils.lerp(0.56, 0.02, e);
          rotX = THREE.MathUtils.lerp(0.62, -0.38, e);
        } else if (cap.strikeStyle === 'slam') {
          px = THREE.MathUtils.lerp(approachX - dirX * 0.14, strikeX, e);
          pz = THREE.MathUtils.lerp(approachZ - dirZ * 0.14, strikeZ, e);
          py = THREE.MathUtils.lerp(0.44, 0.02, e);
          rotX = THREE.MathUtils.lerp(0.32, -0.36, e);
        } else if (cap.strikeStyle === 'sweep') {
          px = THREE.MathUtils.lerp(approachX - dirX * 0.1, strikeX, e);
          pz = THREE.MathUtils.lerp(approachZ - dirZ * 0.1, strikeZ, e);
          py = THREE.MathUtils.lerp(0.16, 0.03, e);
          rotY = THREE.MathUtils.lerp(attackYaw - 0.85, attackYaw + 0.55, e);
          rotX = THREE.MathUtils.lerp(0.2, -0.22, e);
          rotZ = THREE.MathUtils.lerp(0.26, -0.24, e);
        } else {
          px = THREE.MathUtils.lerp(approachX - dirX * 0.2, strikeX, e);
          pz = THREE.MathUtils.lerp(approachZ - dirZ * 0.2, strikeZ, e);
          py = THREE.MathUtils.lerp(0.04, 0.02, e);
          rotX = THREE.MathUtils.lerp(0.24, -0.32, e);
        }
      } else if (elapsed < CAPTURE_SETTLE_END) {
        // Shatter impact once: heavy thud, shatter burst, flash, dust plume, camera shake
        if (impactBurstIdRef.current !== animation.id) {
          impactBurstIdRef.current = animation.id;
          playCaptureImpact();
          onCaptureImpact({
            victimSquare: cap.victimSquare,
            victimColor: cap.victimColor,
            position: [vX, 0.08, vZ],
            strikeDir: [dirX, dirZ],
          });
          flashRef.current?.trigger(vX, 0.12, vZ);
          dustRef.current?.emit(vX, 0.06, vZ, 30, 0.45, 1.45);
          shakeRef.current?.trigger(0.12, 0.44);
        }

        const t =
          (elapsed - CAPTURE_IMPACT_TIME) /
          (CAPTURE_SETTLE_END - CAPTURE_IMPACT_TIME);
        const e = easeOutCubic(t);
        const strikeX = vX - dirX * 0.16;
        const strikeZ = vZ - dirZ * 0.16;

        px = THREE.MathUtils.lerp(strikeX, pToX, e);
        pz = THREE.MathUtils.lerp(strikeZ, pToZ, e);
        py = 0;

        if (animation.primary.isKnightHop) {
          rotX = THREE.MathUtils.lerp(-0.38, 0, e);
          rotY = lerpAngle(attackYaw, baseFacingY, e);
        } else if (cap.strikeStyle === 'slam') {
          rotX = THREE.MathUtils.lerp(-0.36, 0, e);
          rotY = lerpAngle(attackYaw, baseFacingY, e);
        } else if (cap.strikeStyle === 'sweep') {
          rotX = THREE.MathUtils.lerp(-0.22, 0, e);
          rotY = lerpAngle(attackYaw + 0.55, baseFacingY, e);
          rotZ = THREE.MathUtils.lerp(-0.24, 0, e);
        } else {
          rotX = THREE.MathUtils.lerp(-0.32, 0, e);
          rotY = lerpAngle(attackYaw, baseFacingY, e);
        }
      } else {
        // Post-capture promotion phase
        px = pToX;
        pz = pToZ;
        rotY = baseFacingY;

        if (animation.promotion) {
          const sinkStart = CAPTURE_SETTLE_END;
          const sinkDuration = 0.4;
          const riseStart = CAPTURE_SETTLE_END + 0.3;
          const riseDuration = 0.53;

          const sinkT = Math.min((elapsed - sinkStart) / sinkDuration, 1);
          py = -0.95 * easeInCubic(sinkT);
          if (primaryGroupRef.current) {
            primaryGroupRef.current.visible = sinkT < 1;
          }

          if (promotedGroupRef.current) {
            if (elapsed >= riseStart) {
              const riseT = Math.min((elapsed - riseStart) / riseDuration, 1);
              const riseY = -1.45 * (1 - easeOutCubic(riseT));
              promotedGroupRef.current.visible = true;
              promotedGroupRef.current.position.set(pToX, riseY, pToZ);

              if (riseBurstIdRef.current !== animation.id) {
                riseBurstIdRef.current = animation.id;
                dustRef.current?.emit(pToX, 0.05, pToZ, 14, 0.32, 1.05);
              }
            } else {
              promotedGroupRef.current.visible = false;
            }
          }
        }
      }

      if (primaryGroupRef.current) {
        primaryGroupRef.current.position.set(px, py, pz);
        primaryGroupRef.current.rotation.set(rotX, rotY, rotZ);
      }

      if (
        elapsed >= animation.totalDuration &&
        completedIdRef.current !== animation.id
      ) {
        completedIdRef.current = animation.id;
        if (animation.promotion) {
          playStoneThud(0.55);
          dustRef.current?.emit(pToX, 0.04, pToZ, 12, 0.3, 0.75);
          shakeRef.current?.trigger(0.055, 0.32);
        }
        onAnimationComplete(animation.id);
      }
      return;
    }

    // ------------------------------------------------------------------
    // 2. NON-CAPTURE MOVES (SLIDE, KNIGHT L-LEAP, CASTLING, PROMOTION)
    // ------------------------------------------------------------------
    const slideT = Math.min(elapsed / animation.slideDuration, 1);
    const easedSlide = easeInOutCubic(slideT);

    let px = THREE.MathUtils.lerp(pFromX, pToX, easedSlide);
    let pz = THREE.MathUtils.lerp(pFromZ, pToZ, easedSlide);
    let py = 0;
    let rotX = 0;
    let rotY = baseFacingY;

    if (animation.primary.isKnightHop) {
      [px, pz] = sampleKnightLArc(pFromX, pFromZ, pToX, pToZ, easedSlide);
      py = Math.sin(easedSlide * Math.PI) * 1.32;
      // Rearing pitch on takeoff, forward dive into landing
      rotX = Math.cos(easedSlide * Math.PI) * 0.42;

      const hopDirX = pToX - px;
      const hopDirZ = pToZ - pz;
      if (Math.hypot(hopDirX, hopDirZ) > 0.08 && slideT < 0.85) {
        const travelYaw = Math.atan2(-hopDirX, -hopDirZ);
        rotY = lerpAngle(baseFacingY, travelYaw, Math.sin(slideT * Math.PI) * 0.75);
      }

      if (takeoffBurstIdRef.current !== animation.id) {
        takeoffBurstIdRef.current = animation.id;
        dustRef.current?.emit(pFromX, 0.04, pFromZ, 12, 0.28, 0.92);
      }
    } else if (scrapeSoundIdRef.current !== animation.id) {
      scrapeSoundIdRef.current = animation.id;
      playStoneScrape(animation.slideDuration * 0.9);
    }

    if (slideT < 0.96 && dustTimerRef.current >= 0.035) {
      dustTimerRef.current = 0;
      if (animation.primary.isKnightHop) {
        if (slideT < 0.22 || slideT > 0.78) {
          dustRef.current?.emit(px, 0.04, pz, 2, 0.18, 0.45);
        }
      } else {
        dustRef.current?.emit(px, 0.03, pz, 3, 0.22, 0.5);
      }
    }

    if (animation.secondary && secondaryGroupRef.current) {
      const [sFromX, , sFromZ] = squareToWorldPosition(
        animation.secondary.fromCoords.fileIndex,
        animation.secondary.fromCoords.rankIndex
      );
      const [sToX, , sToZ] = squareToWorldPosition(
        animation.secondary.toCoords.fileIndex,
        animation.secondary.toCoords.rankIndex
      );
      const sx = THREE.MathUtils.lerp(sFromX, sToX, easedSlide);
      const sz = THREE.MathUtils.lerp(sFromZ, sToZ, easedSlide);
      secondaryGroupRef.current.position.set(sx, 0, sz);

      if (slideT < 0.96 && Math.random() < 0.45) {
        dustRef.current?.emit(sx, 0.03, sz, 2, 0.22, 0.48);
      }
    }

    if (animation.kind === 'promotion' && animation.promotion) {
      const sinkStart = 0.8;
      const sinkDuration = 0.42;
      const riseStart = 1.12;
      const riseDuration = 0.53;

      if (elapsed >= sinkStart) {
        const sinkT = Math.min((elapsed - sinkStart) / sinkDuration, 1);
        py = -0.95 * easeInCubic(sinkT);
        if (primaryGroupRef.current) {
          primaryGroupRef.current.visible = sinkT < 1;
        }
        if (sinkT < 1 && dustTimerRef.current >= 0.04) {
          dustTimerRef.current = 0;
          dustRef.current?.emit(pToX, 0.04, pToZ, 3, 0.28, 0.7);
        }
      }

      if (promotedGroupRef.current) {
        if (elapsed >= riseStart) {
          const riseT = Math.min((elapsed - riseStart) / riseDuration, 1);
          const riseY = -1.45 * (1 - easeOutCubic(riseT));
          promotedGroupRef.current.visible = true;
          promotedGroupRef.current.position.set(pToX, riseY, pToZ);

          if (riseBurstIdRef.current !== animation.id) {
            riseBurstIdRef.current = animation.id;
            dustRef.current?.emit(pToX, 0.05, pToZ, 14, 0.32, 1.05);
          } else if (riseT < 0.9 && dustTimerRef.current >= 0.045) {
            dustTimerRef.current = 0;
            dustRef.current?.emit(pToX, 0.04, pToZ, 2, 0.24, 0.75);
          }
        } else {
          promotedGroupRef.current.visible = false;
        }
      }
    }

    if (primaryGroupRef.current) {
      primaryGroupRef.current.position.set(px, py, pz);
      primaryGroupRef.current.rotation.set(rotX, rotY, 0);
    }

    if (
      elapsed >= animation.totalDuration &&
      completedIdRef.current !== animation.id
    ) {
      completedIdRef.current = animation.id;

      playStoneThud(animation.primary.isKnightHop ? 0.85 : 0.55);

      dustRef.current?.emit(
        pToX,
        0.04,
        pToZ,
        animation.primary.isKnightHop ? 18 : 12,
        0.3,
        animation.primary.isKnightHop ? 1.1 : 0.75
      );

      if (animation.secondary) {
        const [sToX, , sToZ] = squareToWorldPosition(
          animation.secondary.toCoords.fileIndex,
          animation.secondary.toCoords.rankIndex
        );
        dustRef.current?.emit(sToX, 0.04, sToZ, 10, 0.26, 0.75);
      }

      shakeRef.current?.trigger(
        animation.primary.isKnightHop ? 0.085 : 0.055,
        0.34
      );
      onAnimationComplete(animation.id);
    }
  });

  if (!animation) return null;

  const primaryRotY = animation.primary.color === 'w' ? 0 : Math.PI;
  const secondaryRotY = animation.secondary?.color === 'w' ? 0 : Math.PI;

  return (
    <group>
      <group
        ref={primaryGroupRef}
        position={squareToWorldPosition(
          animation.primary.fromCoords.fileIndex,
          animation.primary.fromCoords.rankIndex
        )}
        rotation={[0, primaryRotY, 0]}
      >
        <PieceGeometry
          type={animation.primary.type}
          color={animation.primary.color}
        />
      </group>

      {animation.secondary && (
        <group
          ref={secondaryGroupRef}
          position={squareToWorldPosition(
            animation.secondary.fromCoords.fileIndex,
            animation.secondary.fromCoords.rankIndex
          )}
          rotation={[0, secondaryRotY, 0]}
        >
          <PieceGeometry
            type={animation.secondary.type}
            color={animation.secondary.color}
          />
        </group>
      )}

      {animation.promotion && (
        <group
          ref={promotedGroupRef}
          visible={false}
          position={squareToWorldPosition(
            animation.promotion.coords.fileIndex,
            animation.promotion.coords.rankIndex,
            -1.45
          )}
          rotation={[0, animation.promotion.color === 'w' ? 0 : Math.PI, 0]}
        >
          <PieceGeometry
            type={animation.promotion.newType}
            color={animation.promotion.color}
          />
        </group>
      )}
    </group>
  );
}
