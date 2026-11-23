import { useMemo, type ReactElement } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { Square } from 'chess.js';
import {
  coordsToSquare,
  isLightSquare,
  squareToWorldPosition,
  TILE_SIZE,
  type LastMove,
  type LegalTarget,
} from '../game/chessTypes';
import {
  getChamberStoneTextures,
  getMarbleTextures,
  getObsidianTextures,
} from '../utils/proceduralTextures';

interface ChessBoard3DProps {
  selectedSquare: Square | null;
  legalTargets: Map<Square, LegalTarget>;
  checkedSquare: Square | null;
  lastMove: LastMove | null;
  isAnimating: boolean;
  onSelectSquare: (square: Square) => void;
}

export function ChessBoard3D({
  selectedSquare,
  legalTargets,
  checkedSquare,
  lastMove,
  isAnimating,
  onSelectSquare,
}: ChessBoard3DProps) {
  const marbleTex = useMemo(() => getMarbleTextures(), []);
  const obsidianTex = useMemo(() => getObsidianTextures(), []);
  const borderTex = useMemo(() => getChamberStoneTextures(), []);

  const tiles: ReactElement[] = [];
  const tileVisualSize = TILE_SIZE - 0.032;

  for (let rankIndex = 0; rankIndex < 8; rankIndex++) {
    for (let fileIndex = 0; fileIndex < 8; fileIndex++) {
      const square = coordsToSquare(fileIndex, rankIndex);
      const light = isLightSquare(fileIndex, rankIndex);
      const [x, , z] = squareToWorldPosition(fileIndex, rankIndex);

      const isSelected = selectedSquare === square;
      const legalTarget = legalTargets.get(square);
      const isChecked = checkedSquare === square;
      const isLastMove =
        lastMove?.from === square || lastMove?.to === square;

      const tex = light ? marbleTex : obsidianTex;
      const tileColor = light ? '#e5decb' : '#1d222e';
      let emissive = '#000000';
      let emissiveIntensity = 0;

      if (isChecked) {
        emissive = '#c81e1e';
        emissiveIntensity = 0.72;
      } else if (isSelected) {
        emissive = '#d49a2a';
        emissiveIntensity = 0.5;
      } else if (isLastMove) {
        emissive = '#386292';
        emissiveIntensity = 0.3;
      }

      const handleClick = (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (!isAnimating) {
          onSelectSquare(square);
        }
      };

      tiles.push(
        <group key={square} position={[x, 0, z]}>
          <mesh
            position={[0, -0.07, 0]}
            receiveShadow
            onClick={handleClick}
            onPointerOver={(e) => {
              if (!isAnimating && legalTarget) {
                e.stopPropagation();
                document.body.style.cursor = 'pointer';
              }
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'auto';
            }}
          >
            <boxGeometry args={[tileVisualSize, 0.14, tileVisualSize]} />
            <meshPhysicalMaterial
              color={tileColor}
              map={tex.map}
              bumpMap={tex.bumpMap}
              bumpScale={0.008}
              roughnessMap={tex.roughnessMap}
              roughness={light ? 0.3 : 0.24}
              metalness={light ? 0.05 : 0.2}
              clearcoat={0.88}
              clearcoatRoughness={0.11}
              reflectivity={0.94}
              envMapIntensity={1.35}
              emissive={emissive}
              emissiveIntensity={emissiveIntensity}
            />
          </mesh>

          {legalTarget && !legalTarget.isCapture && (
            <mesh position={[0, 0.015, 0]} onClick={handleClick}>
              <cylinderGeometry args={[0.15, 0.15, 0.025, 24]} />
              <meshStandardMaterial
                color="#e5b85c"
                emissive="#e5b85c"
                emissiveIntensity={0.75}
                roughness={0.28}
              />
            </mesh>
          )}

          {legalTarget && legalTarget.isCapture && (
            <mesh
              position={[0, 0.014, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              onClick={handleClick}
            >
              <ringGeometry args={[0.35, 0.44, 32]} />
              <meshStandardMaterial
                color="#ef5350"
                emissive="#ef5350"
                emissiveIntensity={0.85}
                roughness={0.3}
              />
            </mesh>
          )}
        </group>
      );
    }
  }

  return (
    <group>
      {/* Heavy carved stone board curb */}
      <mesh position={[0, -0.22, 0]} castShadow receiveShadow>
        <boxGeometry args={[8.75, 0.36, 8.75]} />
        <meshStandardMaterial
          color="#4c515c"
          map={borderTex.map}
          bumpMap={borderTex.bumpMap}
          bumpScale={0.03}
          roughnessMap={borderTex.roughnessMap}
          roughness={0.72}
          metalness={0.16}
        />
      </mesh>

      {/* Dark iron trim slab beneath tiles creating crisp iron grout seams */}
      <mesh position={[0, -0.075, 0]} receiveShadow>
        <boxGeometry args={[8.16, 0.135, 8.16]} />
        <meshStandardMaterial
          color="#1e222a"
          roughness={0.38}
          metalness={0.84}
        />
      </mesh>

      {tiles}
    </group>
  );
}
