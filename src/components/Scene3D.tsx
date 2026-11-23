import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type RefObject,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
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
import type {
  ActiveMoveAnimation,
  BoardPiece,
  DebrisBurstData,
  GameStatus,
  LastMove,
  LegalTarget,
} from '../game/chessTypes';
import { ChessBoard3D } from './ChessBoard3D';
import { ChessPiece3D } from './ChessPiece3D';
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

interface Scene3DProps {
  hasStarted: boolean;
  pieces: BoardPiece[];
  status: GameStatus;
  selectedSquare: Square | null;
  legalTargets: Map<Square, LegalTarget>;
  lastMove: LastMove | null;
  activeAnimation: ActiveMoveAnimation | null;
  isAnimating: boolean;
  isHumanTurn: boolean;
  isAiThinking: boolean;
  isCheckmateSequenceActive: boolean;
  onSelectSquare: (square: Square) => void;
  onAnimationComplete: (animationId: number) => void;
  onCheckmateSequenceComplete: () => void;
}

const DEFAULT_CAM_POS = new THREE.Vector3(0, 8.0, 9.2);
const DEFAULT_TARGET = new THREE.Vector3(0, 0, 0);

function CameraResetRig({
  resetSignal,
  controlsRef,
  isCancelledRef,
}: {
  resetSignal: number;
  controlsRef: RefObject<OrbitControlsHandle | null>;
  isCancelledRef: RefObject<boolean>;
}) {
  const { camera } = useThree();
  const activeRef = useRef(false);

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
      DEFAULT_CAM_POS.x,
      4.5,
      dt
    );
    camera.position.y = THREE.MathUtils.damp(
      camera.position.y,
      DEFAULT_CAM_POS.y,
      4.5,
      dt
    );
    camera.position.z = THREE.MathUtils.damp(
      camera.position.z,
      DEFAULT_CAM_POS.z,
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

    if (camera.position.distanceTo(DEFAULT_CAM_POS) < 0.05) {
      camera.position.copy(DEFAULT_CAM_POS);
      if (controlsRef.current) {
        controlsRef.current.target.copy(DEFAULT_TARGET);
        controlsRef.current.update();
      }
      activeRef.current = false;
    }
  });

  return null;
}

export function Scene3D({
  hasStarted,
  pieces,
  status,
  selectedSquare,
  legalTargets,
  lastMove,
  activeAnimation,
  isAnimating,
  isHumanTurn,
  isAiThinking,
  isCheckmateSequenceActive,
  onSelectSquare,
  onAnimationComplete,
  onCheckmateSequenceComplete,
}: Scene3DProps) {
  const dustRef = useRef<DustBurstHandle>(null);
  const shakeRef = useRef<CameraShakeHandle>(null);
  const flashRef = useRef<ImpactFlashHandle>(null);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const resetCancelledRef = useRef(false);
  const prevCheckmateActiveRef = useRef(false);
  const burstCounterRef = useRef(0);

  const [debrisBursts, setDebrisBursts] = useState<DebrisBurstData[]>([]);
  const [impactedAnimId, setImpactedAnimId] = useState<number | null>(null);
  const [doorUnlocked, setDoorUnlocked] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [cameraResetSignal, setCameraResetSignal] = useState(0);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);

  const softwareGl = useMemo(() => isSoftwareWebGL(), []);

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

  const inputLocked = isAnimating || isAiThinking || !isHumanTurn;

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
        if (!inputLocked && selectedSquare) {
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

      <CameraShakeRig ref={shakeRef} />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enabled={!isCheckmateSequenceActive}
        enablePan={false}
        enableDamping={!softwareGl}
        dampingFactor={0.07}
        minDistance={6.5}
        maxDistance={13.2}
        minPolarAngle={Math.PI / 9}
        maxPolarAngle={Math.PI / 2.32}
        minAzimuthAngle={-Math.PI / 2.6}
        maxAzimuthAngle={Math.PI / 2.6}
        onStart={() => {
          resetCancelledRef.current = true;
        }}
      />

      <CameraResetRig
        resetSignal={cameraResetSignal}
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
        const isInCheck =
          piece.type === 'k' && status.checkedSquare === piece.square;

        return (
          <ChessPiece3D
            key={piece.id}
            piece={piece}
            isSelected={selectedSquare === piece.square}
            isInCheck={isInCheck}
            canInteract={canInteract}
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
