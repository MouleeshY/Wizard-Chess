import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Chess,
  type Color,
  type Move,
  type PieceSymbol,
  type Square,
} from 'chess.js';
import {
  coordsToSquare,
  squareToCoords,
  type ActiveMoveAnimation,
  type BoardPiece,
  type CapturedPieceSymbol,
  type CapturedPiecesSummary,
  type Difficulty,
  type GameMode,
  type GameStatus,
  type LastMove,
  type LegalTarget,
  type PendingPromotion,
  type PromotionPiece,
  type StrikeStyle,
} from './chessTypes';
import { computeAiMove } from './chessAI';
import { parseVoiceCommand } from './voiceCommands';
import { setCheckDroneState, unlockAudio } from '../utils/soundEffects';

const PIECE_SORT_ORDER: Record<CapturedPieceSymbol, number> = {
  q: 0,
  r: 1,
  b: 2,
  n: 3,
  p: 4,
};

const PIECE_VALUES: Record<CapturedPieceSymbol, number> = {
  q: 9,
  r: 5,
  b: 3,
  n: 3,
  p: 1,
};

function extractPieces(game: Chess): BoardPiece[] {
  const board = game.board();
  const pieces: BoardPiece[] = [];

  for (let row = 0; row < 8; row++) {
    const rankIndex = 7 - row;
    for (let col = 0; col < 8; col++) {
      const cell = board[row][col];
      if (!cell) continue;
      const square = coordsToSquare(col, rankIndex);
      pieces.push({
        id: `${cell.color}-${cell.type}-${square}`,
        square,
        type: cell.type,
        color: cell.color,
        fileIndex: col,
        rankIndex,
      });
    }
  }

  return pieces;
}

function extractCapturedPieces(game: Chess): CapturedPiecesSummary {
  const history = game.history({ verbose: true });
  const byWhite: CapturedPieceSymbol[] = [];
  const byBlack: CapturedPieceSymbol[] = [];
  let whiteScore = 0;
  let blackScore = 0;

  for (const move of history) {
    if (!move.captured) continue;
    const cap = move.captured as CapturedPieceSymbol;
    if (move.color === 'w') {
      byWhite.push(cap);
      whiteScore += PIECE_VALUES[cap];
    } else {
      byBlack.push(cap);
      blackScore += PIECE_VALUES[cap];
    }
  }

  byWhite.sort((a, b) => PIECE_SORT_ORDER[a] - PIECE_SORT_ORDER[b]);
  byBlack.sort((a, b) => PIECE_SORT_ORDER[a] - PIECE_SORT_ORDER[b]);

  return {
    byWhite,
    byBlack,
    whiteAdvantage: whiteScore - blackScore,
  };
}

function findCheckedKingSquare(game: Chess): Square | null {
  if (!game.isCheck()) return null;
  const turn = game.turn();
  const board = game.board();

  for (let row = 0; row < 8; row++) {
    const rankIndex = 7 - row;
    for (let col = 0; col < 8; col++) {
      const cell = board[row][col];
      if (cell && cell.type === 'k' && cell.color === turn) {
        return coordsToSquare(col, rankIndex);
      }
    }
  }

  return null;
}

function computeGameStatus(game: Chess): GameStatus {
  const turn = game.turn();
  const isCheck = game.isCheck();
  const checkedSquare = findCheckedKingSquare(game);

  if (game.isCheckmate()) {
    const winner: Color = turn === 'w' ? 'b' : 'w';
    return {
      turn,
      isCheck: true,
      isGameOver: true,
      winner,
      reason: 'checkmate',
      checkedSquare,
    };
  }

  if (game.isStalemate()) {
    return {
      turn,
      isCheck: false,
      isGameOver: true,
      winner: null,
      reason: 'stalemate',
      checkedSquare: null,
    };
  }

  if (game.isThreefoldRepetition()) {
    return {
      turn,
      isCheck,
      isGameOver: true,
      winner: null,
      reason: 'threefold',
      checkedSquare,
    };
  }

  if (game.isInsufficientMaterial()) {
    return {
      turn,
      isCheck,
      isGameOver: true,
      winner: null,
      reason: 'insufficient',
      checkedSquare,
    };
  }

  if (game.isDraw()) {
    return {
      turn,
      isCheck,
      isGameOver: true,
      winner: null,
      reason: 'draw',
      checkedSquare,
    };
  }

  return {
    turn,
    isCheck,
    isGameOver: false,
    winner: null,
    reason: null,
    checkedSquare,
  };
}

