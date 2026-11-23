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
  type ClockConfig,
  type Difficulty,
  type GameMode,
  type GameStatus,
  type LastMove,
  type LegalTarget,
  type PendingPromotion,
  type PendingTutorWarning,
  type PlayerNames,
  type PromotionPiece,
  type StrikeStyle,
} from './chessTypes';
import {
  computeAiMove,
  evaluateMoveBlunder,
  evaluatePositionForDraw,
} from './chessAI';
import { parseVoiceCommand } from './voiceCommands';
import { setCheckDroneState, unlockAudio } from '../utils/soundEffects';
import {
  createInitialMatchState,
  matchStateReducer,
  useMatchState,
} from './useMatchState';
import {
  clearRoomCodeFromUrl,
  generateRoomCode,
  normalizeRoomInput,
  OnlinePeerSession,
  readRoomCodeFromUrl,
  sanitizeOnlinePlayerName,
  type OnlineConnectionStatus,
  type OnlineEmoteText,
  type OnlinePromotionCode,
  type OnlineRole,
  type OnlineWireMessage,
} from './onlineMultiplayer';

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
  const tutorAbortRef = useRef<AbortController | null>(null);
  const checkCountRef = useRef(0);
  const consecutiveChecksRef = useRef(0);
  const matchEpochRef = useRef(0);

  const [hasStarted, setHasStarted] = useState(false);
  const [gameMode, setGameModeState] = useState<GameMode>('single');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [tutorMode, setTutorModeState] = useState(false);

  const peerSessionRef = useRef<OnlinePeerSession | null>(null);
  const handshakeDoneRef = useRef(false);
  const emoteClearTimerRef = useRef<number | null>(null);
  const emoteCooldownTimerRef = useRef<number | null>(null);
  const lastEmoteSentAtRef = useRef(0);
  const lastEmoteReceivedAtRef = useRef(0);
  const emoteIdCounterRef = useRef(0);

  const [onlineRole, setOnlineRole] = useState<OnlineRole | null>(null);
  const [onlineStatus, setOnlineStatus] =
    useState<OnlineConnectionStatus>('idle');
  const [onlineRoomCode, setOnlineRoomCode] = useState('');
  const [onlineJoinCodeInput, setOnlineJoinCodeInput] = useState('');
  const [onlinePlayerName, setOnlinePlayerName] = useState('');
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [isRematchPending, setIsRematchPending] = useState(false);
  const [opponentEmote, setOpponentEmote] = useState<{
    id: number;
    text: OnlineEmoteText;
  } | null>(null);
  const [isEmoteOnCooldown, setIsEmoteOnCooldown] = useState(false);

  const hasStartedRef = useRef(hasStarted);
  hasStartedRef.current = hasStarted;
  const gameModeRef = useRef(gameMode);
  gameModeRef.current = gameMode;
  const onlineRoleRef = useRef(onlineRole);
  onlineRoleRef.current = onlineRole;
  const onlineStatusRef = useRef(onlineStatus);
  onlineStatusRef.current = onlineStatus;
  const onlinePlayerNameRef = useRef(onlinePlayerName);
  onlinePlayerNameRef.current = onlinePlayerName;

  const [fenVersion, setFenVersion] = useState(0);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] =
    useState<PendingPromotion | null>(null);
  const [pendingTutorWarning, setPendingTutorWarning] =
    useState<PendingTutorWarning | null>(null);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [activeAnimation, setActiveAnimation] =
    useState<ActiveMoveAnimation | null>(null);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [isTutorEvaluating, setIsTutorEvaluating] = useState(false);
  const [isOfferDrawBusy, setIsOfferDrawBusy] = useState(false);
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

  const boardStatus = useMemo(() => {
    void fenVersion;
    return computeGameStatus(gameRef.current);
  }, [fenVersion]);

  const clearPendingInteraction = useCallback(() => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    tutorAbortRef.current?.abort();
    tutorAbortRef.current = null;
    setIsAiThinking(false);
    setIsTutorEvaluating(false);
    setIsOfferDrawBusy(false);
    setSelectedSquare(null);
    setPendingPromotion(null);
    setPendingTutorWarning(null);
  }, []);

  const handleTimeout = useCallback(
    (flaggedColor: Color, winner: Color) => {
      clearPendingInteraction();
      if (
        gameModeRef.current === 'online' &&
        onlineRoleRef.current === 'host' &&
        onlineStatusRef.current === 'connected'
      ) {
        peerSessionRef.current?.sendMessage({
          type: 'timeout',
          winner,
          endedBy: flaggedColor,
        });
      }
    },
    [clearPendingInteraction]
  );

  const {
    matchState,
    dispatchMatchAction,
    setLobbyNames,
    syncModeDefaultNames,
    setLobbyClockConfig,
    startMatch,
    resetSameSides,
    returnMatchToMenu,
    rematchSwapColors,
    resignMatch,
    setDrawOffer,
    respondToDrawOffer,
    clearDrawOffer,
    commitMoveClock,
    syncClockTimes,
    applyTimeoutResolution,
    applyMatchSnapshot,
  } = useMatchState({
    hasStarted,
    activeTurn: boardStatus.turn,
    isBoardGameOver: boardStatus.isGameOver,
    isAnimating,
    isClockPaused: gameMode === 'online' && onlineStatus !== 'connected',
    allowTimeoutResolution: gameMode !== 'online' || onlineRole === 'host',
    onTimeout: handleTimeout,
  });

  const matchStateRef = useRef(matchState);
  matchStateRef.current = matchState;
  const resolutionRef = useRef(matchState.resolution);
  resolutionRef.current = matchState.resolution;

  const status: GameStatus = useMemo(() => {
    if (matchState.resolution) {
      return {
        ...boardStatus,
        isGameOver: true,
        winner: matchState.resolution.winner,
        reason: matchState.resolution.reason,
      };
    }
    return boardStatus;
  }, [boardStatus, matchState.resolution]);

  const statusRef = useRef(status);
  statusRef.current = status;

  const isCheckmateSequenceActive =
    status.reason === 'checkmate' && !isAnimating;

  const localPlayerColor: Color =
    gameMode === 'online'
      ? onlineRole === 'guest'
        ? matchState.humanColor === 'w'
          ? 'b'
          : 'w'
        : matchState.humanColor
      : matchState.humanColor;

  const localPlayerColorRef = useRef(localPlayerColor);
  localPlayerColorRef.current = localPlayerColor;

  const playerPerspectiveColor: Color =
    gameMode === 'online' ? localPlayerColor : 'w';

  const isHumanTurn =
    hasStarted &&
    !status.isGameOver &&
    (gameMode === 'local'
      ? true
      : gameMode === 'online'
        ? onlineStatus === 'connected' && status.turn === localPlayerColor
        : status.turn === matchState.humanColor);

  const legalMovesForSelected: Move[] = useMemo(() => {
    void fenVersion;
    if (
      !selectedSquare ||
      !isHumanTurn ||
      isAnimating ||
      isAiThinking ||
      isTutorEvaluating ||
      pendingTutorWarning
    ) {
      return [];
    }
    return gameRef.current.moves({
      square: selectedSquare,
      verbose: true,
    });
  }, [
    selectedSquare,
    fenVersion,
    isHumanTurn,
    isAnimating,
    isAiThinking,
    isTutorEvaluating,
    pendingTutorWarning,
  ]);

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
    if (
      !hasStarted ||
      !status.isCheck ||
      (status.isGameOver && status.reason !== 'checkmate')
    ) {
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
  }, [hasStarted, status.isCheck, status.isGameOver, status.reason, fenVersion]);

  const executeMove = useCallback(
    (
      from: Square,
      to: Square,
      promotion?: PromotionPiece,
      options?: { skipNetworkSend?: boolean }
    ) => {
      if (resolutionRef.current) return;
      try {
        const move = gameRef.current.move({ from, to, promotion });
        if (move) {
          if (gameRef.current.isCheck()) {
            checkCountRef.current += 1;
            consecutiveChecksRef.current += 1;
          } else {
            consecutiveChecksRef.current = 0;
          }
          const isGameOverAfter = gameRef.current.isGameOver();
          commitMoveClock(move.color, !isGameOverAfter);
          clearDrawOffer();
          animCounterRef.current += 1;
          setLastMove({ from: move.from, to: move.to });
          setSelectedSquare(null);
          setPendingPromotion(null);
          setPendingTutorWarning(null);
          setCheckmateTitleVisible(false);
          setActiveAnimation(buildMoveAnimation(move, animCounterRef.current));
          setFenVersion((v) => v + 1);

          if (gameModeRef.current === 'online') {
            const clocks = matchStateRef.current.clocks;
            const syncedRemainingMs = clocks.enabled
              ? {
                  w:
                    clocks.remainingMs.w +
                    (move.color === 'w' && !isGameOverAfter
                      ? clocks.incrementMs
                      : 0),
                  b:
                    clocks.remainingMs.b +
                    (move.color === 'b' && !isGameOverAfter
                      ? clocks.incrementMs
                      : 0),
                }
              : undefined;

            if (!options?.skipNetworkSend) {
              peerSessionRef.current?.sendMessage({
                type: 'move',
                from: move.from,
                to: move.to,
                ...(move.promotion
                  ? { promotion: move.promotion as OnlinePromotionCode }
                  : {}),
                ...(onlineRoleRef.current === 'host' && syncedRemainingMs
                  ? { remainingMs: syncedRemainingMs }
                  : {}),
              });
            } else if (
              onlineRoleRef.current === 'host' &&
              syncedRemainingMs
            ) {
              // Host confirms authoritative clock times to guest after guest moves
              peerSessionRef.current?.sendMessage({
                type: 'clock_sync',
                remainingMs: syncedRemainingMs,
              });
            }
          }
        }
      } catch {
        setSelectedSquare(null);
      }
    },
    [commitMoveClock, clearDrawOffer]
  );

  const attemptHumanMove = useCallback(
    (from: Square, to: Square, promotion?: PromotionPiece) => {
      if (resolutionRef.current) return;

      // Tutor Mode is strictly disabled in online games
      if (!tutorMode || gameModeRef.current === 'online') {
        executeMove(from, to, promotion);
        return;
      }

      const piece = gameRef.current.get(from);
      if (!piece) {
        executeMove(from, to, promotion);
        return;
      }

      tutorAbortRef.current?.abort();
      const controller = new AbortController();
      tutorAbortRef.current = controller;

      const epoch = matchEpochRef.current;
      const fenBefore = gameRef.current.fen();

      setPendingPromotion(null);
      setSelectedSquare(from);
      setIsTutorEvaluating(true);

      void evaluateMoveBlunder(
        fenBefore,
        { from, to, promotion },
        controller.signal
      )
        .then((res) => {
          if (
            controller.signal.aborted ||
            epoch !== matchEpochRef.current ||
            resolutionRef.current ||
            gameRef.current.fen() !== fenBefore
          ) {
            return;
          }

          if (res.isBlunder) {
            setPendingTutorWarning({
              from,
              to,
              promotion,
              pieceType: piece.type,
              pieceColor: piece.color,
              cpLoss: res.cpLoss,
              reason: res.reason,
            });
            setSelectedSquare(from);
          } else {
            executeMove(from, to, promotion);
          }
        })
        .finally(() => {
          if (tutorAbortRef.current === controller) {
            tutorAbortRef.current = null;
          }
          if (epoch === matchEpochRef.current) {
            setIsTutorEvaluating(false);
          }
        });
    },
    [tutorMode, executeMove]
  );

  const proceedTutorMove = useCallback(() => {
    unlockAudio();
    if (
      gameModeRef.current === 'online' ||
      !pendingTutorWarning ||
      status.isGameOver
    ) {
      return;
    }
    const { from, to, promotion } = pendingTutorWarning;
    setPendingTutorWarning(null);
    executeMove(from, to, promotion);
  }, [pendingTutorWarning, status.isGameOver, executeMove]);

  const undoTutorMove = useCallback(() => {
    unlockAudio();
    if (gameModeRef.current === 'online') return;
    setPendingTutorWarning(null);
  }, []);

  const setTutorMode = useCallback((enabled: boolean) => {
    if (gameModeRef.current === 'online') {
      tutorAbortRef.current?.abort();
      tutorAbortRef.current = null;
      setIsTutorEvaluating(false);
      setPendingTutorWarning(null);
      return;
    }
    setTutorModeState(enabled);
    if (!enabled) {
      tutorAbortRef.current?.abort();
      tutorAbortRef.current = null;
      setIsTutorEvaluating(false);
      setPendingTutorWarning(null);
    }
  }, []);

  // Trigger AI turn in single-player mode when it is the AI's color to move
  useEffect(() => {
    if (
      !hasStarted ||
      gameMode !== 'single' ||
      status.turn === matchState.humanColor ||
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
    matchState.humanColor,
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
      if (
        !isHumanTurn ||
        pendingPromotion ||
        pendingTutorWarning ||
        isTutorEvaluating ||
        isAnimating ||
        isAiThinking
      ) {
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

        attemptHumanMove(selectedSquare, square);
        return;
      }

      if (selectedSquare === square) {
        setSelectedSquare(null);
        return;
      }

      const piece = game.get(square);
      if (
        piece &&
        piece.color === game.turn() &&
        (gameMode !== 'online' || piece.color === localPlayerColor)
      ) {
        setSelectedSquare(square);
        return;
      }

      setSelectedSquare(null);
    },
    [
      isHumanTurn,
      gameMode,
      localPlayerColor,
      pendingPromotion,
      pendingTutorWarning,
      isTutorEvaluating,
      isAnimating,
      isAiThinking,
      selectedSquare,
      legalTargets,
      legalMovesForSelected,
      attemptHumanMove,
    ]
  );

  const confirmPromotion = useCallback(
    (piece: PromotionPiece) => {
      unlockAudio();
      if (
        !pendingPromotion ||
        pendingTutorWarning ||
        isTutorEvaluating ||
        isAnimating ||
        isAiThinking ||
        status.isGameOver
      ) {
        return;
      }
      attemptHumanMove(pendingPromotion.from, pendingPromotion.to, piece);
    },
    [
      pendingPromotion,
      pendingTutorWarning,
      isTutorEvaluating,
      isAnimating,
      isAiThinking,
      status.isGameOver,
      attemptHumanMove,
    ]
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
      if (
        gameMode === 'online' &&
        (onlineStatus !== 'connected' ||
          gameRef.current.turn() !== localPlayerColor)
      ) {
        return { ok: false, message: 'Wait for your turn.' };
      }
      if (!isHumanTurn || isAiThinking) {
        return { ok: false, message: 'Wait for your turn.' };
      }
      if (
        isAnimating ||
        pendingPromotion ||
        isTutorEvaluating ||
        pendingTutorWarning
      ) {
        return { ok: false, message: 'Finish the current move first.' };
      }

      const activeTurnColor = gameRef.current.turn();
      const legalMoves = gameRef.current
        .moves({ verbose: true })
        .filter(
          (m) =>
            m.color === activeTurnColor &&
            (gameMode === 'local' || m.color === localPlayerColor)
        );
      const result = parseVoiceCommand(transcript, legalMoves);
      if (result.ok) {
        attemptHumanMove(
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
      gameMode,
      onlineStatus,
      localPlayerColor,
      status.isGameOver,
      isHumanTurn,
      isAiThinking,
      isAnimating,
      pendingPromotion,
      isTutorEvaluating,
      pendingTutorWarning,
      attemptHumanMove,
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

  const resetBoardOnly = useCallback(() => {
    matchEpochRef.current += 1;
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    tutorAbortRef.current?.abort();
    tutorAbortRef.current = null;
    checkCountRef.current = 0;
    consecutiveChecksRef.current = 0;
    setCheckDroneState(false, 0);
    gameRef.current.reset();
    setSelectedSquare(null);
    setPendingPromotion(null);
    setPendingTutorWarning(null);
    setLastMove(null);
    setActiveAnimation(null);
    setIsAiThinking(false);
    setIsTutorEvaluating(false);
    setIsOfferDrawBusy(false);
    setCheckmateTitleVisible(false);
    setFenVersion((v) => v + 1);
  }, []);

  const clearEmoteState = useCallback(() => {
    if (emoteClearTimerRef.current !== null) {
      window.clearTimeout(emoteClearTimerRef.current);
      emoteClearTimerRef.current = null;
    }
    if (emoteCooldownTimerRef.current !== null) {
      window.clearTimeout(emoteCooldownTimerRef.current);
      emoteCooldownTimerRef.current = null;
    }
    lastEmoteSentAtRef.current = 0;
    lastEmoteReceivedAtRef.current = 0;
    setOpponentEmote(null);
    setIsEmoteOnCooldown(false);
  }, []);

  const teardownOnlineSession = useCallback(
    (notifyPeer = false) => {
      handshakeDoneRef.current = false;
      if (peerSessionRef.current) {
        if (notifyPeer) {
          peerSessionRef.current.sendLeaveAndDestroy();
        } else {
          peerSessionRef.current.destroy();
        }
        peerSessionRef.current = null;
      }
      clearEmoteState();
      setIsRematchPending(false);
      setOnlineRole(null);
      setOnlineStatus('idle');
      setOnlineRoomCode('');
      setOnlineError(null);
    },
    [clearEmoteState]
  );

  const handleRemoteMessage = useCallback(
    (msg: OnlineWireMessage) => {
      if (gameModeRef.current !== 'online') return;

      const role = onlineRoleRef.current;
      const localColor = localPlayerColorRef.current;
      const remoteColor: Color = localColor === 'w' ? 'b' : 'w';

      switch (msg.type) {
        case 'hello': {
          if (role !== 'host' || handshakeDoneRef.current) return;
          const hostName = sanitizeOnlinePlayerName(
            onlinePlayerNameRef.current,
            'White'
          );
          const guestName = sanitizeOnlinePlayerName(msg.name, 'Black');
          const clockConfig = matchStateRef.current.clockConfig;
          const startingSnapshot = matchStateReducer(
            createInitialMatchState('online', clockConfig),
            {
              type: 'START_MATCH',
              mode: 'online',
              names: { w: hostName, b: guestName },
              clockConfig,
              humanColor: 'w',
            }
          );

          handshakeDoneRef.current = true;
          resetBoardOnly();
          applyMatchSnapshot(startingSnapshot);
          setIsRematchPending(false);
          setHasStarted(true);
          peerSessionRef.current?.sendMessage({
            type: 'handshake',
            snapshot: startingSnapshot,
          });
          return;
        }

        case 'handshake': {
          if (role !== 'guest') return;
          handshakeDoneRef.current = true;
          resetBoardOnly();
          applyMatchSnapshot(msg.snapshot);
          setIsRematchPending(false);
          setHasStarted(true);
          return;
        }

        case 'move': {
          if (
            onlineStatusRef.current !== 'connected' ||
            !hasStartedRef.current ||
            resolutionRef.current
          ) {
            return;
          }

          const game = gameRef.current;
          if (game.isGameOver() || game.turn() === localColor) {
            return;
          }

          const from = msg.from as Square;
          const to = msg.to as Square;
          const promotion = msg.promotion as PromotionPiece | undefined;

          const legalMoves = game.moves({ verbose: true });
          const matchingLegal = legalMoves.find(
            (m) =>
              m.from === from &&
              m.to === to &&
              (m.promotion ?? undefined) === promotion
          );
          if (!matchingLegal) {
            return;
          }

          executeMove(from, to, promotion, { skipNetworkSend: true });

          // Guest aligns local clock with host's authoritative snapshot
          if (role === 'guest' && msg.remainingMs) {
            syncClockTimes(msg.remainingMs);
          }
          return;
        }

        case 'clock_sync': {
          if (role !== 'guest' || !hasStartedRef.current) return;
          syncClockTimes(msg.remainingMs);
          return;
        }

        case 'timeout': {
          if (role !== 'guest' || !hasStartedRef.current) return;
          clearPendingInteraction();
          applyTimeoutResolution(msg.winner, msg.endedBy);
          return;
        }

        case 'match_action': {
          if (!hasStartedRef.current || resolutionRef.current) return;
          const action = msg.action;

          if (action.type === 'RESIGN') {
            if (action.by !== remoteColor) return;
            clearPendingInteraction();
            dispatchMatchAction({ type: 'RESIGN', by: remoteColor });
            return;
          }

          if (action.type === 'SET_DRAW_OFFER') {
            if (
              action.status !== 'pending' ||
              action.offeredBy !== remoteColor ||
              matchStateRef.current.drawOffer
            ) {
              return;
            }
            dispatchMatchAction({
              type: 'SET_DRAW_OFFER',
              offeredBy: remoteColor,
              status: 'pending',
            });
            return;
          }

          if (action.type === 'RESPOND_DRAW') {
            const currentOffer = matchStateRef.current.drawOffer;
            if (
              !currentOffer ||
              currentOffer.status !== 'pending' ||
              currentOffer.offeredBy !== localColor
            ) {
              return;
            }
            dispatchMatchAction({
              type: 'RESPOND_DRAW',
              accept: action.accept,
              responderName: matchStateRef.current.names[remoteColor],
            });
          }
          return;
        }

        case 'rematch_request': {
          if (
            role !== 'host' ||
            !hasStartedRef.current ||
            !statusRef.current.isGameOver
          ) {
            return;
          }
          const nextSnapshot = matchStateReducer(matchStateRef.current, {
            type: 'REMATCH_SWAP_COLORS',
          });
          resetBoardOnly();
          applyMatchSnapshot(nextSnapshot);
          setIsRematchPending(false);
          peerSessionRef.current?.sendMessage({
            type: 'rematch_sync',
            snapshot: nextSnapshot,
          });
          return;
        }

        case 'rematch_sync': {
          if (role !== 'guest' || !hasStartedRef.current) return;
          resetBoardOnly();
          applyMatchSnapshot(msg.snapshot);
          setIsRematchPending(false);
          return;
        }

        case 'state_sync': {
          if (role !== 'guest') return;
          const rebuilt = new Chess();
          try {
            if (msg.pgn.trim()) {
              rebuilt.loadPgn(msg.pgn);
            }
          } catch {
            return;
          }

          matchEpochRef.current += 1;
          clearPendingInteraction();
          checkCountRef.current = 0;
          consecutiveChecksRef.current = 0;
          gameRef.current = rebuilt;

          const history = rebuilt.history({ verbose: true });
          const lastEntry = history[history.length - 1];
          setLastMove(
            lastEntry ? { from: lastEntry.from, to: lastEntry.to } : null
          );
          setActiveAnimation(null);
          setIsRematchPending(false);
          applyMatchSnapshot(msg.snapshot);
          setCheckmateTitleVisible(rebuilt.isCheckmate());
          handshakeDoneRef.current = true;
          setHasStarted(true);
          setFenVersion((v) => v + 1);
          return;
        }

        case 'emote': {
          if (!hasStartedRef.current) return;
          const now = Date.now();
          if (now - lastEmoteReceivedAtRef.current < 1500) return;
          lastEmoteReceivedAtRef.current = now;

          emoteIdCounterRef.current += 1;
          const emoteId = emoteIdCounterRef.current;
          setOpponentEmote({ id: emoteId, text: msg.text });

          if (emoteClearTimerRef.current !== null) {
            window.clearTimeout(emoteClearTimerRef.current);
          }
          emoteClearTimerRef.current = window.setTimeout(() => {
            setOpponentEmote((curr) => (curr?.id === emoteId ? null : curr));
            emoteClearTimerRef.current = null;
          }, 3000);
        }
      }
    },
    [
      resetBoardOnly,
      applyMatchSnapshot,
      executeMove,
      syncClockTimes,
      clearPendingInteraction,
      applyTimeoutResolution,
      dispatchMatchAction,
    ]
  );

  const handleRemoteMessageRef = useRef(handleRemoteMessage);
  handleRemoteMessageRef.current = handleRemoteMessage;

  const createOnlineGame = useCallback(() => {
    unlockAudio();
    teardownOnlineSession(false);
    setGameModeState('online');
    syncModeDefaultNames('online');
    setTutorModeState(false);

    const code = generateRoomCode();
    setOnlineRole('host');
    setOnlineRoomCode(code);
    setOnlineStatus('creating');
    setOnlineError(null);

    const session = new OnlinePeerSession('host', {
      onStatusChange: (nextStatus, errorMsg, isReconnect) => {
        if (peerSessionRef.current !== session) return;
        setOnlineStatus(nextStatus);
        if (nextStatus === 'connected') {
          setOnlineError(null);
          if (isReconnect && handshakeDoneRef.current && hasStartedRef.current) {
            session.sendMessage({
              type: 'state_sync',
              pgn: gameRef.current.pgn(),
              snapshot: matchStateRef.current,
            });
          }
        } else if (nextStatus === 'reconnecting') {
          clearPendingInteraction();
          setOnlineError(errorMsg ?? 'Connection lost. Reconnecting...');
        } else if (nextStatus === 'disconnected') {
          clearPendingInteraction();
          setOnlineError(errorMsg ?? 'Opponent disconnected.');
        } else if (nextStatus === 'error') {
          setOnlineError(errorMsg ?? 'Could not open online room.');
        } else {
          setOnlineError(null);
        }
      },
      onRemoteMessage: (message) => {
        if (peerSessionRef.current !== session) return;
        handleRemoteMessageRef.current(message);
      },
    });

    peerSessionRef.current = session;
    session.hostRoom(code);
  }, [teardownOnlineSession, syncModeDefaultNames, clearPendingInteraction]);

  const joinOnlineGame = useCallback(
    (rawCode?: string) => {
      unlockAudio();
      const normalized = normalizeRoomInput(rawCode ?? onlineJoinCodeInput);
      setOnlineJoinCodeInput(normalized);
      teardownOnlineSession(false);
      setGameModeState('online');
      syncModeDefaultNames('online');
      setTutorModeState(false);
      setOnlineRole('guest');
      setOnlineRoomCode(normalized);
      setOnlineStatus('joining');
      setOnlineError(null);

      const session = new OnlinePeerSession('guest', {
        onStatusChange: (nextStatus, errorMsg, isReconnect) => {
          if (peerSessionRef.current !== session) return;
          setOnlineStatus(nextStatus);
          if (nextStatus === 'connected') {
            setOnlineError(null);
            if (!isReconnect || !handshakeDoneRef.current) {
              session.sendMessage({
                type: 'hello',
                name: sanitizeOnlinePlayerName(
                  onlinePlayerNameRef.current,
                  'Black'
                ),
              });
            }
          } else if (nextStatus === 'reconnecting') {
            clearPendingInteraction();
            setOnlineError(errorMsg ?? 'Connection lost. Reconnecting...');
          } else if (nextStatus === 'disconnected') {
            clearPendingInteraction();
            setOnlineError(errorMsg ?? 'Opponent disconnected.');
          } else if (nextStatus === 'error') {
            setOnlineError(errorMsg ?? 'Could not join online room.');
          } else {
            setOnlineError(null);
          }
        },
        onRemoteMessage: (message) => {
          if (peerSessionRef.current !== session) return;
          handleRemoteMessageRef.current(message);
        },
      });

      peerSessionRef.current = session;
      session.joinRoom(normalized);
    },
    [
      onlineJoinCodeInput,
      teardownOnlineSession,
      syncModeDefaultNames,
      clearPendingInteraction,
    ]
  );

  // Auto-join if ?room=CODE is present in URL on mount, and clean up peer on unmount
  useEffect(() => {
    const urlRoom = readRoomCodeFromUrl();
    if (urlRoom) {
      joinOnlineGame(urlRoom);
    }

    return () => {
      if (peerSessionRef.current) {
        peerSessionRef.current.destroy();
        peerSessionRef.current = null;
      }
      clearEmoteState();
    };
    // Run once on initial mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setGameMode = useCallback(
    (mode: GameMode) => {
      if (mode !== 'online') {
        teardownOnlineSession(false);
      } else {
        tutorAbortRef.current?.abort();
        tutorAbortRef.current = null;
        setIsTutorEvaluating(false);
        setPendingTutorWarning(null);
      }
      setGameModeState(mode);
      syncModeDefaultNames(mode);
    },
    [syncModeDefaultNames, teardownOnlineSession]
  );

  const startGame = useCallback(
    (
      mode: GameMode,
      chosenDifficulty: Difficulty,
      chosenNames?: PlayerNames,
      chosenClockConfig?: ClockConfig
    ) => {
      if (mode === 'online') return;
      unlockAudio();
      teardownOnlineSession(false);
      setGameModeState(mode);
      setDifficulty(chosenDifficulty);
      resetBoardOnly();
      startMatch(mode, chosenNames, chosenClockConfig, 'w');
      setHasStarted(true);
    },
    [teardownOnlineSession, resetBoardOnly, startMatch]
  );

  const resetGame = useCallback(() => {
    if (gameModeRef.current === 'online') return;
    unlockAudio();
    resetBoardOnly();
    resetSameSides();
  }, [resetBoardOnly, resetSameSides]);

  const rematchGame = useCallback(() => {
    unlockAudio();
    if (gameModeRef.current === 'online') {
      if (onlineStatusRef.current !== 'connected' || !statusRef.current.isGameOver) {
        return;
      }
      if (onlineRoleRef.current === 'host') {
        const nextSnapshot = matchStateReducer(matchStateRef.current, {
          type: 'REMATCH_SWAP_COLORS',
        });
        resetBoardOnly();
        applyMatchSnapshot(nextSnapshot);
        setIsRematchPending(false);
        peerSessionRef.current?.sendMessage({
          type: 'rematch_sync',
          snapshot: nextSnapshot,
        });
      } else {
        setIsRematchPending(true);
        peerSessionRef.current?.sendMessage({ type: 'rematch_request' });
      }
      return;
    }

    resetBoardOnly();
    rematchSwapColors();
  }, [resetBoardOnly, applyMatchSnapshot, rematchSwapColors]);

  const returnToMenu = useCallback(() => {
    unlockAudio();
    teardownOnlineSession(true);
    clearRoomCodeFromUrl();
    resetBoardOnly();
    returnMatchToMenu();
    setHasStarted(false);
  }, [teardownOnlineSession, resetBoardOnly, returnMatchToMenu]);

  const resignGame = useCallback(() => {
    unlockAudio();
    if (!hasStarted || status.isGameOver) return;

    if (gameMode === 'online') {
      if (onlineStatus !== 'connected') return;
      clearPendingInteraction();
      resignMatch(localPlayerColor);
      peerSessionRef.current?.sendMessage({
        type: 'match_action',
        action: { type: 'RESIGN', by: localPlayerColor },
      });
      return;
    }

    const resigningColor: Color =
      gameMode === 'single' ? matchState.humanColor : status.turn;
    clearPendingInteraction();
    resignMatch(resigningColor);
  }, [
    hasStarted,
    status.isGameOver,
    status.turn,
    gameMode,
    onlineStatus,
    localPlayerColor,
    matchState.humanColor,
    clearPendingInteraction,
    resignMatch,
  ]);

  const offerDraw = useCallback(() => {
    unlockAudio();
    if (
      !hasStarted ||
      status.isGameOver ||
      isAnimating ||
      isOfferDrawBusy ||
      matchState.drawOffer?.status === 'pending' ||
      matchState.drawOffer?.status === 'declined'
    ) {
      return;
    }

    if (gameMode === 'online') {
      if (onlineStatus !== 'connected') return;
      setDrawOffer(localPlayerColor, 'pending');
      peerSessionRef.current?.sendMessage({
        type: 'match_action',
        action: {
          type: 'SET_DRAW_OFFER',
          offeredBy: localPlayerColor,
          status: 'pending',
        },
      });
      return;
    }

    if (gameMode === 'local') {
      setDrawOffer(status.turn, 'pending');
      return;
    }

    // Single-player: AI declines unless > 40 full moves (> 80 plies) AND position is clearly equal
    const humanColor = matchState.humanColor;
    const aiColor: Color = humanColor === 'w' ? 'b' : 'w';
    const aiName = matchState.names[aiColor];
    const plyCount = gameRef.current.history().length;

    if (plyCount <= 80) {
      setDrawOffer(humanColor, 'declined', `${aiName} declined the draw offer.`);
      return;
    }

    const epoch = matchEpochRef.current;
    const fenSnapshot = gameRef.current.fen();
    setIsOfferDrawBusy(true);

    void evaluatePositionForDraw(fenSnapshot)
      .then(({ equal }) => {
        if (
          epoch !== matchEpochRef.current ||
          resolutionRef.current ||
          gameRef.current.fen() !== fenSnapshot
        ) {
          return;
        }
        if (equal) {
          setDrawOffer(humanColor, 'pending');
          respondToDrawOffer(true, aiName);
        } else {
          setDrawOffer(
            humanColor,
            'declined',
            `${aiName} declined the draw offer.`
          );
        }
      })
      .finally(() => {
        if (epoch === matchEpochRef.current) {
          setIsOfferDrawBusy(false);
        }
      });
  }, [
    hasStarted,
    status.isGameOver,
    status.turn,
    isAnimating,
    isOfferDrawBusy,
    matchState.drawOffer,
    matchState.humanColor,
    matchState.names,
    gameMode,
    onlineStatus,
    localPlayerColor,
    setDrawOffer,
    respondToDrawOffer,
  ]);

  const handleRespondToDrawOffer = useCallback(
    (accept: boolean) => {
      unlockAudio();
      if (!matchState.drawOffer || matchState.drawOffer.status !== 'pending') {
        return;
      }

      if (gameMode === 'online') {
        if (
          onlineStatus !== 'connected' ||
          matchState.drawOffer.offeredBy === localPlayerColor
        ) {
          return;
        }
        const responderName = matchState.names[localPlayerColor];
        respondToDrawOffer(accept, responderName);
        peerSessionRef.current?.sendMessage({
          type: 'match_action',
          action: {
            type: 'RESPOND_DRAW',
            accept,
            responderName,
          },
        });
        return;
      }

      const responderColor: Color =
        matchState.drawOffer.offeredBy === 'w' ? 'b' : 'w';
      respondToDrawOffer(accept, matchState.names[responderColor]);
    },
    [
      gameMode,
      onlineStatus,
      localPlayerColor,
      matchState.drawOffer,
      matchState.names,
      respondToDrawOffer,
    ]
  );

  const sendEmote = useCallback((text: OnlineEmoteText): boolean => {
    unlockAudio();
    if (
      gameModeRef.current !== 'online' ||
      onlineStatusRef.current !== 'connected' ||
      !hasStartedRef.current
    ) {
      return false;
    }
    const now = Date.now();
    if (now - lastEmoteSentAtRef.current < 2000) {
      return false;
    }

    const sent = peerSessionRef.current?.sendMessage({ type: 'emote', text });
    if (!sent) return false;

    lastEmoteSentAtRef.current = now;
    setIsEmoteOnCooldown(true);
    if (emoteCooldownTimerRef.current !== null) {
      window.clearTimeout(emoteCooldownTimerRef.current);
    }
    emoteCooldownTimerRef.current = window.setTimeout(() => {
      setIsEmoteOnCooldown(false);
      emoteCooldownTimerRef.current = null;
    }, 2000);
    return true;
  }, []);

  const cancelOnlineLobby = useCallback(() => {
    teardownOnlineSession(false);
  }, [teardownOnlineSession]);

  return {
    hasStarted,
    gameMode,
    difficulty,
    tutorMode: gameMode === 'online' ? false : tutorMode,
    matchState,
    pieces,
    capturedPieces,
    status,
    selectedSquare,
    legalTargets,
    lastMove,
    pendingPromotion,
    pendingTutorWarning: gameMode === 'online' ? null : pendingTutorWarning,
    activeAnimation,
    isAnimating,
    isAiThinking,
    isTutorEvaluating: gameMode === 'online' ? false : isTutorEvaluating,
    isOfferDrawBusy,
    isHumanTurn,
    localPlayerColor,
    playerPerspectiveColor,
    onlineRole,
    onlineStatus,
    onlineRoomCode,
    onlineJoinCodeInput,
    onlinePlayerName,
    onlineError,
    isRematchPending,
    opponentEmote,
    isEmoteOnCooldown,
    isCheckmateSequenceActive,
    checkmateTitleVisible,
    setGameMode,
    setDifficulty,
    setTutorMode,
    setLobbyNames,
    setLobbyClockConfig,
    setOnlineJoinCodeInput,
    setOnlinePlayerName,
    createOnlineGame,
    joinOnlineGame,
    cancelOnlineLobby,
    startGame,
    selectOrMoveSquare,
    executeVoiceCommand,
    confirmPromotion,
    cancelPromotion,
    proceedTutorMove,
    undoTutorMove,
    completeAnimation,
    completeCheckmateSequence,
    resignGame,
    offerDraw,
    respondToDrawOffer: handleRespondToDrawOffer,
    sendEmote,
    resetGame,
    rematchGame,
    returnToMenu,
  };
}
