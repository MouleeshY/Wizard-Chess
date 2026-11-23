import { useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { Color, PieceSymbol, Square } from 'chess.js';
import * as THREE from 'three';
import { squareToWorldPosition, type BoardPiece } from '../game/chessTypes';
import {
  getMarbleTextures,
  getObsidianTextures,
} from '../utils/proceduralTextures';

interface ChessPiece3DProps {
  piece: BoardPiece;
  isSelected: boolean;
  isInCheck?: boolean;
  canInteract: boolean;
  onSelectSquare: (square: Square) => void;
}

const CHECK_PULSE_COLOR = new THREE.Color('#c81e1e');
const SELECTED_COLOR = new THREE.Color('#d49a2a');
const HOVERED_COLOR = new THREE.Color('#4c658a');
const BLACK_COLOR = new THREE.Color('#000000');

let cachedHeaterShieldGeo: THREE.ExtrudeGeometry | null = null;
function getHeaterShieldGeometry(): THREE.ExtrudeGeometry {
  if (cachedHeaterShieldGeo) return cachedHeaterShieldGeo;

  const shape = new THREE.Shape();
  shape.moveTo(-0.17, 0.22);
  shape.lineTo(0.17, 0.22);
  shape.quadraticCurveTo(0.17, 0.02, 0.0, -0.24);
  shape.quadraticCurveTo(-0.17, 0.02, -0.17, 0.22);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.055,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.014,
    bevelSegments: 2,
  });
  geo.center();
  cachedHeaterShieldGeo = geo;
  return geo;
}

export function PieceMaterial({
  color,
  isSelected = false,
  isHovered = false,
  isInCheck = false,
}: {
  color: Color;
  isSelected?: boolean;
  isHovered?: boolean;
  isInCheck?: boolean;
}) {
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const textures = useMemo(
    () => (color === 'w' ? getMarbleTextures() : getObsidianTextures()),
    [color]
  );

  useFrame(({ clock }) => {
    const mat = matRef.current;
    if (!mat) return;

    if (isSelected) {
      mat.emissive.copy(SELECTED_COLOR);
      mat.emissiveIntensity = 0.42;
    } else if (isInCheck) {
      const pulse = 0.38 + 0.28 * Math.sin(clock.getElapsedTime() * 3.4);
      mat.emissive.copy(CHECK_PULSE_COLOR);
      mat.emissiveIntensity = pulse;
    } else if (isHovered) {
      mat.emissive.copy(HOVERED_COLOR);
      mat.emissiveIntensity = 0.2;
    } else {
      mat.emissive.copy(BLACK_COLOR);
      mat.emissiveIntensity = 0;
    }
  });

  return (
    <meshPhysicalMaterial
      ref={matRef}
      color={color === 'w' ? '#ebe2cf' : '#2d323d'}
      map={textures.map}
      bumpMap={textures.bumpMap}
      bumpScale={color === 'w' ? 0.018 : 0.022}
      roughnessMap={textures.roughnessMap}
      roughness={color === 'w' ? 0.56 : 0.64}
      metalness={color === 'w' ? 0.05 : 0.18}
      clearcoat={color === 'w' ? 0.24 : 0.34}
      clearcoatRoughness={color === 'w' ? 0.32 : 0.24}
      emissive={
        isSelected
          ? '#d49a2a'
          : isInCheck
            ? '#c81e1e'
            : isHovered
              ? '#4c658a'
              : '#000000'
      }
      emissiveIntensity={
        isSelected ? 0.42 : isInCheck ? 0.45 : isHovered ? 0.2 : 0
      }
    />
  );
}

function MetalAccentMaterial({ color }: { color: Color }) {
  return (
    <meshStandardMaterial
      color={color === 'w' ? '#a5854b' : '#4d5668'}
      roughness={color === 'w' ? 0.34 : 0.32}
      metalness={color === 'w' ? 0.74 : 0.84}
    />
  );
}

function VisorSlitMaterial() {
  return (
    <meshStandardMaterial color="#080a0f" roughness={0.92} metalness={0.1} />
  );
}