function getStrikeStyle(pieceType: PieceSymbol): StrikeStyle {
  switch (pieceType) {
    case 'r':
    case 'n':
    case 'k':
      return 'slam';
    case 'b':
    case 'q':
      return 'sweep';
    case 'p':
      return 'thrust';
  }
}

function buildMoveAnimation(move: Move, animId: number): ActiveMoveAnimation {
  const slideDuration = 0.8;
  const primary = {
    type: move.piece,
    color: move.color,
    from: move.from,
    to: move.to,
    fromCoords: squareToCoords(move.from),
    toCoords: squareToCoords(move.to),
    isKnightHop: move.piece === 'n',
  };

  if (move.captured) {
    const isEnPassant = move.flags.includes('e');
    const victimSquare = isEnPassant
      ? (`${move.to[0]}${move.from[1]}` as Square)
      : move.to;
    const victimColor: Color = move.color === 'w' ? 'b' : 'w';

    const promotion = move.promotion
      ? {
          newType: move.promotion as PromotionPiece,
          color: move.color,
          square: move.to,
          coords: squareToCoords(move.to),
        }
      : undefined;

    return {
      id: animId,
      kind: 'capture',
      primary,
      capture: {
        victimType: move.captured,
        victimColor,
        victimSquare,
        victimCoords: squareToCoords(victimSquare),
        strikeStyle: getStrikeStyle(move.piece),
      },
      promotion,
      slideDuration,
      totalDuration: promotion ? 2.08 : 1.25,
    };
  }

  const isKingside = move.flags.includes('k');
  const isQueenside = move.flags.includes('q');
  if (isKingside || isQueenside) {
    const rank = move.color === 'w' ? '1' : '8';
    const rookFrom = (isKingside ? `h${rank}` : `a${rank}`) as Square;
    const rookTo = (isKingside ? `f${rank}` : `d${rank}`) as Square;

    return {
      id: animId,
      kind: 'castle',
      primary,
      secondary: {
        type: 'r',
        color: move.color,
        from: rookFrom,
        to: rookTo,
        fromCoords: squareToCoords(rookFrom),
        toCoords: squareToCoords(rookTo),
        isKnightHop: false,
      },
      slideDuration,
      totalDuration: slideDuration,
    };
  }

  if (move.promotion) {
    return {
      id: animId,
      kind: 'promotion',
      primary,
      promotion: {
        newType: move.promotion as PromotionPiece,
        color: move.color,
        square: move.to,
        coords: squareToCoords(move.to),
      },
      slideDuration,
      totalDuration: 1.65,
    };
  }

  return {
    id: animId,
    kind: 'standard',
    primary,
    slideDuration,
    totalDuration: slideDuration,
  };
}

