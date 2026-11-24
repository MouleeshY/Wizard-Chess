import type { Color, PieceSymbol, Square } from 'chess.js';
import {
  squareToWorldPosition,
  type AnimatedPieceMotion,
  type BoardPiece,
  type CaptureAnimationInfo,
  type PromotionPiece,
} from './chessTypes';

export interface PieceMotionProfile {
  weight: number;
  baseDuration: number;
  durationPerTile: number;
  landingSquash: number;
  shakeIntensity: number;
  shakeDuration: number;
  landingThudVolume: number;
  stepThudVolume: number;
}

export const PIECE_MOTION_PROFILES: Record<PieceSymbol, PieceMotionProfile> = {
  p: {
    weight: 0.35,
    baseDuration: 0.56,
    durationPerTile: 0.14,
    landingSquash: 0.06,
    shakeIntensity: 0.035,
    shakeDuration: 0.22,
    landingThudVolume: 0.45,
    stepThudVolume: 0.24,
  },
  b: {
    weight: 0.55,
    baseDuration: 0.66,
    durationPerTile: 0.075,
    landingSquash: 0.055,
    shakeIntensity: 0.05,
    shakeDuration: 0.28,
    landingThudVolume: 0.56,
    stepThudVolume: 0,
  },
  q: {
    weight: 0.7,
    baseDuration: 0.54,
    durationPerTile: 0.055,
    landingSquash: 0.075,
    shakeIntensity: 0.068,
    shakeDuration: 0.3,
    landingThudVolume: 0.68,
    stepThudVolume: 0,
  },
  n: {
    weight: 0.85,
    baseDuration: 1.02,
    durationPerTile: 0,
    landingSquash: 0.13,
    shakeIntensity: 0.1,
    shakeDuration: 0.36,
    landingThudVolume: 0.9,
    stepThudVolume: 0.32,
  },
  r: {
    weight: 0.95,
    baseDuration: 0.78,
    durationPerTile: 0.09,
    landingSquash: 0.11,
    shakeIntensity: 0.095,
    shakeDuration: 0.38,
    landingThudVolume: 0.85,
    stepThudVolume: 0,
  },
  k: {
    weight: 1.0,
    baseDuration: 0.98,
    durationPerTile: 0.18,
    landingSquash: 0.13,
    shakeIntensity: 0.11,
    shakeDuration: 0.42,
    landingThudVolume: 0.92,
    stepThudVolume: 0.48,
  },
};

export interface StepEvent {
  time: number;
  x: number;
  z: number;
  dustCount: number;
  thudVolume: number;
  shakeIntensity: number;
}

export interface BystanderMotionPlan {
  square: Square;
  offsetX: number;
  offsetZ: number;
  turnYaw: number;
  leanRotX: number;
  leanRotZ: number;
  blocked: boolean;
  stepStartTime: number;
  stepEndTime: number;
  returnStartTime: number;
  returnEndTime: number;
  shudderStartTime: number | null;
  shudderEndTime: number | null;
  shudderStrength: number;
  shudderPhase: number;
}

export interface DefenderBracePlan {
  victimSquare: Square;
  braceStartTime: number;
  strikeStartTime: number;
  impactTime: number;
  faceAttackerYaw: number;
  recoilDirX: number;
  recoilDirZ: number;
}

export interface CaptureTimingPlan {
  approachStartTime: number;
  approachEndTime: number;
  windupStartTime: number;
  windupEndTime: number;
  impactTime: number;
  settleEndTime: number;
  approachX: number;
  approachZ: number;
  strikeX: number;
  strikeZ: number;
  victimX: number;
  victimZ: number;
  dirX: number;
  dirZ: number;
  attackYaw: number;
  defenderBrace: DefenderBracePlan;
}

export interface PromotionTimingPlan {
  sinkStartTime: number;
  sinkEndTime: number;
  riseStartTime: number;
  riseEndTime: number;
}

export interface MoveChoreographyPlan {
  preStepDuration: number;
  moveStartTime: number;
  moveDuration: number;
  moveEndTime: number;
  landingTime: number;
  totalDuration: number;
  primaryProfile: PieceMotionProfile;
  secondaryProfile: PieceMotionProfile | null;
  captureTiming: CaptureTimingPlan | null;
  promotionTiming: PromotionTimingPlan | null;
  stepEvents: StepEvent[];
  bystanders: Record<string, BystanderMotionPlan>;
}

export interface ProceduralPose {
  x: number;
  y: number;
  z: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

export interface BystanderVisualTransform {
  worldOffsetX: number;
  worldOffsetZ: number;
  localOffsetY: number;
  localTurnY: number;
  localRotX: number;
  localRotZ: number;
}

const PRE_STEP_DURATION = 0.18;
const BYSTANDER_RETURN_DURATION = 0.26;
const BYSTANDER_CORRIDOR_RADIUS = 1.15;
const ON_LINE_EPSILON = 0.12;
const MIN_STEP_DIST = 0.1;
const MAX_STEP_DIST = 0.32;
const MIN_MEANINGFUL_STEP = 0.08;
const SHUDDER_RADIUS = 2.25;
const SHUDDER_DURATION = 0.26;

const PIECE_COLLISION_RADIUS: Record<PieceSymbol, number> = {
  p: 0.37,
  b: 0.38,
  q: 0.4,
  n: 0.4,
  r: 0.41,
  k: 0.42,
};

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

export function easeInCubic(t: number): number {
  const c = clamp01(t);
  return c * c * c;
}

export function easeOutCubic(t: number): number {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 3);
}