export function KingBodyGeometry({
  color,
  isSelected = false,
  isHovered = false,
  isInCheck = false,
}: {
  color: Color;
  isSelected?: boolean;
  isHovered?: boolean;
  isInCheck?: boolean;
}) {
  const stoneMat = (
    <PieceMaterial
      color={color}
      isSelected={isSelected}
      isHovered={isHovered}
      isInCheck={isInCheck}
    />
  );
  const metalMat = <MetalAccentMaterial color={color} />;

  return (
    <group>
      {/* Heavy stepped monarch plinth */}
      <mesh position={[0, 0.07, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.42, 0.45, 0.14, 24]} />
        {stoneMat}
      </mesh>
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.35, 0.41, 0.09, 24]} />
        {stoneMat}
      </mesh>

      {/* Draped royal cloak/mantle cascading behind shoulders (+Z) */}
      <mesh
        position={[0, 0.56, 0.15]}
        rotation={[-0.14, 0, 0]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[0.25, 0.38, 0.78, 12, 1, false, -Math.PI * 0.45, Math.PI * 0.9]} />
        {stoneMat}
      </mesh>

      {/* Broad armored tunic & breastplate */}
      <mesh position={[0, 0.58, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.24, 0.32, 0.74, 18]} />
        {stoneMat}
      </mesh>
      <mesh position={[0, 0.74, -0.04]} castShadow receiveShadow>
        <boxGeometry args={[0.4, 0.32, 0.26]} />
        {stoneMat}
      </mesh>
      {/* Armored belt */}
      <mesh position={[0, 0.54, 0]}>
        <cylinderGeometry args={[0.275, 0.285, 0.055, 18]} />
        {metalMat}
      </mesh>

      {/* Massive broad-shouldered pauldrons */}
      <mesh position={[-0.26, 0.89, 0.01]} castShadow receiveShadow>
        <sphereGeometry args={[0.14, 14, 14]} />
        {stoneMat}
      </mesh>
      <mesh position={[0.26, 0.89, 0.01]} castShadow receiveShadow>
        <sphereGeometry args={[0.14, 14, 14]} />
        {stoneMat}
      </mesh>

      {/* Arms angled forward resting gauntlets atop the broadsword pommel */}
      <mesh
        position={[-0.2, 0.76, -0.13]}
        rotation={[0.55, 0, -0.35]}
        castShadow
      >
        <cylinderGeometry args={[0.065, 0.055, 0.34, 10]} />
        {stoneMat}
      </mesh>
      <mesh
        position={[0.2, 0.76, -0.13]}
        rotation={[0.55, 0, 0.35]}
        castShadow
      >
        <cylinderGeometry args={[0.065, 0.055, 0.34, 10]} />
        {stoneMat}
      </mesh>

      {/* Stern bearded carved stone monarch head & rigid visor brow */}
      <mesh position={[0, 1.07, -0.01]} castShadow receiveShadow>
        <cylinderGeometry args={[0.13, 0.155, 0.23, 16]} />
        {stoneMat}
      </mesh>
      <mesh position={[0, 0.99, -0.11]} rotation={[0.18, 0, 0]} castShadow>
        <coneGeometry args={[0.11, 0.16, 8]} />
        {stoneMat}
      </mesh>
      <mesh position={[0, 1.09, -0.138]}>
        <boxGeometry args={[0.16, 0.032, 0.03]} />
        <VisorSlitMaterial />
      </mesh>

      {/* Colossal broadsword planted vertically point-down in front */}
      <mesh position={[0, 0.44, -0.26]} castShadow>
        <boxGeometry args={[0.072, 0.68, 0.032]} />
        {metalMat}
      </mesh>
      <mesh position={[0, 0.78, -0.26]} castShadow>
        <boxGeometry args={[0.3, 0.05, 0.055]} />
        {metalMat}
      </mesh>
      <mesh position={[0, 0.87, -0.26]} castShadow>
        <cylinderGeometry args={[0.028, 0.028, 0.15, 10]} />
        {metalMat}
      </mesh>
      <mesh position={[0, 0.96, -0.26]} castShadow>
        <sphereGeometry args={[0.048, 10, 10]} />
        {metalMat}
      </mesh>
    </group>
  );
}

