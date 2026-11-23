import type { Color, PieceSymbol, Square } from 'chess.js';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const TILE_SIZE = 1;

export type GameMode = 'single' | 'local';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface BoardPiece {
  id: string;
  square: Square;
  type: PieceSymbol;
  color: Color;
  fileIndex: number;
  rankIndex: number;
}

export interface LegalTarget {
  square: Square;
  isCapture: boolean;
}

export interface PendingPromotion {
  from: Square;
  to: Square;
  color: Color;
}

export type PromotionPiece = Exclude<PieceSymbol, 'p' | 'k'>;
export type CapturedPieceSymbol = Exclude<PieceSymbol, 'k'>;

export interface CapturedPiecesSummary {
  byWhite: CapturedPieceSymbol[];
  byBlack: CapturedPieceSymbol[];
  whiteAdvantage: number;
}

export interface GameStatus {
  turn: Color;
  isCheck: boolean;
  isGameOver: boolean;
  winner: Color | null;
  reason:
    | 'checkmate'
    | 'stalemate'
    | 'threefold'
    | 'insufficient'
    | 'draw'
    | null;
  checkedSquare: Square | null;
}

export interface LastMove {
  from: Square;
  to: Square;
}

export interface BoardCoords {
  fileIndex: number;
  rankIndex: number;
}

export interface AnimatedPieceMotion {
  type: PieceSymbol;
  color: Color;
  from: Square;
  to: Square;
  fromCoords: BoardCoords;
  toCoords: BoardCoords;
  isKnightHop: boolean;
}

export type StrikeStyle = 'slam' | 'sweep' | 'thrust';

export interface CaptureAnimationInfo {
  victimType: PieceSymbol;
  victimColor: Color;
  victimSquare: Square;
  victimCoords: BoardCoords;
  strikeStyle: StrikeStyle;
}

export interface ActiveMoveAnimation {
  id: number;
  kind: 'standard' | 'castle' | 'promotion' | 'capture';
  primary: AnimatedPieceMotion;
  secondary?: AnimatedPieceMotion;
  capture?: CaptureAnimationInfo;
  promotion?: {
    newType: PromotionPiece;
    color: Color;
    square: Square;
    coords: BoardCoords;
  };
  slideDuration: number;
  totalDuration: number;
}

export interface DebrisBurstData {
  id: number;
  color: Color;
  position: [number, number, number];
  strikeDir: [number, number];
}

export function coordsToSquare(fileIndex: number, rankIndex: number): Square {
  return `${FILES[fileIndex]}${rankIndex + 1}` as Square;
}

export function squareToCoords(square: Square): BoardCoords {
  const fileIndex = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rankIndex = Number(square[1]) - 1;
  return { fileIndex, rankIndex };
}

export function squareToWorldPosition(
  fileIndex: number,
  rankIndex: number,
  y = 0
): [number, number, number] {
  const x = (fileIndex - 3.5) * TILE_SIZE;
  const z = (3.5 - rankIndex) * TILE_SIZE;
  return [x, y, z];
}

export function isLightSquare(fileIndex: number, rankIndex: number): boolean {
  // a1 (0, 0) is dark obsidian; h1 (7, 0) is pale marble
  return (fileIndex + rankIndex) % 2 !== 0;
}
