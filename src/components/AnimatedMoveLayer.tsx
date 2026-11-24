import { useEffect, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Color, Square } from 'chess.js';
import * as THREE from 'three';
import {
  squareToWorldPosition,
  type ActiveMoveAnimation,
} from '../game/chessTypes';
import {
  clamp01,
  easeInCubic,
  easeOutCubic,
  lerp,
  lerpAngle,
  sampleKnightLArc,
  sampleLandingSquash,
  sampleProceduralMotion,
} from '../game/movementCoordinator';
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
  elapsedRef: RefObject<number>;
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

export function AnimatedMoveLayer({
  animation,
  elapsedRef,
  dustRef,
  shakeRef,
  flashRef,
  onCaptureImpact,
  onAnimationComplete,
}: AnimatedMoveLayerProps) {
  const primaryGroupRef = useRef<THREE.Group>(null);
  const secondaryGroupRef = useRef<THREE.Group>(null);
  const promotedGroupRef = useRef<THREE.Group>(null);

  const dustTimerRef = useRef(0);
  const secondaryDustTimerRef = useRef(0);
  const firedStepIndexRef = useRef(-1);
  const completedIdRef = useRef<number | null>(null);
  const scrapeSoundIdRef = useRef<number | null>(null);
  const impactBurstIdRef = useRef<number | null>(null);
  const landingBurstIdRef = useRef<number | null>(null);
  const secondaryLandingBurstIdRef = useRef<number | null>(null);
  const riseBurstIdRef = useRef<number | null>(null);
  const promoFinishIdRef = useRef<number | null>(null);

  useEffect(() => {
    dustTimerRef.current = 0;
    secondaryDustTimerRef.current = 0;
    firedStepIndexRef.current = -1;
  }, [animation?.id]);

  useFrame((_, delta) => {
    if (!animation) return;

    const dt = Math.min(delta, 0.05);
    const elapsed = elapsedRef.current;
    dustTimerRef.current += dt;
    secondaryDustTimerRef.current += dt;

    const choreo = animation.choreography;
    const [pFromX, , pFromZ] = squareToWorldPosition(
      animation.primary.fromCoords.fileIndex,
      animation.primary.fromCoords.rankIndex
    );
    const [pToX, , pToZ] = squareToWorldPosition(
      animation.primary.toCoords.fileIndex,
      animation.primary.toCoords.rankIndex
    );
    const baseFacingY = animation.primary.color === 'w' ? 0 : Math.PI;

    // Trigger deterministic footfall dust & thuds along steps
    while (
      firedStepIndexRef.current + 1 < choreo.stepEvents.length &&
      elapsed >= choreo.stepEvents[firedStepIndexRef.current + 1].time
    ) {
      firedStepIndexRef.current += 1;
      const step = choreo.stepEvents[firedStepIndexRef.current];
      if (step.dustCount > 0) {
        dustRef.current?.emit(step.x, 0.035, step.z, step.dustCount, 0.24, 0.65);
      }
      if (step.thudVolume > 0) {
        playStoneThud(step.thudVolume);
      }
      if (step.shakeIntensity > 0) {
        shakeRef.current?.trigger(step.shakeIntensity, 0.16);
      }
    }

    // ------------------------------------------------------------------
    // 1. CAPTURE CHOREOGRAPHY (Bystanders Step -> Approach -> Brace & Windup -> Strike -> Shatter -> Settle)
    // ------------------------------------------------------------------
    if (animation.kind === 'capture' && animation.capture && choreo.captureTiming) {
      const cap = animation.capture;
      const ct = choreo.captureTiming;

      let px = pFromX;
      let py = 0;
      let pz = pFromZ;
      let rotX = 0;
      let rotY = baseFacingY;
      let rotZ = 0;
      let scaleX = 1;
      let scaleY = 1;
      let scaleZ = 1;

      if (elapsed < ct.approachStartTime) {
        // Poised at origin while nearby bystanders step aside
        px = pFromX;
        pz = pFromZ;
        rotY = lerpAngle(
          baseFacingY,
          ct.attackYaw,
          easeOutCubic(clamp01(elapsed / Math.max(0.01, ct.approachStartTime))) * 0.25
        );
      } else if (elapsed < ct.approachEndTime) {
        const approachDur = Math.max(0.01, ct.approachEndTime - ct.approachStartTime);
        const t = (elapsed - ct.approachStartTime) / approachDur;

        if (animation.primary.isKnightHop) {
          const e = easeOutCubic(t);
          [px, pz] = sampleKnightLArc(
            pFromX,
            pFromZ,
            ct.approachX,
            ct.approachZ,
            e
          );
          py = Math.sin(e * Math.PI) * 1.05;
          rotX = Math.cos(e * Math.PI) * 0.36;
          rotY = lerpAngle(baseFacingY, ct.attackYaw, Math.min(t * 1.4, 1));
        } else {
          const approachDist = Math.hypot(ct.approachX - pFromX, ct.approachZ - pFromZ);
          const pose = sampleProceduralMotion({
            motion: animation.primary,
            fromX: pFromX,
            fromZ: pFromZ,
            toX: ct.approachX,
            toZ: ct.approachZ,
            t,
            dist: approachDist,
          });
          px = pose.x;
          py = pose.y;
          pz = pose.z;
          rotX = pose.rotX;
          rotZ = pose.rotZ;
          scaleX = pose.scaleX;
          scaleY = pose.scaleY;
          scaleZ = pose.scaleZ;
          rotY = lerpAngle(baseFacingY, ct.attackYaw, Math.min(t * 1.4, 1));

          if (
            (animation.primary.type === 'r' ||
              animation.primary.type === 'b' ||
              animation.primary.type === 'q') &&
            scrapeSoundIdRef.current !== animation.id
          ) {
            scrapeSoundIdRef.current = animation.id;
            playStoneScrape(approachDur);
          }
        }

        if (dustTimerRef.current >= 0.045) {
          dustTimerRef.current = 0;
          if (!animation.primary.isKnightHop || t < 0.22 || t > 0.78) {
            dustRef.current?.emit(px, 0.03, pz, 2, 0.2, 0.45);
          }
        }
      } else if (elapsed < ct.windupEndTime) {
        // Rearing strike / wind-up while defender braces
        const windupDur = Math.max(0.01, ct.windupEndTime - ct.windupStartTime);
        const t = (elapsed - ct.windupStartTime) / windupDur;
        const e = easeOutCubic(t);

        if (animation.isDragged) {
          rotY = lerpAngle(baseFacingY, ct.attackYaw, e);
          const startY = 0.34;

          if (animation.primary.isKnightHop) {
            px = lerp(pToX, ct.approachX - ct.dirX * 0.12, e);
            pz = lerp(pToZ, ct.approachZ - ct.dirZ * 0.12, e);
            py = lerp(startY, 0.58, e);
            rotX = 0.64 * e;
          } else if (cap.strikeStyle === 'slam') {
            px = lerp(pToX, ct.approachX - ct.dirX * 0.14, e);
            pz = lerp(pToZ, ct.approachZ - ct.dirZ * 0.14, e);
            py = lerp(startY, 0.44, e);
            rotX = 0.34 * e;
          } else if (cap.strikeStyle === 'sweep') {
            px = lerp(pToX, ct.approachX - ct.dirX * 0.1, e);
            pz = lerp(pToZ, ct.approachZ - ct.dirZ * 0.1, e);
            py = lerp(startY, 0.16, e);
            rotY = lerpAngle(baseFacingY, ct.attackYaw - 0.85, e);
            rotX = 0.22 * e;
            rotZ = 0.26 * e;
          } else {
            px = lerp(pToX, ct.approachX - ct.dirX * 0.2, e);
            pz = lerp(pToZ, ct.approachZ - ct.dirZ * 0.2, e);
            py = lerp(startY, 0.04, e);
            rotX = 0.24 * e;
          }
        } else {
          rotY = ct.attackYaw;

          if (animation.primary.isKnightHop) {
            px = ct.approachX - ct.dirX * 0.12 * e;
            pz = ct.approachZ - ct.dirZ * 0.12 * e;
            py = 0.58 * e;
            rotX = 0.64 * e;
          } else if (cap.strikeStyle === 'slam') {
            px = ct.approachX - ct.dirX * 0.14 * e;
            pz = ct.approachZ - ct.dirZ * 0.14 * e;
            py = 0.44 * e;
            rotX = 0.34 * e;
          } else if (cap.strikeStyle === 'sweep') {
            px = ct.approachX - ct.dirX * 0.1 * e;
            pz = ct.approachZ - ct.dirZ * 0.1 * e;
            py = 0.16 * e;
            rotY = ct.attackYaw - 0.85 * e;
            rotX = 0.22 * e;
            rotZ = 0.26 * e;
          } else {
            px = ct.approachX - ct.dirX * 0.2 * e;
            pz = ct.approachZ - ct.dirZ * 0.2 * e;
            py = 0.04 * e;
            rotX = 0.24 * e;
          }
        }
      } else if (elapsed < ct.impactTime) {
        // Snappy strike into bracing defender
        const strikeDur = Math.max(0.01, ct.impactTime - ct.windupEndTime);
        const t = (elapsed - ct.windupEndTime) / strikeDur;
        const e = easeInCubic(t);
        rotY = ct.attackYaw;

        if (animation.primary.isKnightHop) {
          px = lerp(ct.approachX - ct.dirX * 0.12, ct.strikeX, e);
          pz = lerp(ct.approachZ - ct.dirZ * 0.12, ct.strikeZ, e);
          py = lerp(0.58, 0.02, e);
          rotX = lerp(0.64, -0.38, e);
        } else if (cap.strikeStyle === 'slam') {
          px = lerp(ct.approachX - ct.dirX * 0.14, ct.strikeX, e);
          pz = lerp(ct.approachZ - ct.dirZ * 0.14, ct.strikeZ, e);
          py = lerp(0.44, 0.02, e);
          rotX = lerp(0.34, -0.36, e);
        } else if (cap.strikeStyle === 'sweep') {
          px = lerp(ct.approachX - ct.dirX * 0.1, ct.strikeX, e);
          pz = lerp(ct.approachZ - ct.dirZ * 0.1, ct.strikeZ, e);
          py = lerp(0.16, 0.03, e);
          rotY = lerp(ct.attackYaw - 0.85, ct.attackYaw + 0.55, e);
          rotX = lerp(0.22, -0.22, e);
          rotZ = lerp(0.26, -0.24, e);
        } else {
          px = lerp(ct.approachX - ct.dirX * 0.2, ct.strikeX, e);
          pz = lerp(ct.approachZ - ct.dirZ * 0.2, ct.strikeZ, e);
          py = lerp(0.04, 0.02, e);
          rotX = lerp(0.24, -0.32, e);
        }
      } else if (elapsed < ct.settleEndTime) {
        // Shatter impact once
        if (impactBurstIdRef.current !== animation.id) {
          impactBurstIdRef.current = animation.id;
          playCaptureImpact();
          onCaptureImpact({
            victimSquare: cap.victimSquare,
            victimColor: cap.victimColor,
            position: [ct.victimX, 0.08, ct.victimZ],
            strikeDir: [ct.dirX, ct.dirZ],
          });
          flashRef.current?.trigger(ct.victimX, 0.12, ct.victimZ);
          dustRef.current?.emit(ct.victimX, 0.06, ct.victimZ, 30, 0.45, 1.45);
          shakeRef.current?.trigger(
            Math.max(0.08, choreo.primaryProfile.shakeIntensity * 1.25),
            Math.max(0.34, choreo.primaryProfile.shakeDuration)
          );
        }

        const settleDur = Math.max(0.01, ct.settleEndTime - ct.impactTime);
        const t = (elapsed - ct.impactTime) / settleDur;
        const e = easeOutCubic(t);

        px = lerp(ct.strikeX, pToX, e);
        pz = lerp(ct.strikeZ, pToZ, e);
        py = 0;

        if (animation.primary.isKnightHop) {
          rotX = lerp(-0.38, 0, e);
          rotY = lerpAngle(ct.attackYaw, baseFacingY, e);
        } else if (cap.strikeStyle === 'slam') {
          rotX = lerp(-0.36, 0, e);
          rotY = lerpAngle(ct.attackYaw, baseFacingY, e);
        } else if (cap.strikeStyle === 'sweep') {
          rotX = lerp(-0.22, 0, e);
          rotY = lerpAngle(ct.attackYaw + 0.55, baseFacingY, e);
          rotZ = lerp(-0.24, 0, e);
        } else {
          rotX = lerp(-0.32, 0, e);
          rotY = lerpAngle(ct.attackYaw, baseFacingY, e);
        }

        const impactSquash = sampleLandingSquash(
          elapsed,
          ct.impactTime,
          choreo.primaryProfile.landingSquash
        );
        scaleX = impactSquash.scaleX;
        scaleY = impactSquash.scaleY;
        scaleZ = impactSquash.scaleZ;
      } else {
        // Settled onto target square (plus optional capture-promotion)
        px = pToX;
        pz = pToZ;
        rotY = baseFacingY;

        if (landingBurstIdRef.current !== animation.id) {
          landingBurstIdRef.current = animation.id;
          playStoneThud(choreo.primaryProfile.landingThudVolume * 0.8);
          dustRef.current?.emit(pToX, 0.035, pToZ, 8, 0.24, 0.65);
        }

        const sq = sampleLandingSquash(
          elapsed,
          choreo.landingTime,
          choreo.primaryProfile.landingSquash * 0.75
        );
        scaleX = sq.scaleX;
        scaleY = sq.scaleY;
        scaleZ = sq.scaleZ;

        if (animation.promotion && choreo.promotionTiming) {
          const pt = choreo.promotionTiming;
          const sinkT = clamp01(
            (elapsed - pt.sinkStartTime) /
              Math.max(0.01, pt.sinkEndTime - pt.sinkStartTime)
          );
          py = -0.95 * easeInCubic(sinkT);
          if (primaryGroupRef.current) {
            primaryGroupRef.current.visible = sinkT < 1;
          }

          if (promotedGroupRef.current) {
            if (elapsed >= pt.riseStartTime) {
              const riseT = clamp01(
                (elapsed - pt.riseStartTime) /
                  Math.max(0.01, pt.riseEndTime - pt.riseStartTime)
              );
              const riseY = -1.45 * (1 - easeOutCubic(riseT));
              promotedGroupRef.current.visible = true;
              promotedGroupRef.current.position.set(pToX, riseY, pToZ);

              if (riseBurstIdRef.current !== animation.id) {
                riseBurstIdRef.current = animation.id;
                dustRef.current?.emit(pToX, 0.05, pToZ, 14, 0.32, 1.05);
              }
              if (riseT >= 1 && promoFinishIdRef.current !== animation.id) {
                promoFinishIdRef.current = animation.id;
                playStoneThud(0.65);
                dustRef.current?.emit(pToX, 0.04, pToZ, 12, 0.3, 0.75);
                shakeRef.current?.trigger(0.06, 0.32);
              }
            } else {
              promotedGroupRef.current.visible = false;
            }
          }
        }
      }

      if (primaryGroupRef.current) {
        primaryGroupRef.current.rotation.order = 'YXZ';
        primaryGroupRef.current.position.set(px, py, pz);
        primaryGroupRef.current.rotation.set(rotX, rotY, rotZ);
        primaryGroupRef.current.scale.set(scaleX, scaleY, scaleZ);
      }

      if (
        elapsed >= choreo.totalDuration &&
        completedIdRef.current !== animation.id
      ) {
        completedIdRef.current = animation.id;
        onAnimationComplete(animation.id);
      }
      return;
    }

    // ------------------------------------------------------------------
    // 2. NON-CAPTURE MOVES (PROCEDURAL PER-PIECE PROFILES, CASTLING, PROMOTION)
    // ------------------------------------------------------------------
    const moveT =
      choreo.moveDuration > 0
        ? clamp01((elapsed - choreo.moveStartTime) / choreo.moveDuration)
        : 1;
    const primaryDist = Math.hypot(pToX - pFromX, pToZ - pFromZ);

    let px = pFromX;
    let py = 0;
    let pz = pFromZ;
    let rotX = 0;
    let rotY = baseFacingY;
    let rotZ = 0;
    let scaleX = 1;
    let scaleY = 1;
    let scaleZ = 1;

    if (animation.isDragged) {
      const dropT =
        choreo.landingTime > 0
          ? clamp01(elapsed / choreo.landingTime)
          : 1;
      px = pToX;
      pz = pToZ;
      py = dropT < 1 ? 0.34 * (1 - easeInCubic(dropT)) : 0;
    } else if (elapsed < choreo.moveStartTime) {
      px = pFromX;
      pz = pFromZ;
    } else {
      const pose = sampleProceduralMotion({
        motion: animation.primary,
        fromX: pFromX,
        fromZ: pFromZ,
        toX: pToX,
        toZ: pToZ,
        t: moveT,
        dist: primaryDist,
      });
      px = pose.x;
      py = pose.y;
      pz = pose.z;
      rotX = pose.rotX;
      rotY = pose.rotY;
      rotZ = pose.rotZ;
      scaleX = pose.scaleX;
      scaleY = pose.scaleY;
      scaleZ = pose.scaleZ;

      if (
        (animation.primary.type === 'r' ||
          animation.primary.type === 'b' ||
          animation.primary.type === 'q') &&
        scrapeSoundIdRef.current !== animation.id
      ) {
        scrapeSoundIdRef.current = animation.id;
        playStoneScrape(choreo.moveDuration * 0.92);
      }

      if (
        moveT < 0.96 &&
        !animation.primary.isKnightHop &&
        (animation.primary.type === 'r' ||
          animation.primary.type === 'b' ||
          animation.primary.type === 'q') &&
        dustTimerRef.current >= 0.04
      ) {
        dustTimerRef.current = 0;
        dustRef.current?.emit(
          px,
          0.03,
          pz,
          animation.primary.type === 'r' ? 3 : 2,
          0.22,
          0.48
        );
      }
    }

    // Castling secondary rook motion
    if (animation.secondary && secondaryGroupRef.current) {
      const [sFromX, , sFromZ] = squareToWorldPosition(
        animation.secondary.fromCoords.fileIndex,
        animation.secondary.fromCoords.rankIndex
      );
      const [sToX, , sToZ] = squareToWorldPosition(
        animation.secondary.toCoords.fileIndex,
        animation.secondary.toCoords.rankIndex
      );
      const secDist = Math.hypot(sToX - sFromX, sToZ - sFromZ);

      let secPose = {
        x: sFromX,
        y: 0,
        z: sFromZ,
        rotX: 0,
        rotY: animation.secondary.color === 'w' ? 0 : Math.PI,
        rotZ: 0,
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1,
      };

      if (elapsed >= choreo.moveStartTime) {
        secPose = sampleProceduralMotion({
          motion: animation.secondary,
          fromX: sFromX,
          fromZ: sFromZ,
          toX: sToX,
          toZ: sToZ,
          t: moveT,
          dist: secDist,
        });
      }

      const secLandingTime = animation.isDragged
        ? choreo.moveEndTime
        : choreo.landingTime;
      const secSq = sampleLandingSquash(
        elapsed,
        secLandingTime,
        choreo.secondaryProfile?.landingSquash ?? 0.1
      );
      secondaryGroupRef.current.rotation.order = 'YXZ';
      secondaryGroupRef.current.position.set(secPose.x, secPose.y, secPose.z);
      secondaryGroupRef.current.rotation.set(
        secPose.rotX,
        secPose.rotY,
        secPose.rotZ
      );
      secondaryGroupRef.current.scale.set(
        secPose.scaleX * secSq.scaleX,
        secPose.scaleY * secSq.scaleY,
        secPose.scaleZ * secSq.scaleZ
      );

      if (
        elapsed >= choreo.moveStartTime &&
        moveT < 0.96 &&
        secondaryDustTimerRef.current >= 0.045
      ) {
        secondaryDustTimerRef.current = 0;
        dustRef.current?.emit(secPose.x, 0.03, secPose.z, 2, 0.22, 0.45);
      }

      if (
        animation.isDragged &&
        elapsed >= secLandingTime &&
        secondaryLandingBurstIdRef.current !== animation.id
      ) {
        secondaryLandingBurstIdRef.current = animation.id;
        playStoneThud(choreo.secondaryProfile?.landingThudVolume ?? 0.48);
        dustRef.current?.emit(sToX, 0.04, sToZ, 12, 0.28, 0.8);
      }
    }

    // Landing impact event (thud, dust puff, weight-scaled camera shake)
    if (elapsed >= choreo.landingTime && landingBurstIdRef.current !== animation.id) {
      landingBurstIdRef.current = animation.id;

      playStoneThud(choreo.primaryProfile.landingThudVolume);

      const dustCount = Math.round(8 + choreo.primaryProfile.weight * 12);
      dustRef.current?.emit(
        pToX,
        0.04,
        pToZ,
        dustCount,
        0.3,
        0.6 + choreo.primaryProfile.weight * 0.5
      );

      if (animation.secondary && !animation.isDragged) {
        const [sToX, , sToZ] = squareToWorldPosition(
          animation.secondary.toCoords.fileIndex,
          animation.secondary.toCoords.rankIndex
        );
        dustRef.current?.emit(sToX, 0.04, sToZ, 12, 0.28, 0.8);
      }

      shakeRef.current?.trigger(
        choreo.primaryProfile.shakeIntensity,
        choreo.primaryProfile.shakeDuration
      );
    }

    // Apply post-landing squash for non-Knight pieces (or dragged Knights settling onto square)
    if (animation.isDragged || !animation.primary.isKnightHop) {
      const sq = sampleLandingSquash(
        elapsed,
        choreo.landingTime,
        choreo.primaryProfile.landingSquash
      );
      scaleX *= sq.scaleX;
      scaleY *= sq.scaleY;
      scaleZ *= sq.scaleZ;
    }

    // Promotion sink & rise phase
    if (animation.kind === 'promotion' && animation.promotion && choreo.promotionTiming) {
      const pt = choreo.promotionTiming;
      if (elapsed >= pt.sinkStartTime) {
        const sinkT = clamp01(
          (elapsed - pt.sinkStartTime) /
            Math.max(0.01, pt.sinkEndTime - pt.sinkStartTime)
        );
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
        if (elapsed >= pt.riseStartTime) {
          const riseT = clamp01(
            (elapsed - pt.riseStartTime) /
              Math.max(0.01, pt.riseEndTime - pt.riseStartTime)
          );
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

          if (riseT >= 1 && promoFinishIdRef.current !== animation.id) {
            promoFinishIdRef.current = animation.id;
            playStoneThud(0.65);
            dustRef.current?.emit(pToX, 0.04, pToZ, 12, 0.3, 0.75);
            shakeRef.current?.trigger(0.06, 0.32);
          }
        } else {
          promotedGroupRef.current.visible = false;
        }
      }
    }

    if (primaryGroupRef.current) {
      primaryGroupRef.current.rotation.order = 'YXZ';
      primaryGroupRef.current.position.set(px, py, pz);
      primaryGroupRef.current.rotation.set(rotX, rotY, rotZ);
      primaryGroupRef.current.scale.set(scaleX, scaleY, scaleZ);
    }

    if (
      elapsed >= choreo.totalDuration &&
      completedIdRef.current !== animation.id
    ) {
      completedIdRef.current = animation.id;
      onAnimationComplete(animation.id);
    }
  });

  if (!animation) return null;

  const primaryRotY = animation.primary.color === 'w' ? 0 : Math.PI;
  const secondaryRotY = animation.secondary?.color === 'w' ? 0 : Math.PI;

  const initialPrimaryCoords = animation.isDragged
    ? animation.primary.toCoords
    : animation.primary.fromCoords;

  return (
    <group>
      <group
        ref={primaryGroupRef}
        position={squareToWorldPosition(
          initialPrimaryCoords.fileIndex,
          initialPrimaryCoords.rankIndex,
          animation.isDragged ? 0.34 : 0
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