export function useChessGame() {
  const gameRef = useRef<Chess>(new Chess());
  const animCounterRef = useRef(0);
  const aiAbortRef = useRef<AbortController | null>(null);
  const checkCountRef = useRef(0);
  const consecutiveChecksRef = useRef(0);

  const [hasStarted, setHasStarted] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>('single');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');

  const [fenVersion, setFenVersion] = useState(0);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] =
    useState<PendingPromotion | null>(null);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [activeAnimation, setActiveAnimation] =
    useState<ActiveMoveAnimation | null>(null);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [checkmateTitleVisible, setCheckmateTitleVisible] = useState(false);

  const isAnimating = activeAnimation !== null;

  const pieces = useMemo(() => {
    void fenVersion;
    return extractPieces(gameRef.current);
  }, [fenVersion]);

  const capturedPieces = useMemo(() => {
    void fenVersion;
    return extractCapturedPieces(gameRef.current);
  }, [fenVersion]);

  const status = useMemo(() => {
    void fenVersion;
    return computeGameStatus(gameRef.current);
  }, [fenVersion]);

  const isCheckmateSequenceActive =
    status.reason === 'checkmate' && !isAnimating;

  const isHumanTurn =
    hasStarted &&
    !status.isGameOver &&
    (gameMode === 'local' || status.turn === 'w');

  const legalMovesForSelected: Move[] = useMemo(() => {
    void fenVersion;
    if (!selectedSquare || !isHumanTurn || isAnimating || isAiThinking) {
      return [];
    }
    return gameRef.current.moves({
      square: selectedSquare,
      verbose: true,
    });
  }, [selectedSquare, fenVersion, isHumanTurn, isAnimating, isAiThinking]);

  const legalTargets: Map<Square, LegalTarget> = useMemo(() => {
    const map = new Map<Square, LegalTarget>();
    for (const move of legalMovesForSelected) {
      map.set(move.to, {
        square: move.to,
        isCapture: Boolean(move.captured),
      });
    }
    return map;
  }, [legalMovesForSelected]);

  // Unlock Web Audio on first user interaction to satisfy browser autoplay rules
  useEffect(() => {
    const handleFirstInteraction = () => {
      unlockAudio();
    };
    window.addEventListener('pointerdown', handleFirstInteraction, { once: true });
    window.addEventListener('keydown', handleFirstInteraction, { once: true });
    return () => {
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };
  }, []);

  // Fade check drone in/out and scale intensity for repeated checks or checkmate threats
  useEffect(() => {
    if (!hasStarted || !status.isCheck) {
      setCheckDroneState(false, 0);
      return;
    }

    if (status.reason === 'checkmate') {
      setCheckDroneState(true, 3);
      return;
    }

    const legalEscapeCount = gameRef.current.moves().length;
    const isRepeatedOrTight =
      consecutiveChecksRef.current >= 2 ||
      checkCountRef.current >= 3 ||
      legalEscapeCount <= 3;

    setCheckDroneState(true, isRepeatedOrTight ? 2 : 1);
  }, [hasStarted, status.isCheck, status.reason, fenVersion]);

  const executeMove = useCallback(
    (from: Square, to: Square, promotion?: PromotionPiece) => {
      try {
        const move = gameRef.current.move({ from, to, promotion });
        if (move) {
          if (gameRef.current.isCheck()) {
            checkCountRef.current += 1;
            consecutiveChecksRef.current += 1;
          } else {
            consecutiveChecksRef.current = 0;
          }
          animCounterRef.current += 1;
          setLastMove({ from: move.from, to: move.to });
          setSelectedSquare(null);
          setPendingPromotion(null);
          setCheckmateTitleVisible(false);
          setActiveAnimation(buildMoveAnimation(move, animCounterRef.current));
          setFenVersion((v) => v + 1);
        }
      } catch {
        setSelectedSquare(null);
      }
    },
    []
  );

  // Trigger AI turn (Black) in single-player mode after White's move animation settles
  useEffect(() => {
    if (
      !hasStarted ||
      gameMode !== 'single' ||
      status.turn !== 'b' ||
      status.isGameOver ||
      isAnimating ||
      pendingPromotion
    ) {
      return;
    }

    const controller = new AbortController();
    aiAbortRef.current = controller;
    setIsAiThinking(true);

    const fen = gameRef.current.fen();

    void computeAiMove(fen, difficulty, controller.signal).then((choice) => {
      if (controller.signal.aborted) return;
      setIsAiThinking(false);
      if (choice) {
        executeMove(choice.from, choice.to, choice.promotion);
      }
    });

    return () => {
      controller.abort();
      setIsAiThinking(false);
    };
  }, [
    hasStarted,
    gameMode,
    difficulty,
    status.turn,
    status.isGameOver,
    isAnimating,
    pendingPromotion,
    executeMove,
  ]);

  const selectOrMoveSquare = useCallback(
    (square: Square) => {
      unlockAudio();
      const game = gameRef.current;
      if (!isHumanTurn || pendingPromotion || isAnimating || isAiThinking) {
        return;
      }

      if (selectedSquare && legalTargets.has(square)) {
        const matchingMoves = legalMovesForSelected.filter(
          (m) => m.to === square
        );
        const requiresPromotion = matchingMoves.some((m) =>
          Boolean(m.promotion)
        );

        if (requiresPromotion) {
          setPendingPromotion({
            from: selectedSquare,
            to: square,
            color: game.turn(),
          });
          return;
        }

        executeMove(selectedSquare, square);
        return;
      }

      if (selectedSquare === square) {
        setSelectedSquare(null);
        return;
      }

      const piece = game.get(square);
      if (piece && piece.color === game.turn()) {
        setSelectedSquare(square);
        return;
      }

      setSelectedSquare(null);
    },
    [
      isHumanTurn,
      pendingPromotion,
      isAnimating,
      isAiThinking,
      selectedSquare,
      legalTargets,
      legalMovesForSelected,
      executeMove,
    ]
  );

  const confirmPromotion = useCallback(
    (piece: PromotionPiece) => {
      unlockAudio();
      if (!pendingPromotion || isAnimating || isAiThinking) return;
      executeMove(pendingPromotion.from, pendingPromotion.to, piece);
    },
    [pendingPromotion, isAnimating, isAiThinking, executeMove]
  );

  const cancelPromotion = useCallback(() => {
    setPendingPromotion(null);
  }, []);

  const executeVoiceCommand = useCallback(
    (transcript: string): { ok: boolean; message: string } => {
      unlockAudio();
      if (!hasStarted || status.isGameOver) {
        return { ok: false, message: 'Start a match to use voice commands.' };
      }
      if (!isHumanTurn || isAiThinking) {
        return { ok: false, message: 'Wait for your turn.' };
      }
      if (isAnimating || pendingPromotion) {
        return { ok: false, message: 'Finish the current move first.' };
      }

      const legalMoves = gameRef.current.moves({ verbose: true });
      const result = parseVoiceCommand(transcript, legalMoves);
      if (result.ok) {
        executeMove(
          result.move.from,
          result.move.to,
          result.move.promotion as PromotionPiece | undefined
        );
        return { ok: true, message: result.spokenSummary };
      }
      return { ok: false, message: result.error };
    },
    [
      hasStarted,
      status.isGameOver,
      isHumanTurn,
      isAiThinking,
      isAnimating,
      pendingPromotion,
      executeMove,
    ]
  );

  const completeAnimation = useCallback((animationId: number) => {
    setActiveAnimation((current) =>
      current && current.id === animationId ? null : current
    );
  }, []);

  const completeCheckmateSequence = useCallback(() => {
    setCheckmateTitleVisible(true);
  }, []);

  const resetBoardState = useCallback(() => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    checkCountRef.current = 0;
    consecutiveChecksRef.current = 0;
    setCheckDroneState(false, 0);
    gameRef.current.reset();
    setSelectedSquare(null);
    setPendingPromotion(null);
    setLastMove(null);
    setActiveAnimation(null);
    setIsAiThinking(false);
    setCheckmateTitleVisible(false);
    setFenVersion((v) => v + 1);
  }, []);

  const startGame = useCallback(
    (mode: GameMode, chosenDifficulty: Difficulty) => {
      unlockAudio();
      setGameMode(mode);
      setDifficulty(chosenDifficulty);
      resetBoardState();
      setHasStarted(true);
    },
    [resetBoardState]
  );

  const resetGame = useCallback(() => {
    unlockAudio();
    resetBoardState();
  }, [resetBoardState]);

  const returnToMenu = useCallback(() => {
    unlockAudio();
    resetBoardState();
    setHasStarted(false);
  }, [resetBoardState]);

  return {
    hasStarted,
    gameMode,
    difficulty,
    pieces,
    capturedPieces,
    status,
    selectedSquare,
    legalTargets,
    lastMove,
    pendingPromotion,
    activeAnimation,
    isAnimating,
    isAiThinking,
    isHumanTurn,
    isCheckmateSequenceActive,
    checkmateTitleVisible,
    setGameMode,
    setDifficulty,
    startGame,
    selectOrMoveSquare,
    executeVoiceCommand,
    confirmPromotion,
    cancelPromotion,
    completeAnimation,
    completeCheckmateSequence,
    resetGame,
    returnToMenu,
  };
}