export function KingCrownGeometry({
  color,
  isSelected = false,
  isHovered = false,
  isInCheck = false,
}: {
  color: Color;
  isSelected?: boolean;
  isHovered?: boolean;
  isInCheck?: boolean;
}) {
  const stoneMat = (
    <PieceMaterial
      color={color}
      isSelected={isSelected}
      isHovered={isHovered}
      isInCheck={isInCheck}
    />
  );
  const metalMat = <MetalAccentMaterial color={color} />;

  // Centered around local y = 0 (mounted at y = 1.24 on the King)
  return (
    <group>
      <mesh position={[0, -0.06, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.2, 0.15, 0.15, 16]} />
        {stoneMat}
      </mesh>
      <mesh position={[0, -0.1, 0]}>
        <cylinderGeometry args={[0.165, 0.165, 0.04, 16]} />
        {metalMat}
      </mesh>
      {/* Ornate gothic crown spikes */}
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        const tall = i % 2 === 0;
        return (
          <mesh
            key={i}
            position={[
              Math.cos(angle) * 0.165,
              tall ? 0.08 : 0.05,
              Math.sin(angle) * 0.165,
            ]}
            castShadow
          >
            <coneGeometry args={[tall ? 0.042 : 0.032, tall ? 0.15 : 0.1, 6]} />
            {metalMat}
          </mesh>
        );
      })}
      <mesh position={[0, 0.16, 0]} castShadow>
        <boxGeometry args={[0.055, 0.17, 0.055]} />
        {metalMat}
      </mesh>
      <mesh position={[0, 0.19, 0]} castShadow>
        <boxGeometry args={[0.15, 0.05, 0.055]} />
        {metalMat}
      </mesh>
    </group>
  );
}

