import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type RefObject,
} from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Physics } from '@react-three/cannon';
import {
  Bloom,
  EffectComposer,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import type { Color, Square } from 'chess.js';
import * as THREE from 'three';
import {
  coordsToSquare,
  squareToCoords,
  squareToWorldPosition,
  type ActiveMoveAnimation,
  type BoardPiece,
  type DebrisBurstData,
  type GameStatus,
  type LastMove,
  type LegalTarget,
  type PendingPromotion,
  type PendingTutorWarning,
} from '../game/chessTypes';
import { ChessBoard3D } from './ChessBoard3D';
import { ChessPiece3D, type DragRuntimeState } from './ChessPiece3D';
import { StoneChamber3D } from './StoneChamber3D';
import { DustBurstSystem, type DustBurstHandle } from './DustBurstSystem';
import { CameraShakeRig, type CameraShakeHandle } from './CameraShakeRig';
import {
  ImpactFlashSystem,
  type ImpactFlashHandle,
} from './ImpactFlashSystem';
import { CaptureDebrisSystem } from './CaptureDebrisSystem';
import { AnimatedMoveLayer } from './AnimatedMoveLayer';
import {
  CheckmateSequence3D,
  type OrbitControlsHandle,
} from './CheckmateSequence3D';
import { isSoftwareWebGL } from '../utils/webglDetect';

interface PendingTutorEvalInfo {
  from: Square;
  to: Square;
  isDragged: boolean;
}

interface Scene3DProps {
  hasStarted: boolean;
  perspectiveColor?: Color;
  pieces: BoardPiece[];
  status: GameStatus;
  selectedSquare: Square | null;
  legalTargets: Map<Square, LegalTarget>;
  lastMove: LastMove | null;
  activeAnimation: ActiveMoveAnimation | null;
  isAnimating: boolean;
  isHumanTurn: boolean;
  isAiThinking: boolean;
  isTutorEvaluating: boolean;
  pendingPromotion: PendingPromotion | null;
  pendingTutorEval: PendingTutorEvalInfo | null;
  tutorWarning: PendingTutorWarning | null;
  isCheckmateSequenceActive: boolean;
  onSelectSquare: (square: Square) => void;
  onSelectSquareForDrag: (square: Square) => void;
  onDropMove: (from: Square, to: Square) => boolean;
  onProceedTutorMove: () => void;
  onUndoTutorMove: () => void;
  onAnimationComplete: (animationId: number) => void;
  onCheckmateSequenceComplete: () => void;
}

const WHITE_CAM_POS = new THREE.Vector3(0, 8.0, 9.2);
const BLACK_CAM_POS = new THREE.Vector3(0, 8.0, -9.2);
const DEFAULT_TARGET = new THREE.Vector3(0, 0, 0);
const BOARD_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _dragRaycaster = new THREE.Raycaster();
const _dragNdc = new THREE.Vector2();
const _dragPlaneHit = new THREE.Vector3();
const DRAG_PIXEL_THRESHOLD = 5;

function raycastBoardPlane(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  domElement: HTMLElement
): { square: Square | null; worldX: number; worldZ: number } | null {
  const rect = domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  _dragNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  _dragRaycaster.setFromCamera(_dragNdc, camera);
  if (!_dragRaycaster.ray.intersectPlane(BOARD_PLANE, _dragPlaneHit)) {
    return null;
  }

  const fileIndex = Math.floor(_dragPlaneHit.x + 4);
  const rankIndex = Math.floor(4 - _dragPlaneHit.z);
  const square =
    fileIndex >= 0 && fileIndex <= 7 && rankIndex >= 0 && rankIndex <= 7
      ? coordsToSquare(fileIndex, rankIndex)
      : null;

  return {
    square,
    worldX: THREE.MathUtils.clamp(_dragPlaneHit.x, -4.15, 4.15),
    worldZ: THREE.MathUtils.clamp(_dragPlaneHit.z, -4.15, 4.15),
  };
}

function computeDragHoldWorldPosition(
  from: Square,
  to: Square,
  hasVictim: boolean
): [number, number, number] {
  const toCoords = squareToCoords(to);
  const toPos = squareToWorldPosition(toCoords.fileIndex, toCoords.rankIndex, 0.28);
  if (!hasVictim) {
    return toPos;
  }
  const fromCoords = squareToCoords(from);
  const fromPos = squareToWorldPosition(
    fromCoords.fileIndex,
    fromCoords.rankIndex,
    0.28
  );
  const dx = fromPos[0] - toPos[0];
  const dz = fromPos[2] - toPos[2];
  const dist = Math.hypot(dx, dz) || 1;
  const offset = Math.min(0.36, dist * 0.45);
  return [
    toPos[0] + (dx / dist) * offset,
    0.28,
    toPos[2] + (dz / dist) * offset,
  ];
}

function createIdleDragState(): DragRuntimeState {
  return {
    status: 'idle',
    square: null,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    hasMoved: false,
    wasAlreadySelected: false,
    currentX: 0,
    currentY: 0,
    currentZ: 0,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    returnStartX: 0,
    returnStartY: 0,
    returnStartZ: 0,
    returnProgress: 0,
  };
}

function BoardDragController({
  isDraggingPiece,
  dragRuntimeRef,
  onDragHoverChange,
  onEndDragPointerUp,
  onCancelDrag,
}: {
  isDraggingPiece: boolean;
  dragRuntimeRef: RefObject<DragRuntimeState>;
  onDragHoverChange: (square: Square | null) => void;
  onEndDragPointerUp: (dropSquare: Square | null) => void;
  onCancelDrag: (clearSelection: boolean) => void;
}) {
  const { camera, gl } = useThree();

  const onDragHoverRef = useRef(onDragHoverChange);
  onDragHoverRef.current = onDragHoverChange;
  const onEndRef = useRef(onEndDragPointerUp);
  onEndRef.current = onEndDragPointerUp;
  const onCancelRef = useRef(onCancelDrag);
  onCancelRef.current = onCancelDrag;

  useEffect(() => {
    if (!isDraggingPiece) return;

    const handlePointerMove = (e: PointerEvent) => {
      const rt = dragRuntimeRef.current;
      if (rt.status !== 'dragging' || rt.pointerId !== e.pointerId) return;

      const distPx = Math.hypot(
        e.clientX - rt.startClientX,
        e.clientY - rt.startClientY
      );
      if (!rt.hasMoved) {
        if (distPx < DRAG_PIXEL_THRESHOLD) return;
        rt.hasMoved = true;
        document.body.style.cursor = 'grabbing';
      }

      const hit = raycastBoardPlane(e.clientX, e.clientY, camera, gl.domElement);
      if (hit) {
        rt.targetX = hit.worldX;
        rt.targetY = 0.34;
        rt.targetZ = hit.worldZ;
        onDragHoverRef.current(hit.square);
      } else {
        onDragHoverRef.current(null);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const rt = dragRuntimeRef.current;
      if (rt.status !== 'dragging' || rt.pointerId !== e.pointerId) return;

      let dropSquare: Square | null = null;
      if (rt.hasMoved) {
        const hit = raycastBoardPlane(
          e.clientX,
          e.clientY,
          camera,
          gl.domElement
        );
        dropSquare = hit?.square ?? null;
      }
      onEndRef.current(dropSquare);
    };

    const handlePointerCancel = (e: PointerEvent) => {
      const rt = dragRuntimeRef.current;
      if (rt.status !== 'dragging' || rt.pointerId !== e.pointerId) return;
      onCancelRef.current(false);
    };

    const handleWindowPointerDown = (e: PointerEvent) => {
      const rt = dragRuntimeRef.current;
      if (rt.status !== 'dragging') return;
      if (e.button === 2) {
        e.preventDefault();
        onCancelRef.current(true);
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (dragRuntimeRef.current.status === 'dragging') {
        e.preventDefault();
        onCancelRef.current(true);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRuntimeRef.current.status === 'dragging') {
        e.preventDefault();
        onCancelRef.current(true);
      }
    };

    const handleBlur = () => {
      if (dragRuntimeRef.current.status === 'dragging') {
        onCancelRef.current(false);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('pointerdown', handleWindowPointerDown, true);
    window.addEventListener('contextmenu', handleContextMenu, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('pointerdown', handleWindowPointerDown, true);
      window.removeEventListener('contextmenu', handleContextMenu, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isDraggingPiece, camera, gl, dragRuntimeRef]);

  return null;
}

function CameraResetRig({
  resetSignal,
  snapSignal,
  targetCamPos,
  controlsRef,
  isCancelledRef,
}: {
  resetSignal: number;
  snapSignal: number;
  targetCamPos: THREE.Vector3;
  controlsRef: RefObject<OrbitControlsHandle | null>;
  isCancelledRef: RefObject<boolean>;
}) {
  const { camera } = useThree();
  const activeRef = useRef(false);

  useEffect(() => {
    if (snapSignal > 0) {
      activeRef.current = false;
      isCancelledRef.current = false;
      camera.position.copy(targetCamPos);
      if (controlsRef.current) {
        controlsRef.current.target.copy(DEFAULT_TARGET);
        controlsRef.current.update();
      } else {
        camera.lookAt(DEFAULT_TARGET);
      }
    }
  }, [snapSignal, targetCamPos, camera, controlsRef, isCancelledRef]);

  useEffect(() => {
    if (resetSignal > 0) {
      activeRef.current = true;
      isCancelledRef.current = false;
    }
  }, [resetSignal, isCancelledRef]);

  useFrame((_, delta) => {
    if (!activeRef.current) return;
    if (isCancelledRef.current) {
      activeRef.current = false;
      return;
    }

    const dt = Math.min(delta, 0.05);
    camera.position.x = THREE.MathUtils.damp(
      camera.position.x,
      targetCamPos.x,
      4.5,
      dt
    );
    camera.position.y = THREE.MathUtils.damp(
      camera.position.y,
      targetCamPos.y,
      4.5,
      dt
    );
    camera.position.z = THREE.MathUtils.damp(
      camera.position.z,
      targetCamPos.z,
      4.5,
      dt
    );

    if (controlsRef.current) {
      controlsRef.current.target.x = THREE.MathUtils.damp(
        controlsRef.current.target.x,
        DEFAULT_TARGET.x,
        5.0,
        dt
      );
      controlsRef.current.target.y = THREE.MathUtils.damp(
        controlsRef.current.target.y,
        DEFAULT_TARGET.y,
        5.0,
        dt
      );
      controlsRef.current.target.z = THREE.MathUtils.damp(
        controlsRef.current.target.z,
        DEFAULT_TARGET.z,
        5.0,
        dt
      );
      controlsRef.current.update();
    }

    if (camera.position.distanceTo(targetCamPos) < 0.05) {
      camera.position.copy(targetCamPos);
      if (controlsRef.current) {
        controlsRef.current.target.copy(DEFAULT_TARGET);
        controlsRef.current.update();
      }
      activeRef.current = false;
    }
  });

  return null;
}

function MovementClockRunner({
  activeAnimationId,
  elapsedRef,
}: {
  activeAnimationId: number | null;
  elapsedRef: RefObject<number>;
}) {
  const prevRenderIdRef = useRef<number | null>(null);
  if (prevRenderIdRef.current !== activeAnimationId) {
    prevRenderIdRef.current = activeAnimationId;
    elapsedRef.current = 0;
  }

  useEffect(() => {
    elapsedRef.current = 0;
  }, [activeAnimationId, elapsedRef]);

  useFrame((_, delta) => {
    if (activeAnimationId === null) {
      elapsedRef.current = 0;
      return;
    }
    elapsedRef.current += Math.min(delta, 0.05);
  });

  return null;
}

export function Scene3D({
  hasStarted,
  perspectiveColor = 'w',
  pieces,
  status,
  selectedSquare,
  legalTargets,
  lastMove,
  activeAnimation,
  isAnimating,
  isHumanTurn,
  isAiThinking,
  isTutorEvaluating,
  pendingPromotion,
  pendingTutorEval,
  tutorWarning,
  isCheckmateSequenceActive,
  onSelectSquare,
  onSelectSquareForDrag,
  onDropMove,
  onProceedTutorMove,
  onUndoTutorMove,
  onAnimationComplete,
  onCheckmateSequenceComplete,
}: Scene3DProps) {
  const dustRef = useRef<DustBurstHandle>(null);
  const shakeRef = useRef<CameraShakeHandle>(null);
  const flashRef = useRef<ImpactFlashHandle>(null);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const resetCancelledRef = useRef(false);
  const prevCheckmateActiveRef = useRef(false);
  const prevPerspectiveRef = useRef<Color>(perspectiveColor);
  const burstCounterRef = useRef(0);

  const [debrisBursts, setDebrisBursts] = useState<DebrisBurstData[]>([]);
  const [impactedAnimId, setImpactedAnimId] = useState<number | null>(null);
  const [doorUnlocked, setDoorUnlocked] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [cameraResetSignal, setCameraResetSignal] = useState(0);
  const [cameraSnapSignal, setCameraSnapSignal] = useState(0);
  const [draggedSquare, setDraggedSquare] = useState<Square | null>(null);
  const [dragHoverSquare, setDragHoverSquare] = useState<Square | null>(null);

  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const movementElapsedRef = useRef(0);
  const dragRuntimeRef = useRef<DragRuntimeState>(createIdleDragState());
  const suppressClickUntilRef = useRef(0);
  const lastHeldRef = useRef<{
    from: Square;
    holdPos: [number, number, number];
  } | null>(null);

  const selectedSquareRef = useRef(selectedSquare);
  selectedSquareRef.current = selectedSquare;
  const legalTargetsRef = useRef(legalTargets);
  legalTargetsRef.current = legalTargets;

  const softwareGl = useMemo(() => isSoftwareWebGL(), []);
  const targetCamPos = perspectiveColor === 'b' ? BLACK_CAM_POS : WHITE_CAM_POS;

  useEffect(() => {
    if (prevPerspectiveRef.current !== perspectiveColor) {
      prevPerspectiveRef.current = perspectiveColor;
      setCameraSnapSignal((s) => s + 1);
    }
  }, [perspectiveColor]);

  // Reset leftover debris and smoothly restore camera when starting a new game
  useEffect(() => {
    if (lastMove === null && !activeAnimation) {
      setDebrisBursts([]);
      setImpactedAnimId(null);
    }
  }, [lastMove, activeAnimation]);

  useEffect(() => {
    if (!isCheckmateSequenceActive) {
      setDoorUnlocked(false);
    }
    if (prevCheckmateActiveRef.current && !isCheckmateSequenceActive) {
      setCameraResetSignal((s) => s + 1);
    }
    prevCheckmateActiveRef.current = isCheckmateSequenceActive;
  }, [isCheckmateSequenceActive]);

  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return;

    const handleLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleRestored = () => {
      setContextLost(false);
    };

    el.addEventListener('webglcontextlost', handleLost);
    el.addEventListener('webglcontextrestored', handleRestored);
    return () => {
      el.removeEventListener('webglcontextlost', handleLost);
      el.removeEventListener('webglcontextrestored', handleRestored);
    };
  }, []);

  const handleCaptureImpact = useCallback(
    (params: {
      victimSquare: Square;
      victimColor: Color;
      position: [number, number, number];
      strikeDir: [number, number];
    }) => {
      if (activeAnimation) {
        setImpactedAnimId(activeAnimation.id);
      }
      burstCounterRef.current += 1;
      const burstId = burstCounterRef.current;
      setDebrisBursts((prev) => [
        ...prev,
        {
          id: burstId,
          color: params.victimColor,
          position: params.position,
          strikeDir: params.strikeDir,
        },
      ]);
    },
    [activeAnimation]
  );

  const handleBurstExpired = useCallback((burstId: number) => {
    setDebrisBursts((prev) => prev.filter((b) => b.id !== burstId));
  }, []);

  const hiddenSquares = new Set<Square>();
  if (activeAnimation) {
    hiddenSquares.add(activeAnimation.primary.to);
    if (activeAnimation.secondary) {
      hiddenSquares.add(activeAnimation.secondary.to);
    }
  }
  if (isCheckmateSequenceActive && status.checkedSquare) {
    hiddenSquares.add(status.checkedSquare);
  }

  const victimToRender: BoardPiece | null =
    activeAnimation?.kind === 'capture' &&
    activeAnimation.capture &&
    impactedAnimId !== activeAnimation.id
      ? {
          id: `victim-hold-${activeAnimation.id}`,
          square: activeAnimation.capture.victimSquare,
          type: activeAnimation.capture.victimType,
          color: activeAnimation.capture.victimColor,
          fileIndex: activeAnimation.capture.victimCoords.fileIndex,
          rankIndex: activeAnimation.capture.victimCoords.rankIndex,
        }
      : null;

  const inputLocked =
    isAnimating ||
    isAiThinking ||
    isTutorEvaluating ||
    Boolean(tutorWarning) ||
    !isHumanTurn;

  const heldAtTarget = useMemo(() => {
    const active = pendingPromotion?.isDragged
      ? { from: pendingPromotion.from, to: pendingPromotion.to }
      : pendingTutorEval?.isDragged
        ? { from: pendingTutorEval.from, to: pendingTutorEval.to }
        : tutorWarning?.isDragged
          ? { from: tutorWarning.from, to: tutorWarning.to }
          : null;
    if (!active) return null;
    const hasVictim = pieces.some((p) => p.square === active.to);
    return {
      from: active.from,
      to: active.to,
      holdPos: computeDragHoldWorldPosition(active.from, active.to, hasVictim),
    };
  }, [pendingPromotion, pendingTutorEval, tutorWarning, pieces]);

  useLayoutEffect(() => {
    if (activeAnimation) {
      if (dragRuntimeRef.current.status !== 'idle') {
        dragRuntimeRef.current.status = 'idle';
        dragRuntimeRef.current.square = null;
      }
      lastHeldRef.current = null;
      return;
    }

    if (lastHeldRef.current && !heldAtTarget) {
      const prevHeld = lastHeldRef.current;
      const rt = dragRuntimeRef.current;
      rt.status = 'returning';
      rt.square = prevHeld.from;
      rt.pointerId = null;
      rt.hasMoved = true;
      rt.currentX = prevHeld.holdPos[0];
      rt.currentY = prevHeld.holdPos[1];
      rt.currentZ = prevHeld.holdPos[2];
      rt.returnStartX = prevHeld.holdPos[0];
      rt.returnStartY = prevHeld.holdPos[1];
      rt.returnStartZ = prevHeld.holdPos[2];
      rt.returnProgress = 0;
      lastHeldRef.current = null;
      return;
    }

    if (heldAtTarget) {
      lastHeldRef.current = {
        from: heldAtTarget.from,
        holdPos: heldAtTarget.holdPos,
      };
    }
  }, [activeAnimation, heldAtTarget]);

  const finishDragSession = useCallback(
    (restoreControls = true) => {
      setDraggedSquare(null);
      setDragHoverSquare(null);
      document.body.style.cursor = 'auto';
      suppressClickUntilRef.current = performance.now() + 80;
      if (restoreControls && controlsRef.current && !isCheckmateSequenceActive) {
        controlsRef.current.enabled = true;
      }
    },
    [isCheckmateSequenceActive]
  );

  const handlePiecePointerDown = useCallback(
    (square: Square, e: ThreeEvent<PointerEvent>) => {
      if (
        inputLocked ||
        status.isGameOver ||
        pendingPromotion ||
        dragRuntimeRef.current.status === 'dragging'
      ) {
        return;
      }

      const piece = pieces.find((p) => p.square === square);
      if (!piece) return;

      const wasAlreadySelected = selectedSquareRef.current === square;
      const homePos = squareToWorldPosition(
        piece.fileIndex,
        piece.rankIndex,
        wasAlreadySelected ? 0.18 : 0
      );

      if (controlsRef.current) {
        controlsRef.current.enabled = false;
      }

      const rt = dragRuntimeRef.current;
      rt.status = 'dragging';
      rt.square = square;
      rt.pointerId = e.pointerId;
      rt.startClientX = e.clientX;
      rt.startClientY = e.clientY;
      rt.hasMoved = false;
      rt.wasAlreadySelected = wasAlreadySelected;
      rt.currentX = homePos[0];
      rt.currentY = homePos[1];
      rt.currentZ = homePos[2];
      rt.targetX = homePos[0];
      rt.targetY = 0.24;
      rt.targetZ = homePos[2];
      rt.returnProgress = 0;

      setDraggedSquare(square);
      setDragHoverSquare(null);
      onSelectSquareForDrag(square);
    },
    [inputLocked, status.isGameOver, pendingPromotion, pieces, onSelectSquareForDrag]
  );

  const handleEndDragPointerUp = useCallback(
    (dropSquare: Square | null) => {
      const rt = dragRuntimeRef.current;
      if (rt.status !== 'dragging' || !rt.square) return;
      const fromSquare = rt.square;

      if (!rt.hasMoved) {
        rt.status = 'returning';
        rt.pointerId = null;
        rt.returnStartX = rt.currentX;
        rt.returnStartY = rt.currentY;
        rt.returnStartZ = rt.currentZ;
        rt.returnProgress = 0;
        finishDragSession(true);
        if (rt.wasAlreadySelected) {
          onSelectSquare(fromSquare);
        }
        return;
      }

      if (
        dropSquare &&
        dropSquare !== fromSquare &&
        legalTargetsRef.current.has(dropSquare)
      ) {
        const accepted = onDropMove(fromSquare, dropSquare);
        if (accepted) {
          rt.status = 'idle';
          rt.square = null;
          rt.pointerId = null;
          finishDragSession(true);
          return;
        }
      }

      rt.status = 'returning';
      rt.pointerId = null;
      rt.returnStartX = rt.currentX;
      rt.returnStartY = rt.currentY;
      rt.returnStartZ = rt.currentZ;
      rt.returnProgress = 0;
      finishDragSession(true);
    },
    [finishDragSession, onSelectSquare, onDropMove]
  );

  const handleCancelDrag = useCallback(
    (clearSelection: boolean) => {
      const rt = dragRuntimeRef.current;
      if (rt.status !== 'dragging' || !rt.square) return;
      const fromSquare = rt.square;
      rt.status = 'returning';
      rt.pointerId = null;
      rt.returnStartX = rt.currentX;
      rt.returnStartY = rt.currentY;
      rt.returnStartZ = rt.currentZ;
      rt.returnProgress = 0;
      finishDragSession(true);
      if (clearSelection && selectedSquareRef.current === fromSquare) {
        onSelectSquare(fromSquare);
      }
    },
    [finishDragSession, onSelectSquare]
  );

  const handleDragHoverChange = useCallback((square: Square | null) => {
    setDragHoverSquare((prev) => (prev === square ? prev : square));
  }, []);

  // Cancel active drag cleanly if input becomes locked or game ends mid-drag
  useEffect(() => {
    if (
      draggedSquare &&
      (inputLocked || status.isGameOver || Boolean(pendingPromotion))
    ) {
      handleCancelDrag(false);
    }
  }, [
    draggedSquare,
    inputLocked,
    status.isGameOver,
    pendingPromotion,
    handleCancelDrag,
  ]);

  if (contextLost) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#080c14] p-6 text-center">
        <div className="max-w-md border border-white/10 bg-[#10141d] p-6">
          <h2 className="font-display text-lg text-[#efe9dc]">
            3D Viewport Paused
          </h2>
          <p className="mt-2 text-sm text-[#9aa3b2]">
            WebGL rendering context was interrupted. Waiting to restore the
            stone chamber.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Canvas
      className="touch-none"
      shadows
      flat={!softwareGl}
      dpr={softwareGl ? 1 : [1, 2]}
      gl={{
        antialias: !softwareGl,
        powerPreference: 'high-performance',
        toneMapping: softwareGl
          ? THREE.ACESFilmicToneMapping
          : THREE.NoToneMapping,
        toneMappingExposure: 1.1,
      }}
      camera={{ position: [0, 8.0, 9.2], fov: 44, near: 0.1, far: 80 }}
      onCreated={({ gl }) => {
        canvasElRef.current = gl.domElement;
      }}
      onPointerMissed={() => {
        if (performance.now() < suppressClickUntilRef.current) return;
        if (!inputLocked && !draggedSquare && selectedSquare) {
          onSelectSquare(selectedSquare);
        }
      }}
    >
      <color attach="background" args={['#080c14']} />
      <fog attach="fog" args={['#080c14', 12, 34]} />

      <Environment resolution={128} frames={1}>
        <Lightformer
          form="rect"
          intensity={3.5}
          color="#7db2ff"
          position={[0, 10, -1]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[6, 6, 1]}
        />
        <Lightformer
          form="circle"
          intensity={2.6}
          color="#ff8133"
          position={[-8, 3, -9]}
          scale={[3, 3, 1]}
        />
        <Lightformer
          form="circle"
          intensity={2.6}
          color="#ff8133"
          position={[8, 3, -9]}
          scale={[3, 3, 1]}
        />
        <Lightformer
          form="circle"
          intensity={2.0}
          color="#ff7a29"
          position={[-11, 3, -4]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[3, 3, 1]}
        />
        <Lightformer
          form="circle"
          intensity={2.0}
          color="#ff7a29"
          position={[11, 3, -4]}
          rotation={[0, -Math.PI / 2, 0]}
          scale={[3, 3, 1]}
        />
      </Environment>

      <hemisphereLight args={['#4a6fa5', '#1a120c', 0.48]} />

      <directionalLight
        position={[2.5, 16, -1.5]}
        intensity={1.55}
        color="#84b4ff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={2}
        shadow-camera-far={30}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-bias={-0.0004}
      />

      <spotLight
        position={[0.8, 12.6, -0.8]}
        angle={0.56}
        penumbra={0.78}
        intensity={26}
        distance={26}
        decay={1.4}
        color="#79acff"
      />

      <mesh position={[0.4, 6.2, -0.4]}>
        <coneGeometry args={[6.4, 13.5, 32, 1, true]} />
        <meshBasicMaterial
          color="#6aa0ff"
          transparent
          opacity={0.025}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <MovementClockRunner
        activeAnimationId={activeAnimation?.id ?? null}
        elapsedRef={movementElapsedRef}
      />

      <BoardDragController
        isDraggingPiece={draggedSquare !== null}
        dragRuntimeRef={dragRuntimeRef}
        onDragHoverChange={handleDragHoverChange}
        onEndDragPointerUp={handleEndDragPointerUp}
        onCancelDrag={handleCancelDrag}
      />

      <CameraShakeRig ref={shakeRef} />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enabled={!isCheckmateSequenceActive && draggedSquare === null}
        enablePan={false}
        enableDamping={!softwareGl}
        dampingFactor={0.07}
        minDistance={6.5}
        maxDistance={13.2}
        minPolarAngle={Math.PI / 9}
        maxPolarAngle={Math.PI / 2.32}
        minAzimuthAngle={perspectiveColor === 'b' ? -Infinity : -Math.PI / 2.6}
        maxAzimuthAngle={perspectiveColor === 'b' ? Infinity : Math.PI / 2.6}
        onStart={() => {
          resetCancelledRef.current = true;
        }}
      />

      <CameraResetRig
        resetSignal={cameraResetSignal}
        snapSignal={cameraSnapSignal}
        targetCamPos={targetCamPos}
        controlsRef={controlsRef}
        isCancelledRef={resetCancelledRef}
      />

      <StoneChamber3D
        hasStarted={hasStarted}
        isDoorUnlocked={doorUnlocked}
      />

      <ChessBoard3D
        selectedSquare={selectedSquare}
        legalTargets={legalTargets}
        checkedSquare={status.checkedSquare}
        lastMove={lastMove}
        isAnimating={inputLocked}
        dragHoverSquare={dragHoverSquare}
        isDraggingPiece={draggedSquare !== null}
        suppressClickUntilRef={suppressClickUntilRef}
        onSelectSquare={onSelectSquare}
      />

      {pieces.map((piece) => {
        if (hiddenSquares.has(piece.square)) return null;

        const isFriendly = piece.color === status.turn;
        const isCaptureTarget = legalTargets.get(piece.square)?.isCapture;
        const canInteract =
          !inputLocked &&
          !status.isGameOver &&
          (isFriendly || Boolean(isCaptureTarget));
        const canDrag =
          !inputLocked &&
          !status.isGameOver &&
          !pendingPromotion &&
          isFriendly;
        const isInCheck =
          piece.type === 'k' && status.checkedSquare === piece.square;
        const activeWarning =
          tutorWarning && tutorWarning.from === piece.square
            ? tutorWarning
            : null;
        const dragHoldPosition =
          heldAtTarget && heldAtTarget.from === piece.square
            ? heldAtTarget.holdPos
            : null;

        const bystanderMotion =
          activeAnimation?.choreography.bystanders[piece.square] ?? null;

        return (
          <ChessPiece3D
            key={piece.id}
            piece={piece}
            isSelected={selectedSquare === piece.square}
            isInCheck={isInCheck}
            canInteract={canInteract}
            canDrag={canDrag}
            isDraggedPiece={draggedSquare === piece.square}
            dragRuntimeRef={dragRuntimeRef}
            dragHoldPosition={dragHoldPosition}
            suppressClickUntilRef={suppressClickUntilRef}
            tutorWarning={activeWarning}
            bystanderMotion={bystanderMotion}
            animationElapsedRef={movementElapsedRef}
            onProceedTutorMove={onProceedTutorMove}
            onUndoTutorMove={onUndoTutorMove}
            onPiecePointerDown={handlePiecePointerDown}
            onSelectSquare={onSelectSquare}
          />
        );
      })}

      {victimToRender && (
        <ChessPiece3D
          key={victimToRender.id}
          piece={victimToRender}
          isSelected={false}
          canInteract={false}
          defenderBrace={
            activeAnimation?.choreography.captureTiming?.defenderBrace ?? null
          }
          animationElapsedRef={movementElapsedRef}
          onSelectSquare={onSelectSquare}
        />
      )}

      {isCheckmateSequenceActive && status.checkedSquare && (
        <CheckmateSequence3D
          kingSquare={status.checkedSquare}
          kingColor={status.turn}
          controlsRef={controlsRef}
          dustRef={dustRef}
          shakeRef={shakeRef}
          onCrownDropped={() => setDoorUnlocked(true)}
          onSequenceComplete={onCheckmateSequenceComplete}
        />
      )}

      <AnimatedMoveLayer
        animation={activeAnimation}
        elapsedRef={movementElapsedRef}
        dustRef={dustRef}
        shakeRef={shakeRef}
        flashRef={flashRef}
        onCaptureImpact={handleCaptureImpact}
        onAnimationComplete={onAnimationComplete}
      />

      <Physics
        gravity={[0, -18, 0]}
        allowSleep
        defaultContactMaterial={{ restitution: 0.38, friction: 0.55 }}
      >
        <CaptureDebrisSystem
          bursts={debrisBursts}
          onBurstExpired={handleBurstExpired}
        />
      </Physics>

      <DustBurstSystem ref={dustRef} />
      <ImpactFlashSystem ref={flashRef} />

      {!softwareGl && (
        <EffectComposer enableNormalPass={false} multisampling={0}>
          <Bloom
            mipmapBlur
            luminanceThreshold={1.05}
            luminanceSmoothing={0.35}
            intensity={0.62}
          />
          <Vignette eskil={false} offset={0.2} darkness={0.64} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