export function easeInOutCubic(t: number): number {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

export function easeInOutQuad(t: number): number {
  const c = clamp01(t);
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}

export function easeInOutPower(t: number, power: number): number {
  const c = clamp01(t);
  if (c < 0.5) {
    return 0.5 * Math.pow(2 * c, power);
  }
  return 1 - 0.5 * Math.pow(2 * (1 - c), power);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpAngle(a: number, b: number, t: number): number {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

/** Smoothly bends a Knight hop along the long 2-square L-leg first before turning */
export function sampleKnightLArc(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  t: number
): [number, number] {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const longAlongX = Math.abs(dx) > Math.abs(dz);
  const cornerX = longAlongX ? toX : fromX;
  const cornerZ = longAlongX ? fromZ : toZ;

  const u = 1 - t;
  const x = u * u * fromX + 2 * u * t * cornerX + t * t * toX;
  const z = u * u * fromZ + 2 * u * t * cornerZ + t * t * toZ;
  return [x, z];
}

interface PathSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

function closestPointOnSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): {
  dist: number;
  cx: number;
  cz: number;
  projFraction: number;
  rawProj: number;
  segLen: number;
  dirX: number;
  dirZ: number;
} {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  const segLen = Math.sqrt(lenSq) || 1;
  const dirX = abx / segLen;
  const dirZ = abz / segLen;

  if (lenSq < 1e-6) {
    return {
      dist: Math.hypot(px - ax, pz - az),
      cx: ax,
      cz: az,
      projFraction: 0,
      rawProj: 0,
      segLen: 0,
      dirX: 0,
      dirZ: -1,
    };
  }

  const rawProj = ((px - ax) * abx + (pz - az) * abz) / segLen;
  const t = clamp01(rawProj / segLen);
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return {
    dist: Math.hypot(px - cx, pz - cz),
    cx,
    cz,
    projFraction: t,
    rawProj,
    segLen,
    dirX,
    dirZ,
  };
}

function buildSweptSegments(
  primary: AnimatedPieceMotion,
  secondary?: AnimatedPieceMotion
): PathSegment[] {
  const [pFromX, , pFromZ] = squareToWorldPosition(
    primary.fromCoords.fileIndex,
    primary.fromCoords.rankIndex
  );
  const [pToX, , pToZ] = squareToWorldPosition(
    primary.toCoords.fileIndex,
    primary.toCoords.rankIndex
  );

  const segments: PathSegment[] = [];

  if (primary.isKnightHop) {
    const sampleCount = 6;
    let prevX = pFromX;
    let prevZ = pFromZ;
    for (let i = 1; i <= sampleCount; i++) {
      const [nx, nz] = sampleKnightLArc(
        pFromX,
        pFromZ,
        pToX,
        pToZ,
        i / sampleCount
      );
      segments.push({ ax: prevX, az: prevZ, bx: nx, bz: nz });
      prevX = nx;
      prevZ = nz;
    }
  } else {
    segments.push({ ax: pFromX, az: pFromZ, bx: pToX, bz: pToZ });
  }

  if (secondary) {
    const [sFromX, , sFromZ] = squareToWorldPosition(
      secondary.fromCoords.fileIndex,
      secondary.fromCoords.rankIndex
    );
    const [sToX, , sToZ] = squareToWorldPosition(
      secondary.toCoords.fileIndex,
      secondary.toCoords.rankIndex
    );
    segments.push({ ax: sFromX, az: sFromZ, bx: sToX, bz: sToZ });
  }

  return segments;
}

function computePrimaryMoveDuration(
  primary: AnimatedPieceMotion,
  secondary?: AnimatedPieceMotion
): number {
  const profile = PIECE_MOTION_PROFILES[primary.type];
  const [pFromX, , pFromZ] = squareToWorldPosition(
    primary.fromCoords.fileIndex,
    primary.fromCoords.rankIndex
  );
  const [pToX, , pToZ] = squareToWorldPosition(
    primary.toCoords.fileIndex,
    primary.toCoords.rankIndex
  );
  const dist = Math.hypot(pToX - pFromX, pToZ - pFromZ);
  let dur = profile.baseDuration + profile.durationPerTile * dist;

  if (secondary) {
    const secProfile = PIECE_MOTION_PROFILES[secondary.type];
    const [sFromX, , sFromZ] = squareToWorldPosition(
      secondary.fromCoords.fileIndex,
      secondary.fromCoords.rankIndex
    );
    const [sToX, , sToZ] = squareToWorldPosition(
      secondary.toCoords.fileIndex,
      secondary.toCoords.rankIndex
    );
    const secDist = Math.hypot(sToX - sFromX, sToZ - sFromZ);
    dur = Math.max(dur, secProfile.baseDuration + secProfile.durationPerTile * secDist);
  }

  return dur;
}

function getStepCountForPiece(type: PieceSymbol, dist: number): number {
  if (type === 'p') {
    return Math.max(2, Math.round(dist * 2));
  }
  if (type === 'k') {
    return Math.max(2, Math.round(dist * 1.5));
  }
  return 0;
}

function evalKingSteppedProgress(
  t: number,
  stepCount: number,
  facingSideSign: number
): {
  progress: number;
  liftY: number;
  pitchX: number;
  rollZ: number;
  squashY: number;
} {
  const clamped = clamp01(t);
  if (clamped >= 1) {
    return { progress: 1, liftY: 0, pitchX: 0, rollZ: 0, squashY: 0 };
  }

  const scaled = clamped * stepCount;
  const stepIdx = Math.min(stepCount - 1, Math.floor(scaled));
  const u = scaled - stepIdx;
  const pauseFraction = 0.36;
  const altSign = (stepIdx % 2 === 0 ? 1 : -1) * facingSideSign;

  if (u < pauseFraction) {
    // Pause before each heavy step while shifting weight onto planted foot
    const pauseSin = Math.sin((u / pauseFraction) * Math.PI);
    return {
      progress: stepIdx / stepCount,
      liftY: 0,
      pitchX: 0.025 * pauseSin,
      rollZ: altSign * 0.05 * pauseSin,
      squashY: -0.025 * pauseSin,
    };
  }

  const stepU = (u - pauseFraction) / (1 - pauseFraction);
  const easedStep = easeInOutCubic(stepU);
  const strideSin = Math.sin(stepU * Math.PI);

  return {
    progress: (stepIdx + easedStep) / stepCount,
    liftY: strideSin * 0.068,
    pitchX: -0.075 * strideSin,
    rollZ: altSign * 0.055 * strideSin,
    squashY: 0,
  };
}

function evalPawnSteppedProgress(
  t: number,
  stepCount: number
): {
  progress: number;
  liftY: number;
  pitchX: number;
  rollZ: number;
} {
  const clamped = clamp01(t);
  if (clamped >= 1) {
    return { progress: 1, liftY: 0, pitchX: 0, rollZ: 0 };
  }

  const scaled = clamped * stepCount;
  const stepIdx = Math.min(stepCount - 1, Math.floor(scaled));
  const u = scaled - stepIdx;
  const pauseFraction = 0.14;
  const altSign = stepIdx % 2 === 0 ? 1 : -1;

  // Shield-forward lean across march
  const shieldLean = -0.15 * Math.sin(Math.min(clamped * 1.15, 1) * Math.PI);

  if (u < pauseFraction) {
    return {
      progress: stepIdx / stepCount,
      liftY: 0,
      pitchX: shieldLean,
      rollZ: altSign * 0.02,
    };
  }

  const stepU = (u - pauseFraction) / (1 - pauseFraction);
  const easedStep = easeInOutQuad(stepU);
  const bob = Math.sin(stepU * Math.PI);

  return {
    progress: (stepIdx + easedStep) / stepCount,
    liftY: bob * 0.055,
    pitchX: shieldLean - 0.04 * bob,
    rollZ: altSign * 0.05 * bob,
  };
}

/**
 * Computes a 100% deterministic choreography plan from the move and the pre-move board state.
 * Online clients share identical chess.js states and move parameters, so choreography matches cleanly.
 */
export function buildMoveChoreography(params: {
  kind: 'standard' | 'castle' | 'promotion' | 'capture';
  primary: AnimatedPieceMotion;
  secondary?: AnimatedPieceMotion;
  capture?: CaptureAnimationInfo;
  promotion?: {
    newType: PromotionPiece;
    color: Color;
    square: Square;
    coords: { fileIndex: number; rankIndex: number };
  };
  boardPiecesBefore: BoardPiece[];
  isDragged?: boolean;
}): MoveChoreographyPlan {
  const {
    kind,
    primary,
    secondary,
    capture,
    promotion,
    boardPiecesBefore,
    isDragged = false,
  } = params;

  const primaryProfile = PIECE_MOTION_PROFILES[primary.type];
  const secondaryProfile = secondary
    ? PIECE_MOTION_PROFILES[secondary.type]
    : null;

  const [pFromX, , pFromZ] = squareToWorldPosition(
    primary.fromCoords.fileIndex,
    primary.fromCoords.rankIndex
  );
  const [pToX, , pToZ] = squareToWorldPosition(
    primary.toCoords.fileIndex,
    primary.toCoords.rankIndex
  );

  // Exclude active movers and captured victim from bystander reactions
  const excludedSquares = new Set<Square>([primary.from, primary.to]);
  if (secondary) {
    excludedSquares.add(secondary.from);
    excludedSquares.add(secondary.to);
  }
  if (capture) {
    excludedSquares.add(capture.victimSquare);
  }

  const sweptSegments = buildSweptSegments(primary, secondary);

  interface RawPathBystanderCandidate {
    piece: BoardPiece;
    px: number;
    pz: number;
    minDist: number;
    projFraction: number;
    crossY: number;
    dirX: number;
    dirZ: number;
    leftX: number;
    leftZ: number;
  }

  interface RawPathBystander {
    piece: BoardPiece;
    minDist: number;
    projFraction: number;
    offsetX: number;
    offsetZ: number;
    turnYaw: number;
    leanRotX: number;
    leanRotZ: number;
    blocked: boolean;
  }

  const pathCandidates: RawPathBystanderCandidate[] = [];

  for (const piece of boardPiecesBefore) {
    if (excludedSquares.has(piece.square)) continue;

    const [px, , pz] = squareToWorldPosition(piece.fileIndex, piece.rankIndex);

    let bestDist = Infinity;
    let bestSegIdx = 0;
    let bestClosest: ReturnType<typeof closestPointOnSegment> | null = null;

    for (let i = 0; i < sweptSegments.length; i++) {
      const seg = sweptSegments[i];
      const res = closestPointOnSegment(px, pz, seg.ax, seg.az, seg.bx, seg.bz);
      if (res.dist < bestDist) {
        bestDist = res.dist;
        bestSegIdx = i;
        bestClosest = res;
      }
    }

    if (!bestClosest || bestDist > BYSTANDER_CORRIDOR_RADIUS) continue;

    // Ignore pieces strictly behind the starting square along a straight path
    if (!primary.isKnightHop && bestClosest.rawProj < -0.2) {
      continue;
    }

    const vx = px - bestClosest.cx;
    const vz = pz - bestClosest.cz;
    // Y-component of (D x V) in right-handed Three.js space (+X right, +Y up, -Z forward):
    // > 0 means piece is to the LEFT of travel direction D; < 0 means RIGHT of D.
    const crossY = bestClosest.dirZ * vx - bestClosest.dirX * vz;
    const leftX = bestClosest.dirZ;
    const leftZ = -bestClosest.dirX;

    const overallFraction =
      sweptSegments.length > 1 && primary.isKnightHop
        ? (bestSegIdx + bestClosest.projFraction) / sweptSegments.length
        : bestClosest.projFraction;

    pathCandidates.push({
      piece,
      px,
      pz,
      minDist: bestDist,
      projFraction: overallFraction,
      crossY,
      dirX: bestClosest.dirX,
      dirZ: bestClosest.dirZ,
      leftX,
      leftZ,
    });
  }

  // Sort deterministically so pieces closest to the path resolve step claims first
  pathCandidates.sort((a, b) => {
    if (Math.abs(a.minDist - b.minDist) > 1e-6) return a.minDist - b.minDist;
    if (a.piece.fileIndex !== b.piece.fileIndex) {
      return a.piece.fileIndex - b.piece.fileIndex;
    }
    return a.piece.rankIndex - b.piece.rankIndex;
  });

  // Track static board occupancy (excluding movers' vacated origins) plus destinations
  const occupiedMap = new Map<string, BoardPiece>();
  for (const p of boardPiecesBefore) {
    if (p.square === primary.from || (secondary && p.square === secondary.from)) {
      continue;
    }
    occupiedMap.set(`${p.fileIndex},${p.rankIndex}`, p);
  }

  interface ObstacleDisc {
    key: string;
    x: number;
    z: number;
    radius: number;
  }
  const staticObstacles: ObstacleDisc[] = [];
  for (const p of occupiedMap.values()) {
    const [ox, , oz] = squareToWorldPosition(p.fileIndex, p.rankIndex);
    staticObstacles.push({
      key: p.square,
      x: ox,
      z: oz,
      radius: PIECE_COLLISION_RADIUS[p.type],
    });
  }
  staticObstacles.push({
    key: `dest-${primary.to}`,
    x: pToX,
    z: pToZ,
    radius: PIECE_COLLISION_RADIUS[primary.type],
  });
  if (secondary) {
    const [sToX, , sToZ] = squareToWorldPosition(
      secondary.toCoords.fileIndex,
      secondary.toCoords.rankIndex
    );
    staticObstacles.push({
      key: `dest-${secondary.to}`,
      x: sToX,
      z: sToZ,
      radius: PIECE_COLLISION_RADIUS[secondary.type],
    });
  }

  interface ClaimedBystanderSpace {
    square: Square;
    startX: number;
    startZ: number;
    targetX: number;
    targetZ: number;
    radius: number;
  }
  const claimedBystanders: ClaimedBystanderSpace[] = [];

  const isSquareInBounds = (f: number, r: number) =>
    f >= 0 && f <= 7 && r >= 0 && r <= 7;

  const isSquareOccupiedOrDest = (f: number, r: number) => {
    if (occupiedMap.has(`${f},${r}`)) return true;
    if (
      f === primary.toCoords.fileIndex &&
      r === primary.toCoords.rankIndex
    ) {
      return true;
    }
    if (
      secondary &&
      f === secondary.toCoords.fileIndex &&
      r === secondary.toCoords.rankIndex
    ) {
      return true;
    }
    return false;
  };

  const evaluateSide = (
    cand: RawPathBystanderCandidate,
    sx: number,
    sz: number,
    desiredDist: number
  ): { roomScore: number; stepDist: number } => {
    const df = Math.round(sx);
    const dr = -Math.round(sz);
    const nf = cand.piece.fileIndex + df;
    const nr = cand.piece.rankIndex + dr;
    const pieceRadius = PIECE_COLLISION_RADIUS[cand.piece.type];

    if (!isSquareInBounds(nf, nr)) {
      return { roomScore: -2, stepDist: 0 };
    }

    const immediateOccupied = isSquareOccupiedOrDest(nf, nr);
    const isOrthogonalStep = Math.abs(df) + Math.abs(dr) === 1;

    let roomScore: number;
    if (immediateOccupied) {
      roomScore = -1;
    } else {
      const nf2 = cand.piece.fileIndex + df * 2;
      const nr2 = cand.piece.rankIndex + dr * 2;
      roomScore =
        isSquareInBounds(nf2, nr2) && !isSquareOccupiedOrDest(nf2, nr2) ? 2 : 1;
    }

    // Orthogonal occupied neighbor leaves no room to step without crowding/clipping
    if (isOrthogonalStep && immediateOccupied) {
      return { roomScore, stepDist: 0 };
    }

    const checkDistClear = (distToTry: number): boolean => {
      const tx = cand.px + sx * distToTry;
      const tz = cand.pz + sz * distToTry;

      // Stay well within board bounds and the piece's own square footprint
      if (Math.abs(tx) > 3.65 || Math.abs(tz) > 3.65) {
        return false;
      }

      for (const obs of staticObstacles) {
        if (obs.key === cand.piece.square) continue;
        const minSafe = pieceRadius + obs.radius + 0.12;
        if (Math.hypot(tx - obs.x, tz - obs.z) < minSafe) {
          return false;
        }
      }

      for (const claimed of claimedBystanders) {
        const minSafeTarget = pieceRadius + claimed.radius + 0.14;
        if (
          Math.hypot(tx - claimed.targetX, tz - claimed.targetZ) < minSafeTarget
        ) {
          return false;
        }
        const minSafeStart = pieceRadius + claimed.radius + 0.1;
        if (
          Math.hypot(tx - claimed.startX, tz - claimed.startZ) < minSafeStart
        ) {
          return false;
        }
      }

      return true;
    };

    if (checkDistClear(desiredDist)) {
      return { roomScore, stepDist: desiredDist };
    }

    // For diagonal/corner crowding, try scaling step down if meaningful clearance remains
    const halfDist = desiredDist * 0.55;
    if (halfDist >= MIN_MEANINGFUL_STEP && checkDistClear(halfDist)) {
      return { roomScore, stepDist: halfDist };
    }

    return { roomScore, stepDist: 0 };
  };

  const pathBystanders: RawPathBystander[] = [];

  for (const cand of pathCandidates) {
    const closeness = clamp01(1 - cand.minDist / 1.25);
    const weightFactor = 0.65 + 0.35 * primaryProfile.weight;
    const desiredDist = Math.min(
      MAX_STEP_DIST,
      Math.max(MIN_STEP_DIST, (0.1 + 0.24 * closeness) * weightFactor)
    );

    const isOnLine = Math.abs(cand.crossY) < ON_LINE_EPSILON;
    let chosenSideSign: 1 | -1;
    let stepDist = 0;

    if (!isOnLine) {
      // Step strictly AWAY from the mover's path: left -> left (+1), right -> right (-1)
      chosenSideSign = cand.crossY > 0 ? 1 : -1;
      const sx = chosenSideSign * cand.leftX;
      const sz = chosenSideSign * cand.leftZ;
      stepDist = evaluateSide(cand, sx, sz, desiredDist).stepDist;
    } else {
      // On the line: check free room on both sides, prefer emptier unblocked side
      const leftEval = evaluateSide(cand, cand.leftX, cand.leftZ, desiredDist);
      const rightEval = evaluateSide(
        cand,
        -cand.leftX,
        -cand.leftZ,
        desiredDist
      );

      const leftFree = leftEval.stepDist > 0;
      const rightFree = rightEval.stepDist > 0;

      if (leftFree && !rightFree) {
        chosenSideSign = 1;
        stepDist = leftEval.stepDist;
      } else if (rightFree && !leftFree) {
        chosenSideSign = -1;
        stepDist = rightEval.stepDist;
      } else if (leftEval.roomScore !== rightEval.roomScore) {
        chosenSideSign = leftEval.roomScore > rightEval.roomScore ? 1 : -1;
        stepDist = chosenSideSign === 1 ? leftEval.stepDist : rightEval.stepDist;
      } else {
        // Deterministic tiebreak by file index parity (never random)
        chosenSideSign = cand.piece.fileIndex % 2 === 0 ? 1 : -1;
        stepDist = chosenSideSign === 1 ? leftEval.stepDist : rightEval.stepDist;
      }
    }

    const awayX = chosenSideSign * cand.leftX;
    const awayZ = chosenSideSign * cand.leftZ;
    const blocked = stepDist <= 0;
    const offsetX = blocked ? 0 : awayX * stepDist;
    const offsetZ = blocked ? 0 : awayZ * stepDist;

    // Body turn faces away from the mover on the same side the piece steps toward
    const baseYaw = cand.piece.color === 'w' ? 0 : Math.PI;
    const awayWorldYaw = Math.atan2(-awayX, -awayZ);
    let yawDiff = Math.atan2(
      Math.sin(awayWorldYaw - baseYaw),
      Math.cos(awayWorldYaw - baseYaw)
    );

    if (Math.abs(Math.abs(yawDiff) - Math.PI) < 0.08) {
      // Piece faces almost straight toward the path: deterministically turn away from oncoming mover
      const pieceRightX = Math.cos(baseYaw);
      const pieceRightZ = -Math.sin(baseYaw);
      const oncomingDot =
        -cand.dirX * pieceRightX + -cand.dirZ * pieceRightZ;
      const turnDirSign =
        Math.abs(oncomingDot) > 0.05
          ? oncomingDot > 0
            ? 1
            : -1
          : cand.piece.fileIndex % 2 === 0
            ? 1
            : -1;
      yawDiff = turnDirSign * Math.PI;
    }

    const turnFraction = blocked ? 0.48 : 0.42;
    const turnYaw = Math.max(-0.78, Math.min(0.78, yawDiff * turnFraction));

    // Lean away from the path in the piece's turned local frame (stronger when blocked)
    const bodyYaw = baseYaw + turnYaw;
    const leanAngle = blocked ? 0.15 : 0.055;
    const dotX = awayX * Math.cos(bodyYaw) - awayZ * Math.sin(bodyYaw);
    const dotZ = awayX * Math.sin(bodyYaw) + awayZ * Math.cos(bodyYaw);
    const leanRotZ = -dotX * leanAngle;
    const leanRotX = dotZ * leanAngle;

    claimedBystanders.push({
      square: cand.piece.square,
      startX: cand.px,
      startZ: cand.pz,
      targetX: cand.px + offsetX,
      targetZ: cand.pz + offsetZ,
      radius: PIECE_COLLISION_RADIUS[cand.piece.type],
    });

    pathBystanders.push({
      piece: cand.piece,
      minDist: cand.minDist,
      projFraction: cand.projFraction,
      offsetX,
      offsetZ,
      turnYaw,
      leanRotX,
      leanRotZ,
      blocked,
    });
  }

  const hasPathBystanders = pathBystanders.length > 0;
  const preStepDuration = !isDragged && hasPathBystanders ? PRE_STEP_DURATION : 0;
  const moveStartTime = preStepDuration;

  const baseMoveDuration = computePrimaryMoveDuration(primary, secondary);

  let captureTiming: CaptureTimingPlan | null = null;
  let promotionTiming: PromotionTimingPlan | null = null;
  let moveDuration = baseMoveDuration;
  let moveEndTime = moveStartTime + moveDuration;
  let landingTime = moveEndTime;
  const stepEvents: StepEvent[] = [];

  if (kind === 'capture' && capture) {
    const [vX, , vZ] = squareToWorldPosition(
      capture.victimCoords.fileIndex,
      capture.victimCoords.rankIndex
    );

    const dx = vX - pFromX;
    const dz = vZ - pFromZ;
    const dist = Math.hypot(dx, dz) || 1;
    const dirX = dx / dist;
    const dirZ = dz / dist;

    const standoff = isDragged ? Math.min(0.24, dist * 0.32) : Math.min(0.78, dist * 0.56);
    const approachX = vX - dirX * standoff;
    const approachZ = vZ - dirZ * standoff;
    const strikeX = vX - dirX * 0.16;
    const strikeZ = vZ - dirZ * 0.16;
    const attackYaw = Math.atan2(-dirX, -dirZ);
    const faceAttackerYaw = Math.atan2(dirX, dirZ);

    const approachDist = Math.hypot(approachX - pFromX, approachZ - pFromZ);
    const approachDuration = isDragged
      ? 0
      : primary.isKnightHop
        ? 0.54
        : Math.max(
            0.38,
            primaryProfile.baseDuration * 0.56 +
              primaryProfile.durationPerTile * approachDist * 0.65
          );

    const windupDuration = isDragged ? 0.18 : 0.3;
    const strikeDuration = isDragged ? 0.1 : 0.12;
    const settleDuration = isDragged ? 0.24 : 0.34;

    const approachStartTime = moveStartTime;
    const approachEndTime = approachStartTime + approachDuration;
    const windupStartTime = approachEndTime;
    const windupEndTime = windupStartTime + windupDuration;
    const impactTime = windupEndTime + strikeDuration;
    const settleEndTime = impactTime + settleDuration;

    // Defender braces before strike begins and holds guard until shatter impact
    const braceStartTime = isDragged
      ? 0
      : Math.max(moveStartTime, windupStartTime - 0.04);

    captureTiming = {
      approachStartTime,
      approachEndTime,
      windupStartTime,
      windupEndTime,
      impactTime,
      settleEndTime,
      approachX,
      approachZ,
      strikeX,
      strikeZ,
      victimX: vX,
      victimZ: vZ,
      dirX,
      dirZ,
      attackYaw,
      defenderBrace: {
        victimSquare: capture.victimSquare,
        braceStartTime,
        strikeStartTime: windupEndTime,
        impactTime,
        faceAttackerYaw,
        recoilDirX: dirX,
        recoilDirZ: dirZ,
      },
    };

    if (!isDragged) {
      // Footsteps during Pawn/King capture approach
      const approachSteps = getStepCountForPiece(primary.type, approachDist);
      for (let i = 0; i < approachSteps; i++) {
        const frac = (i + 1) / approachSteps;
        const sx = lerp(pFromX, approachX, frac);
        const sz = lerp(pFromZ, approachZ, frac);
        stepEvents.push({
          time: approachStartTime + frac * approachDuration,
          x: sx,
          z: sz,
          dustCount: primary.type === 'k' ? 7 : 4,
          thudVolume: primaryProfile.stepThudVolume,
          shakeIntensity: primary.type === 'k' ? 0.025 : 0,
        });
      }

      if (primary.isKnightHop) {
        stepEvents.push({
          time: approachStartTime + 0.04,
          x: pFromX,
          z: pFromZ,
          dustCount: 12,
          thudVolume: primaryProfile.stepThudVolume,
          shakeIntensity: 0,
        });
      }
    }

    moveDuration = settleEndTime - moveStartTime;
    moveEndTime = settleEndTime;
    landingTime = settleEndTime;

    if (promotion) {
      const sinkStartTime = settleEndTime;
      const sinkEndTime = sinkStartTime + 0.4;
      const riseStartTime = sinkStartTime + 0.3;
      const riseEndTime = riseStartTime + 0.53;
      promotionTiming = {
        sinkStartTime,
        sinkEndTime,
        riseStartTime,
        riseEndTime,
      };
    }
  } else if (isDragged) {
    // Dragged non-capture move: skip the slide, settle crisply onto target square
    const dropSettleDuration = 0.14;
    if (kind === 'castle' && secondary) {
      const rookSlideDuration = 0.54;
      moveDuration = rookSlideDuration;
      moveEndTime = rookSlideDuration;
      landingTime = dropSettleDuration;
    } else {
      moveDuration = dropSettleDuration;
      moveEndTime = dropSettleDuration;
      landingTime = dropSettleDuration;
    }

    if (kind === 'promotion' && promotion) {
      const sinkStartTime = moveEndTime + 0.04;
      const sinkEndTime = sinkStartTime + 0.4;
      const riseStartTime = sinkStartTime + 0.3;
      const riseEndTime = riseStartTime + 0.53;
      promotionTiming = {
        sinkStartTime,
        sinkEndTime,
        riseStartTime,
        riseEndTime,
      };
    }
  } else {
    // Non-capture clicked move (standard, castle, promotion)
    const dist = Math.hypot(pToX - pFromX, pToZ - pFromZ);
    const stepCount = getStepCountForPiece(primary.type, dist);

    for (let i = 0; i < stepCount - 1; i++) {
      const frac = (i + 1) / stepCount;
      stepEvents.push({
        time: moveStartTime + frac * moveDuration,
        x: lerp(pFromX, pToX, frac),
        z: lerp(pFromZ, pToZ, frac),
        dustCount: primary.type === 'k' ? 7 : 4,
        thudVolume: primaryProfile.stepThudVolume,
        shakeIntensity: primary.type === 'k' ? 0.026 : 0,
      });
    }

    if (primary.isKnightHop) {
      // Crouch paw dust + takeoff burst
      stepEvents.push({
        time: moveStartTime + moveDuration * 0.08,
        x: pFromX,
        z: pFromZ,
        dustCount: 5,
        thudVolume: 0,
        shakeIntensity: 0,
      });
      stepEvents.push({
        time: moveStartTime + moveDuration * 0.18,
        x: pFromX,
        z: pFromZ,
        dustCount: 13,
        thudVolume: primaryProfile.stepThudVolume,
        shakeIntensity: 0,
      });
      landingTime = moveStartTime + moveDuration * 0.86;
    }

    if (kind === 'promotion' && promotion) {
      const sinkStartTime = moveEndTime;
      const sinkEndTime = sinkStartTime + 0.42;
      const riseStartTime = sinkStartTime + 0.32;
      const riseEndTime = riseStartTime + 0.53;
      promotionTiming = {
        sinkStartTime,
        sinkEndTime,
        riseStartTime,
        riseEndTime,
      };
    }
  }

  // Build unified bystander plans (path step-aside + landing shudder)
  const bystanders: Record<string, BystanderMotionPlan> = {};
  const pathBystanderMap = new Map<Square, RawPathBystander>();
  for (const pb of pathBystanders) {
    pathBystanderMap.set(pb.piece.square, pb);
  }

  let maxBystanderEnd = promotionTiming
    ? promotionTiming.riseEndTime
    : Math.max(moveEndTime, landingTime + 0.24);

  const activeWindowDuration = captureTiming
    ? captureTiming.impactTime - moveStartTime
    : moveDuration;

  for (const piece of boardPiecesBefore) {
    if (excludedSquares.has(piece.square)) continue;

    const pb = pathBystanderMap.get(piece.square);
    const [px, , pz] = squareToWorldPosition(piece.fileIndex, piece.rankIndex);
    const distToLanding = Math.hypot(px - pToX, pz - pToZ);
    const hasShudder = distToLanding <= SHUDDER_RADIUS;

    if (!pb && !hasShudder) continue;

    let stepStartTime = 0;
    let stepEndTime = isDragged ? 0.14 : preStepDuration;
    let returnStartTime = moveEndTime;
    let returnEndTime = moveEndTime;

    if (pb) {
      if (isDragged) {
        returnStartTime = Math.max(landingTime + 0.12, moveEndTime + 0.04);
      } else {
        const passTime =
          moveStartTime + pb.projFraction * activeWindowDuration + 0.14;
        const baseReturnStart =
          pb.projFraction > 0.72
            ? moveEndTime
            : Math.min(moveEndTime, Math.max(moveStartTime + 0.24, passTime));
        returnStartTime = baseReturnStart;
      }

      returnEndTime = returnStartTime + BYSTANDER_RETURN_DURATION;
      maxBystanderEnd = Math.max(maxBystanderEnd, returnEndTime);
    }

    let shudderStartTime: number | null = null;
    let shudderEndTime: number | null = null;
    let shudderStrength = 0;

    if (hasShudder) {
      shudderStartTime = landingTime + distToLanding * 0.025;
      shudderEndTime = shudderStartTime + SHUDDER_DURATION;
      const atten = clamp01(1 - distToLanding / (SHUDDER_RADIUS + 0.25));
      shudderStrength = primaryProfile.weight * atten;
      maxBystanderEnd = Math.max(maxBystanderEnd, shudderEndTime);
    }

    bystanders[piece.square] = {
      square: piece.square,
      offsetX: pb?.offsetX ?? 0,
      offsetZ: pb?.offsetZ ?? 0,
      turnYaw: pb?.turnYaw ?? 0,
      leanRotX: pb?.leanRotX ?? 0,
      leanRotZ: pb?.leanRotZ ?? 0,
      blocked: pb?.blocked ?? false,
      stepStartTime,
      stepEndTime,
      returnStartTime,
      returnEndTime,
      shudderStartTime,
      shudderEndTime,
      shudderStrength,
      shudderPhase: (piece.fileIndex * 1.7 + piece.rankIndex * 2.3) % (Math.PI * 2),
    };
  }

  return {
    preStepDuration,
    moveStartTime,
    moveDuration,
    moveEndTime,
    landingTime,
    totalDuration: maxBystanderEnd,
    primaryProfile,
    secondaryProfile,
    captureTiming,
    promotionTiming,
    stepEvents,
    bystanders,
  };
}

/** Evaluates landing squash-and-stretch on scale at elapsed time */
export function sampleLandingSquash(
  elapsed: number,
  landingTime: number,
  squashAmount: number
): { scaleX: number; scaleY: number; scaleZ: number } {
  const dt = elapsed - landingTime;
  const squashDur = 0.22;
  if (dt < 0 || dt > squashDur || squashAmount <= 0) {
    return { scaleX: 1, scaleY: 1, scaleZ: 1 };
  }
  const u = dt / squashDur;
  const wave = Math.sin(u * Math.PI) * Math.exp(-u * 2.4);
  const sy = 1 - squashAmount * wave;
  const sxz = 1 + squashAmount * 0.55 * wave;
  return { scaleX: sxz, scaleY: sy, scaleZ: sxz };
}

/**
 * Evaluates procedural "living statue" motion for a non-capture segment
 * (also reused for castling rook and capture approach path).
 */
export function sampleProceduralMotion(params: {
  motion: AnimatedPieceMotion;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  t: number; // 0..1 within this motion segment
  dist: number;
}): ProceduralPose {
  const { motion, fromX, fromZ, toX, toZ, t, dist } = params;
  const clamped = clamp01(t);
  const baseFacingY = motion.color === 'w' ? 0 : Math.PI;
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const travelYaw =
    Math.hypot(dx, dz) > 0.02 ? Math.atan2(-dx, -dz) : baseFacingY;
  const facingSign = motion.color === 'w' ? 1 : -1;

  let x = fromX;
  let y = 0;
  let z = fromZ;
  let rotX = 0;
  let rotY = baseFacingY;
  let rotZ = 0;
  let scaleX = 1;
  let scaleY = 1;
  let scaleZ = 1;

  switch (motion.type) {
    case 'p': {
      // Pawn: short stomping steps, shield-forward lean, small bob
      const steps = getStepCountForPiece('p', dist);
      const res = evalPawnSteppedProgress(clamped, steps);
      x = lerp(fromX, toX, res.progress);
      z = lerp(fromZ, toZ, res.progress);
      y = res.liftY;
      rotX = res.pitchX;
      rotZ = res.rollZ;
      rotY = lerpAngle(
        baseFacingY,
        travelYaw,
        Math.sin(clamped * Math.PI) * 0.35
      );
      break;
    }

    case 'r': {
      // Rook: slow acceleration & deceleration, slight rocking
      const e = easeInOutPower(clamped, 3.0);
      x = lerp(fromX, toX, e);
      z = lerp(fromZ, toZ, e);
      const envelope = Math.sin(clamped * Math.PI);
      const rockCycles = Math.max(2, Math.round(dist * 1.4));
      rotZ = Math.sin(clamped * Math.PI * rockCycles) * 0.045 * envelope;
      rotX =
        clamped < 0.32
          ? 0.05 * Math.sin((clamped / 0.32) * Math.PI)
          : clamped > 0.68
            ? -0.06 * Math.sin(((clamped - 0.68) / 0.32) * Math.PI)
            : 0;
      rotY = baseFacingY;
      break;
    }

    case 'n': {
      // Knight: crouch (0..0.18), rear + leap (0.18..0.86), heavy landing squash (0.86..1.0)
      if (clamped < 0.18) {
        const c = clamped / 0.18;
        const cSin = Math.sin(c * Math.PI * 0.5);
        x = fromX;
        z = fromZ;
        y = 0;
        rotX = -0.18 * cSin;
        rotY = lerpAngle(baseFacingY, travelYaw, c * 0.35);
        scaleY = 1 - 0.12 * cSin;
        scaleX = 1 + 0.06 * cSin;
        scaleZ = 1 + 0.06 * cSin;
      } else if (clamped < 0.86) {
        const leapT = (clamped - 0.18) / 0.68;
        const arcProgress = easeInOutQuad(leapT);
        [x, z] = sampleKnightLArc(fromX, fromZ, toX, toZ, arcProgress);
        y = Math.sin(leapT * Math.PI) * 1.38;

        // Rear sharply at takeoff (+rotX) then dive forward into landing (-rotX)
        if (leapT < 0.25) {
          const r = leapT / 0.25;
          rotX = lerp(-0.18, 0.56, easeOutCubic(r));
          scaleY = lerp(0.88, 1.07, easeOutCubic(r));
          scaleX = lerp(1.06, 0.96, easeOutCubic(r));
          scaleZ = scaleX;
        } else {
          const d = (leapT - 0.25) / 0.75;
          rotX = lerp(0.56, -0.4, easeInOutQuad(d));
          scaleY = lerp(1.07, 1.0, easeOutCubic(Math.min(d * 2, 1)));
          scaleX = lerp(0.96, 1.0, easeOutCubic(Math.min(d * 2, 1)));
          scaleZ = scaleX;
        }

        const dirX = toX - x;
        const dirZ = toZ - z;
        const arcYaw =
          Math.hypot(dirX, dirZ) > 0.08
            ? Math.atan2(-dirX, -dirZ)
            : travelYaw;
        rotY = lerpAngle(
          baseFacingY,
          arcYaw,
          Math.sin(leapT * Math.PI) * 0.82
        );
      } else {
        // Heavy landing squash & rebound
        const s = (clamped - 0.86) / 0.14;
        const squashWave = Math.sin(s * Math.PI);
        x = toX;
        z = toZ;
        y = 0;
        rotX = lerp(-0.36, 0, easeOutCubic(s));
        rotY = lerpAngle(travelYaw, baseFacingY, easeOutCubic(s));
        scaleY = 1 - 0.13 * squashWave;
        scaleX = 1 + 0.07 * squashWave;
        scaleZ = 1 + 0.07 * squashWave;
      }
      break;
    }

    case 'b': {
      // Bishop: smooth deliberate glide with a slight sway
      const e = easeInOutCubic(clamped);
      x = lerp(fromX, toX, e);
      z = lerp(fromZ, toZ, e);
      const env = Math.sin(clamped * Math.PI);
      const swayCycles = Math.max(2, Math.round(dist * 0.9));
      y = env * 0.032;
      rotZ = Math.sin(clamped * Math.PI * swayCycles) * 0.048 * env;
      rotX = -0.04 * env;
      rotY = lerpAngle(baseFacingY, travelYaw, env * 0.45);
      break;
    }

    case 'q': {
      // Queen: fast controlled motion with a sharper turn
      const e = easeInOutCubic(clamped);
      x = lerp(fromX, toX, e);
      z = lerp(fromZ, toZ, e);
      const env = Math.sin(clamped * Math.PI);
      rotX = -0.095 * env;

      if (clamped < 0.16) {
        rotY = lerpAngle(baseFacingY, travelYaw, easeOutCubic(clamped / 0.16));
      } else if (clamped > 0.84) {
        rotY = lerpAngle(
          travelYaw,
          baseFacingY,
          easeOutCubic((clamped - 0.84) / 0.16)
        );
      } else {
        rotY = travelYaw;
      }
      break;
    }

    case 'k': {
      // King: very slow, heavy, with a pause before each step
      const steps = getStepCountForPiece('k', dist);
      const res = evalKingSteppedProgress(clamped, steps, facingSign);
      x = lerp(fromX, toX, res.progress);
      z = lerp(fromZ, toZ, res.progress);
      y = res.liftY;
      rotX = res.pitchX;
      rotZ = res.rollZ;
      scaleY = 1 + res.squashY;
      scaleX = 1 - res.squashY * 0.5;
      scaleZ = scaleX;
      rotY = lerpAngle(
        baseFacingY,
        travelYaw,
        Math.sin(clamped * Math.PI) * 0.35
      );
      break;
    }
  }

  return { x, y, z, rotX, rotY, rotZ, scaleX, scaleY, scaleZ };
}

/** Evaluates a bystander's temporary visual offset + turn + landing shudder at `elapsed`. */
export function sampleBystanderTransform(
  plan: BystanderMotionPlan,
  elapsed: number
): BystanderVisualTransform {
  let stepBlend = 0;

  if (
    plan.offsetX !== 0 ||
    plan.offsetZ !== 0 ||
    plan.turnYaw !== 0 ||
    plan.leanRotX !== 0 ||
    plan.leanRotZ !== 0
  ) {
    if (elapsed <= plan.stepStartTime) {
      stepBlend = 0;
    } else if (elapsed < plan.stepEndTime) {
      const dur = Math.max(0.001, plan.stepEndTime - plan.stepStartTime);
      stepBlend = easeOutCubic((elapsed - plan.stepStartTime) / dur);
    } else if (elapsed < plan.returnStartTime) {
      stepBlend = 1;
    } else if (elapsed < plan.returnEndTime) {
      const dur = Math.max(0.001, plan.returnEndTime - plan.returnStartTime);
      stepBlend = 1 - easeInOutCubic((elapsed - plan.returnStartTime) / dur);
    } else {
      stepBlend = 0;
    }
  }

  let localOffsetY = 0;
  let localRotX = 0;
  let localRotZ = 0;

  // Step lift while stepping + lean away from mover (stronger when blocked from stepping)
  if (stepBlend > 0.001) {
    if (!plan.blocked && stepBlend < 0.999) {
      const movingEdge = Math.sin(stepBlend * Math.PI);
      localOffsetY += movingEdge * 0.028;
    }
    localRotX += plan.leanRotX * stepBlend;
    localRotZ += plan.leanRotZ * stepBlend;
  }

  // Landing shockwave shudder
  if (
    plan.shudderStartTime !== null &&
    plan.shudderEndTime !== null &&
    elapsed >= plan.shudderStartTime &&
    elapsed <= plan.shudderEndTime
  ) {
    const dur = Math.max(0.001, plan.shudderEndTime - plan.shudderStartTime);
    const u = (elapsed - plan.shudderStartTime) / dur;
    const decay = Math.exp(-u * 4.2) * Math.sin(u * Math.PI);
    const s = plan.shudderStrength * decay;

    localOffsetY += Math.abs(Math.sin(u * 18 + plan.shudderPhase)) * 0.025 * s;
    localRotX += Math.sin(u * 26 + plan.shudderPhase) * 0.065 * s;
    localRotZ += Math.cos(u * 22 + plan.shudderPhase) * 0.07 * s;
  }

  return {
    worldOffsetX: plan.offsetX * stepBlend,
    worldOffsetZ: plan.offsetZ * stepBlend,
    localOffsetY,
    localTurnY: plan.turnYaw * stepBlend,
    localRotX,
    localRotZ,
  };
}

/** Evaluates the capture defender's brace (leans back, raises guard) before strike. */
export function sampleDefenderBraceTransform(
  brace: DefenderBracePlan,
  elapsed: number
): {
  worldOffsetX: number;
  worldOffsetZ: number;
  localOffsetY: number;
  targetYaw: number | null;
  yawBlend: number;
  localRotX: number;
  localRotZ: number;
} {
  if (elapsed < brace.braceStartTime || elapsed > brace.impactTime) {
    return {
      worldOffsetX: 0,
      worldOffsetZ: 0,
      localOffsetY: 0,
      targetYaw: null,
      yawBlend: 0,
      localRotX: 0,
      localRotZ: 0,
    };
  }

  const braceRampDur = Math.max(
    0.12,
    (brace.strikeStartTime - brace.braceStartTime) * 0.6
  );
  const rampU = clamp01((elapsed - brace.braceStartTime) / braceRampDur);
  const braceEase = easeOutCubic(rampU);

  const guardPulse =
    elapsed >= brace.strikeStartTime
      ? Math.sin(((elapsed - brace.strikeStartTime) / 0.12) * Math.PI) * 0.04
      : Math.sin((elapsed - brace.braceStartTime) * 28) * 0.014 * braceEase;

  return {
    // Recoil slightly away from attacker while planting feet
    worldOffsetX: brace.recoilDirX * 0.075 * braceEase,
    worldOffsetZ: brace.recoilDirZ * 0.075 * braceEase,
    localOffsetY: -0.025 * braceEase,
    targetYaw: brace.faceAttackerYaw,
    yawBlend: braceEase,
    // Positive rotX leans back away from attacker (in YXZ order), rotZ raises shield/guard shoulder
    localRotX: 0.28 * braceEase + guardPulse,
    localRotZ: -0.24 * braceEase,
  };
}