export function PieceGeometry({
  type,
  color,
  isSelected = false,
  isHovered = false,
  isInCheck = false,
}: {
  type: PieceSymbol;
  color: Color;
  isSelected?: boolean;
  isHovered?: boolean;
  isInCheck?: boolean;
}) {
  const stoneMat = (
    <PieceMaterial
      color={color}
      isSelected={isSelected}
      isHovered={isHovered}
      isInCheck={isInCheck}
    />
  );
  const metalMat = <MetalAccentMaterial color={color} />;
  const heaterShieldGeo = useMemo(() => getHeaterShieldGeometry(), []);

  switch (type) {
    // PIECE 01: Crouching kneeling foot soldier with kettle helm, pointed heater shield & short sword
    case 'p':
      return (
        <group>
          <mesh position={[0, 0.055, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.36, 0.39, 0.11, 20]} />
            {stoneMat}
          </mesh>
          {/* Kneeling rear boot & bent forward knee */}
          <mesh
            position={[-0.1, 0.16, 0.12]}
            rotation={[0.95, 0, 0]}
            castShadow
            receiveShadow
          >
            <cylinderGeometry args={[0.08, 0.095, 0.24, 10]} />
            {stoneMat}
          </mesh>
          <mesh position={[0.11, 0.19, -0.05]} castShadow receiveShadow>
            <boxGeometry args={[0.14, 0.18, 0.2]} />
            {stoneMat}
          </mesh>
          {/* Hunched armored torso */}
          <mesh
            position={[0, 0.34, 0.03]}
            rotation={[-0.22, 0, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[0.33, 0.3, 0.26]} />
            {stoneMat}
          </mesh>
          {/* Segmented gothic shoulder pauldrons */}
          <mesh position={[-0.2, 0.44, 0.02]} castShadow receiveShadow>
            <sphereGeometry args={[0.105, 12, 12]} />
            {stoneMat}
          </mesh>
          <mesh position={[0.2, 0.44, 0.02]} castShadow receiveShadow>
            <sphereGeometry args={[0.105, 12, 12]} />
            {stoneMat}
          </mesh>
          {/* Kettle-helmet with flared brim & rigid visor slit */}
          <mesh position={[0, 0.58, -0.02]} castShadow receiveShadow>
            <sphereGeometry args={[0.135, 16, 14]} />
            {stoneMat}
          </mesh>
          <mesh position={[0, 0.535, -0.02]} castShadow receiveShadow>
            <cylinderGeometry args={[0.21, 0.23, 0.04, 18]} />
            {stoneMat}
          </mesh>
          <mesh position={[0, 0.515, -0.145]}>
            <boxGeometry args={[0.145, 0.026, 0.03]} />
            <VisorSlitMaterial />
          </mesh>
          {/* Pointed heater shield with beveled border and raised cross boss */}
          <group position={[-0.08, 0.34, -0.22]} rotation={[0.1, 0.18, 0]}>
            <mesh geometry={heaterShieldGeo} castShadow receiveShadow>
              {stoneMat}
            </mesh>
            <mesh position={[0, 0.02, -0.042]}>
              <boxGeometry args={[0.16, 0.038, 0.022]} />
              {metalMat}
            </mesh>
            <mesh position={[0, -0.01, -0.042]}>
              <boxGeometry args={[0.038, 0.24, 0.022]} />
              {metalMat}
            </mesh>
          </group>
          {/* Broad-bladed short sword in right hand */}
          <mesh
            position={[0.25, 0.42, -0.17]}
            rotation={[-0.42, 0, -0.18]}
            castShadow
          >
            <boxGeometry args={[0.055, 0.38, 0.025]} />
            {metalMat}
          </mesh>
          <mesh
            position={[0.23, 0.27, -0.1]}
            rotation={[-0.42, 0, -0.18]}
          >
            <boxGeometry args={[0.15, 0.042, 0.042]} />
            {metalMat}
          </mesh>
        </group>
      );

    // PIECE 02: Tiered cylindrical Norman siege tower with ring moldings, arrow slits & battering arms
    case 'r':
      return (
        <group>
          {/* Heavy stepped stone base */}
          <mesh position={[0, 0.075, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.41, 0.44, 0.15, 24]} />
            {stoneMat}
          </mesh>
          <mesh position={[0, 0.19, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.35, 0.4, 0.09, 24]} />
            {stoneMat}
          </mesh>
          {/* Lower & upper cylindrical masonry tower keep */}
          <mesh position={[0, 0.56, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.275, 0.325, 0.68, 20]} />
            {stoneMat}
          </mesh>
          {/* Horizontal stone ring moldings */}
          <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.32, 0.32, 0.048, 20]} />
            {stoneMat}
          </mesh>
          <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.295, 0.295, 0.048, 20]} />
            {stoneMat}
          </mesh>
          {/* Recessed vertical arrow-slit windows */}
          {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((ang, i) => (
            <mesh
              key={`slit-${i}`}
              position={[Math.sin(ang) * 0.29, 0.58, Math.cos(ang) * 0.29]}
              rotation={[0, ang, 0]}
            >
              <boxGeometry args={[0.045, 0.24, 0.024]} />
              <VisorSlitMaterial />
            </mesh>
          ))}
          {/* Side battering ram / maul arms */}
          <mesh position={[-0.31, 0.55, 0]} castShadow>
            <boxGeometry args={[0.085, 0.32, 0.14]} />
            {metalMat}
          </mesh>
          <mesh position={[0.31, 0.55, 0]} castShadow>
            <boxGeometry args={[0.085, 0.32, 0.14]} />
            {metalMat}
          </mesh>
          {/* Corbelled upper parapet collar */}
          <mesh position={[0, 0.94, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.35, 0.285, 0.13, 20]} />
            {stoneMat}
          </mesh>
          {/* 8 Crenellated stone battlements */}
          {Array.from({ length: 8 }).map((_, i) => {
            const ang = (i / 8) * Math.PI * 2;
            return (
              <mesh
                key={`merlon-${i}`}
                position={[Math.cos(ang) * 0.285, 1.07, Math.sin(ang) * 0.285]}
                rotation={[0, -ang, 0]}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[0.11, 0.15, 0.13]} />
                {stoneMat}
              </mesh>
            );
          })}
        </group>
      );

    // PIECE 03: Armored cavalryman mounted on sculpted warhorse with raised spiked morningstar
    case 'n':
      return (
        <group>
          <mesh position={[0, 0.06, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.39, 0.42, 0.12, 22]} />
            {stoneMat}
          </mesh>
          {/* Sculpted rocky ground plinth under hooves */}
          <mesh position={[0, 0.14, 0.02]} castShadow receiveShadow>
            <cylinderGeometry args={[0.3, 0.34, 0.07, 14]} />
            {stoneMat}
          </mesh>
          {/* Warhorse muscular torso + caparison armor skirt */}
          <mesh
            position={[0, 0.47, 0.04]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
            receiveShadow
          >
            <capsuleGeometry args={[0.145, 0.32, 8, 14]} />
            {stoneMat}
          </mesh>
          <mesh position={[0, 0.43, -0.23]} castShadow receiveShadow>
            <boxGeometry args={[0.29, 0.24, 0.11]} />
            {metalMat}
          </mesh>
          {/* Hindquarters & planted hind legs */}
          {[-0.1, 0.1].map((lx, i) => (
            <mesh key={`hind-${i}`} position={[lx, 0.26, 0.21]} castShadow receiveShadow>
              <cylinderGeometry args={[0.052, 0.06, 0.28, 10]} />
              {stoneMat}
            </mesh>
          ))}
          {/* Right foreleg planted, left foreleg raised in warhorse stride */}
          <mesh position={[0.1, 0.26, -0.17]} castShadow receiveShadow>
            <cylinderGeometry args={[0.048, 0.055, 0.28, 10]} />
            {stoneMat}
          </mesh>
          <mesh
            position={[-0.1, 0.36, -0.24]}
            rotation={[-0.85, 0, 0]}
            castShadow
            receiveShadow
          >
            <cylinderGeometry args={[0.046, 0.05, 0.22, 10]} />
            {stoneMat}
          </mesh>
          {/* Arched warhorse neck + carved mane crest + armored chamfron head */}
          <mesh
            position={[0, 0.68, -0.19]}
            rotation={[0.48, 0, 0]}
            castShadow
            receiveShadow
          >
            <cylinderGeometry args={[0.095, 0.135, 0.34, 12]} />
            {stoneMat}
          </mesh>
          <mesh
            position={[0, 0.72, -0.11]}
            rotation={[0.48, 0, 0]}
            castShadow
          >
            <boxGeometry args={[0.055, 0.28, 0.08]} />
            {stoneMat}
          </mesh>
          <mesh
            position={[0, 0.84, -0.34]}
            rotation={[0.82, 0, 0]}
            castShadow
            receiveShadow
          >
            <cylinderGeometry args={[0.062, 0.095, 0.28, 12]} />
            {metalMat}
          </mesh>
          {/* Horse stone tail */}
          <mesh position={[0, 0.42, 0.33]} rotation={[-0.45, 0, 0]} castShadow>
            <coneGeometry args={[0.06, 0.28, 8]} />
            {stoneMat}
          </mesh>
          {/* Armored rider torso, kite shield, armet visor helmet */}
          <mesh position={[0, 0.72, 0.06]} castShadow receiveShadow>
            <cylinderGeometry args={[0.13, 0.15, 0.32, 14]} />
            {stoneMat}
          </mesh>
          <mesh position={[-0.16, 0.72, 0.01]} rotation={[0.15, -0.45, 0]} castShadow>
            <boxGeometry args={[0.045, 0.26, 0.2]} />
            {metalMat}
          </mesh>
          <mesh position={[0, 0.99, 0.04]} castShadow receiveShadow>
            <coneGeometry args={[0.11, 0.22, 12]} />
            {stoneMat}
          </mesh>
          <mesh position={[0, 0.94, -0.055]}>
            <boxGeometry args={[0.12, 0.025, 0.03]} />
            <VisorSlitMaterial />
          </mesh>
          {/* Raised long-handled spiked morningstar */}
          <mesh
            position={[0.21, 0.92, -0.02]}
            rotation={[-0.38, 0, -0.22]}
            castShadow
          >
            <cylinderGeometry args={[0.022, 0.022, 0.64, 8]} />
            {metalMat}
          </mesh>
          <mesh position={[0.29, 1.21, -0.14]} castShadow>
            <dodecahedronGeometry args={[0.088, 0]} />
            {metalMat}
          </mesh>
        </group>
      );

    // PIECE 04: Tall slender clerical warrior with pleated robes, split mitre & central halberd
    case 'b':
      return (
        <group>
          <mesh position={[0, 0.07, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.37, 0.4, 0.14, 22]} />
            {stoneMat}
          </mesh>
          <mesh position={[0, 0.17, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.32, 0.36, 0.07, 22]} />
            {stoneMat}
          </mesh>
          {/* Pleated clerical vestments */}
          <mesh position={[0, 0.51, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.175, 0.31, 0.68, 18]} />
            {stoneMat}
          </mesh>
          {[0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI, (4 * Math.PI) / 3, (5 * Math.PI) / 3].map(
            (a, i) => (
              <mesh
                key={i}
                position={[Math.cos(a) * 0.21, 0.49, Math.sin(a) * 0.21]}
                rotation={[0, -a, 0]}
                castShadow
              >
                <boxGeometry args={[0.055, 0.62, 0.06]} />
                {stoneMat}
              </mesh>
            )
          )}
          {/* Shoulder mantle */}
          <mesh position={[0, 0.84, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.19, 0.24, 0.14, 16]} />
            {stoneMat}
          </mesh>
          {/* Rigid faceless helm & tall pointed bishop's mitre */}
          <mesh position={[0, 1.0, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.115, 0.125, 0.18, 16]} />
            {stoneMat}
          </mesh>
          <mesh position={[0, 1.01, -0.118]}>
            <boxGeometry args={[0.13, 0.026, 0.03]} />
            <VisorSlitMaterial />
          </mesh>
          <mesh position={[0, 1.22, 0]} castShadow receiveShadow>
            <coneGeometry args={[0.145, 0.31, 12]} />
            {stoneMat}
          </mesh>
          <mesh position={[0, 1.21, -0.095]}>
            <boxGeometry args={[0.03, 0.16, 0.025]} />
            {metalMat}
          </mesh>
          <mesh position={[0, 1.24, -0.095]}>
            <boxGeometry args={[0.1, 0.028, 0.025]} />
            {metalMat}
          </mesh>
          {/* Long ceremonial halberd centered in front */}
          <mesh position={[0.03, 0.68, -0.23]} castShadow>
            <cylinderGeometry args={[0.024, 0.024, 1.22, 10]} />
            {metalMat}
          </mesh>
          <mesh position={[0.03, 1.21, -0.26]} castShadow>
            <boxGeometry args={[0.035, 0.25, 0.15]} />
            {metalMat}
          </mesh>
        </group>
      );

    // PIECE 05: Sleek royal warrior-queen with flared pleated gown, spiked crown & greatsword
    case 'q':
      return (
        <group>
          <mesh position={[0, 0.07, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.39, 0.42, 0.14, 24]} />
            {stoneMat}
          </mesh>
          <mesh position={[0, 0.17, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.34, 0.38, 0.07, 24]} />
            {stoneMat}
          </mesh>
          {/* Flared armored gown */}
          <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.165, 0.34, 0.56, 20]} />
            {stoneMat}
          </mesh>
          {/* Fluted gothic corset & pauldrons */}
          <mesh position={[0, 0.81, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.195, 0.155, 0.28, 16]} />
            {stoneMat}
          </mesh>
          <mesh position={[-0.21, 0.89, 0]} castShadow>
            <sphereGeometry args={[0.095, 12, 12]} />
            {stoneMat}
          </mesh>
          <mesh position={[0.21, 0.89, 0]} castShadow>
            <sphereGeometry args={[0.095, 12, 12]} />
            {stoneMat}
          </mesh>
          {/* Visored helm & 5-point royal diadem */}
          <mesh position={[0, 1.05, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.11, 0.122, 0.2, 16]} />
            {stoneMat}
          </mesh>
          <mesh position={[0, 1.06, -0.115]}>
            <boxGeometry args={[0.14, 0.025, 0.03]} />
            <VisorSlitMaterial />
          </mesh>
          {Array.from({ length: 5 }).map((_, i) => {
            const angle = (i / 5) * Math.PI * 2;
            return (
              <mesh
                key={i}
                position={[
                  Math.cos(angle) * 0.11,
                  1.21,
                  Math.sin(angle) * 0.11,
                ]}
                castShadow
              >
                <coneGeometry args={[0.035, 0.15, 6]} />
                {metalMat}
              </mesh>
            );
          })}
          {/* Oversized two-handed greatsword held point-down */}
          <mesh position={[0, 0.5, -0.24]} castShadow>
            <boxGeometry args={[0.056, 0.72, 0.028]} />
            {metalMat}
          </mesh>
          <mesh position={[0, 0.84, -0.24]} castShadow>
            <boxGeometry args={[0.26, 0.045, 0.048]} />
            {metalMat}
          </mesh>
          <mesh position={[0, 0.93, -0.24]} castShadow>
            <cylinderGeometry args={[0.024, 0.024, 0.14, 8]} />
            {metalMat}
          </mesh>
        </group>
      );

    // PIECE 06: Great Monarch King with royal mantle, planted broadsword & detachable crown
    case 'k':
      return (
        <group>
          <KingBodyGeometry
            color={color}
            isSelected={isSelected}
            isHovered={isHovered}
            isInCheck={isInCheck}
          />
          <group position={[0, 1.24, 0]}>
            <KingCrownGeometry
              color={color}
              isSelected={isSelected}
              isHovered={isHovered}
              isInCheck={isInCheck}
            />
          </group>
        </group>
      );
  }
}

export function ChessPiece3D({
  piece,
  isSelected,
  isInCheck = false,
  canInteract,
  onSelectSquare,
}: ChessPiece3DProps) {
  const [hovered, setHovered] = useState(false);
  const idleRef = useRef<THREE.Group>(null);

  const elevation = isSelected ? 0.18 : hovered && canInteract ? 0.05 : 0;
  const position = squareToWorldPosition(
    piece.fileIndex,
    piece.rankIndex,
    elevation
  );

  const rotationY = piece.color === 'w' ? 0 : Math.PI;
  const phase = useMemo(
    () => piece.fileIndex * 0.9 + piece.rankIndex * 1.3,
    [piece.fileIndex, piece.rankIndex]
  );

  useFrame(({ clock }) => {
    const g = idleRef.current;
    if (!g) return;
    const t = clock.getElapsedTime() + phase;

    if (piece.type === 'p') {
      g.position.y = Math.sin(t * 1.4) * 0.008;
      g.rotation.z = Math.sin(t * 0.9) * 0.015;
    } else if (piece.type === 'n') {
      g.rotation.x = Math.sin(t * 1.6) * 0.02;
    } else if (piece.type === 'r') {
      g.position.y = Math.abs(Math.sin(t * 3.1)) * 0.003;
    } else if (piece.type === 'k') {
      g.rotation.y = Math.sin(t * 0.6) * 0.035;
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (canInteract) {
      onSelectSquare(piece.square);
    }
  };

  return (
    <group
      position={position}
      rotation={[0, rotationY, 0]}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (canInteract) {
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = 'auto';
      }}
    >
      <group ref={idleRef}>
        <PieceGeometry
          type={piece.type}
          color={piece.color}
          isSelected={isSelected}
          isHovered={hovered && canInteract}
          isInCheck={isInCheck}
        />
      </group>
    </group>
  );
}
