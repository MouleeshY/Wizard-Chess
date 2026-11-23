import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Color } from 'chess.js';
import type {
  ClockConfig,
  GameMode,
  MatchClockState,
  MatchStateSnapshot,
  PlayerNames,
} from './chessTypes';

export type MatchAction =
  | {
      type: 'SET_LOBBY_NAMES';
      names: PlayerNames;
    }
  | {
      type: 'SYNC_MODE_DEFAULT_NAMES';
      mode: GameMode;
    }
  | {
      type: 'SET_LOBBY_CLOCK';
      clockConfig: ClockConfig;
    }
  | {
      type: 'START_MATCH';
      mode: GameMode;
      names?: PlayerNames;
      clockConfig?: ClockConfig;
      humanColor?: Color;
    }
  | {
      type: 'RESET_SAME_SIDES';
    }
  | {
      type: 'RETURN_TO_MENU';
    }
  | {
      type: 'REMATCH_SWAP_COLORS';
    }
  | {
      type: 'RESIGN';
      by: Color;
    }
  | {
      type: 'SET_DRAW_OFFER';
      offeredBy: Color;
      status: 'pending' | 'declined';
      message?: string;
    }
  | {
      type: 'RESPOND_DRAW';
      accept: boolean;
      responderName: string;
    }
  | {
      type: 'CLEAR_DRAW_OFFER';
    }
  | {
      type: 'COMMIT_MOVE_CLOCK';
      movedColor: Color;
      addIncrement: boolean;
    }
  | {
      type: 'TICK_CLOCK';
      activeColor: Color;
      elapsedMs: number;
      allowTimeoutResolution?: boolean;
    }
  | {
      type: 'SYNC_CLOCK_TIMES';
      remainingMs: { w: number; b: number };
    }
  | {
      type: 'APPLY_TIMEOUT';
      winner: Color;
      endedBy: Color;
    }
  | {
      type: 'APPLY_SNAPSHOT';
      snapshot: MatchStateSnapshot;
    };

export const DEFAULT_CLOCK_CONFIG: ClockConfig = {
  initialMinutes: 0,
  incrementSeconds: 0,
};

export function getDefaultPlayerNames(
  mode: GameMode,
  humanColor: Color = 'w'
): PlayerNames {
  if (mode === 'single') {
    return humanColor === 'w'
      ? { w: 'You', b: 'Stockfish' }
      : { w: 'Stockfish', b: 'You' };
  }
  if (mode === 'online') {
    return humanColor === 'w'
      ? { w: 'You', b: 'Opponent' }
      : { w: 'Opponent', b: 'You' };
  }
  return { w: 'White', b: 'Black' };
}

export function sanitizePlayerNames(
  names: PlayerNames,
  mode: GameMode,
  humanColor: Color = 'w'
): PlayerNames {
  const defaults = getDefaultPlayerNames(mode, humanColor);

  return {
    w: names.w.trim() || defaults.w,
    b: names.b.trim() || defaults.b,
  };
}

export function buildClockState(clockConfig: ClockConfig): MatchClockState {
  const enabled = clockConfig.initialMinutes > 0;
  const initialMs = clockConfig.initialMinutes * 60 * 1000;
  const incrementMs = clockConfig.incrementSeconds * 1000;
  return {
    enabled,
    initialMs,
    incrementMs,
    remainingMs: {
      w: initialMs,
      b: initialMs,
    },
  };
}

export function createInitialMatchState(
  mode: GameMode = 'single',
  clockConfig: ClockConfig = DEFAULT_CLOCK_CONFIG
): MatchStateSnapshot {
  return {
    names: getDefaultPlayerNames(mode),
    humanColor: 'w',
    clockConfig,
    clocks: buildClockState(clockConfig),
    resignedBy: null,
    drawOffer: null,
    resolution: null,
  };
}

function isModeDefaultPair(names: PlayerNames): boolean {
  const w = names.w.trim();
  const b = names.b.trim();
  const isSingleDefault =
    (w === 'You' && b === 'Stockfish') ||
    (w === 'Stockfish' && b === 'You');
  const isOnlineDefault =
    (w === 'You' && b === 'Opponent') ||
    (w === 'Opponent' && b === 'You');
  const isLocalDefault =
    (w === 'White' && b === 'Black') || (w === 'Black' && b === 'White');
  return isSingleDefault || isOnlineDefault || isLocalDefault || (!w && !b);
}

export function matchStateReducer(
  state: MatchStateSnapshot,
  action: MatchAction
): MatchStateSnapshot {
  switch (action.type) {
    case 'SET_LOBBY_NAMES':
      return {
        ...state,
        names: action.names,
      };

    case 'SYNC_MODE_DEFAULT_NAMES':
      if (!isModeDefaultPair(state.names)) {
        return state;
      }
      return {
        ...state,
        names: getDefaultPlayerNames(action.mode),
        humanColor: 'w',
      };

    case 'SET_LOBBY_CLOCK':
      return {
        ...state,
        clockConfig: action.clockConfig,
        clocks: buildClockState(action.clockConfig),
      };

    case 'START_MATCH': {
      const nextHumanColor: Color = action.humanColor ?? 'w';
      const nextClockConfig = action.clockConfig ?? state.clockConfig;
      const nextNames = sanitizePlayerNames(
        action.names ?? getDefaultPlayerNames(action.mode, nextHumanColor),
        action.mode,
        nextHumanColor
      );
      return {
        names: nextNames,
        humanColor: nextHumanColor,
        clockConfig: nextClockConfig,
        clocks: buildClockState(nextClockConfig),
        resignedBy: null,
        drawOffer: null,
        resolution: null,
      };
    }

    case 'RESET_SAME_SIDES':
      return {
        ...state,
        clocks: buildClockState(state.clockConfig),
        resignedBy: null,
        drawOffer: null,
        resolution: null,
      };

    case 'RETURN_TO_MENU':
      return {
        ...state,
        names:
          state.humanColor === 'b'
            ? { w: state.names.b, b: state.names.w }
            : state.names,
        humanColor: 'w',
        clocks: buildClockState(state.clockConfig),
        resignedBy: null,
        drawOffer: null,
        resolution: null,
      };

    case 'REMATCH_SWAP_COLORS': {
      const nextHumanColor: Color = state.humanColor === 'w' ? 'b' : 'w';
      return {
        ...state,
        names: {
          w: state.names.b,
          b: state.names.w,
        },
        humanColor: nextHumanColor,
        clocks: buildClockState(state.clockConfig),
        resignedBy: null,
        drawOffer: null,
        resolution: null,
      };
    }

    case 'RESIGN': {
      if (state.resolution) return state;
      const winner: Color = action.by === 'w' ? 'b' : 'w';
      return {
        ...state,
        resignedBy: action.by,
        drawOffer: null,
        resolution: {
          winner,
          reason: 'resignation',
          endedBy: action.by,
        },
      };
    }

    case 'SET_DRAW_OFFER':
      if (state.resolution) return state;
      return {
        ...state,
        drawOffer: {
          offeredBy: action.offeredBy,
          status: action.status,
          message: action.message,
        },
      };

    case 'RESPOND_DRAW': {
      if (state.resolution || !state.drawOffer || state.drawOffer.status !== 'pending') {
        return state;
      }
      if (action.accept) {
        return {
          ...state,
          drawOffer: null,
          resolution: {
            winner: null,
            reason: 'draw_agreement',
          },
        };
      }
      return {
        ...state,
        drawOffer: {
          offeredBy: state.drawOffer.offeredBy,
          status: 'declined',
          message: `${action.responderName} declined the draw offer.`,
        },
      };
    }

    case 'CLEAR_DRAW_OFFER':
      if (!state.drawOffer) return state;
      return {
        ...state,
        drawOffer: null,
      };

    case 'COMMIT_MOVE_CLOCK': {
      if (!state.clocks.enabled || !action.addIncrement || state.resolution) {
        return state;
      }
      const nextRemaining =
        state.clocks.remainingMs[action.movedColor] + state.clocks.incrementMs;
      return {
        ...state,
        clocks: {
          ...state.clocks,
          remainingMs: {
            ...state.clocks.remainingMs,
            [action.movedColor]: nextRemaining,
          },
        },
      };
    }

    case 'TICK_CLOCK': {
      if (!state.clocks.enabled || state.resolution || action.elapsedMs <= 0) {
        return state;
      }
      const current = state.clocks.remainingMs[action.activeColor];
      const next = Math.max(0, current - action.elapsedMs);
      if (next <= 0 && action.allowTimeoutResolution !== false) {
        const winner: Color = action.activeColor === 'w' ? 'b' : 'w';
        return {
          ...state,
          clocks: {
            ...state.clocks,
            remainingMs: {
              ...state.clocks.remainingMs,
              [action.activeColor]: 0,
            },
          },
          drawOffer: null,
          resolution: {
            winner,
            reason: 'timeout',
            endedBy: action.activeColor,
          },
        };
      }
      return {
        ...state,
        clocks: {
          ...state.clocks,
          remainingMs: {
            ...state.clocks.remainingMs,
            [action.activeColor]: next,
          },
        },
      };
    }

    case 'SYNC_CLOCK_TIMES': {
      if (!state.clocks.enabled || state.resolution) {
        return state;
      }
      return {
        ...state,
        clocks: {
          ...state.clocks,
          remainingMs: {
            w: Math.max(0, action.remainingMs.w),
            b: Math.max(0, action.remainingMs.b),
          },
        },
      };
    }

    case 'APPLY_TIMEOUT': {
      if (state.resolution) return state;
      return {
        ...state,
        clocks: {
          ...state.clocks,
          remainingMs: {
            ...state.clocks.remainingMs,
            [action.endedBy]: 0,
          },
        },
        drawOffer: null,
        resolution: {
          winner: action.winner,
          reason: 'timeout',
          endedBy: action.endedBy,
        },
      };
    }

    case 'APPLY_SNAPSHOT':
      return action.snapshot;

    default:
      return state;
  }
}

interface UseMatchStateOptions {
  hasStarted: boolean;
  activeTurn: Color;
  isBoardGameOver: boolean;
  isAnimating: boolean;
  isClockPaused?: boolean;
  allowTimeoutResolution?: boolean;
  onTimeout?: (flaggedColor: Color, winner: Color) => void;
}

export function useMatchState({
  hasStarted,
  activeTurn,
  isBoardGameOver,
  isAnimating,
  isClockPaused = false,
  allowTimeoutResolution = true,
  onTimeout,
}: UseMatchStateOptions) {
  const [matchState, dispatch] = useReducer(
    matchStateReducer,
    undefined,
    () => createInitialMatchState('single', DEFAULT_CLOCK_CONFIG)
  );

  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const prevResolutionRef = useRef(matchState.resolution);
  useEffect(() => {
    const prev = prevResolutionRef.current;
    const curr = matchState.resolution;
    prevResolutionRef.current = curr;

    if (
      !prev &&
      curr?.reason === 'timeout' &&
      curr.endedBy &&
      curr.winner
    ) {
      onTimeoutRef.current?.(curr.endedBy, curr.winner);
    }
  }, [matchState.resolution]);

  const isClockRunning =
    hasStarted &&
    matchState.clocks.enabled &&
    !isBoardGameOver &&
    matchState.resolution === null &&
    !isAnimating &&
    !isClockPaused;

  useEffect(() => {
    if (!isClockRunning) return;

    let lastTimestamp = performance.now();
    const intervalId = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastTimestamp;
      lastTimestamp = now;
      if (elapsed > 0) {
        dispatch({
          type: 'TICK_CLOCK',
          activeColor: activeTurn,
          elapsedMs: Math.min(elapsed, 500),
          allowTimeoutResolution,
        });
      }
    }, 100);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isClockRunning, activeTurn, allowTimeoutResolution]);

  const setLobbyNames = useCallback((names: PlayerNames) => {
    dispatch({ type: 'SET_LOBBY_NAMES', names });
  }, []);

  const syncModeDefaultNames = useCallback((mode: GameMode) => {
    dispatch({ type: 'SYNC_MODE_DEFAULT_NAMES', mode });
  }, []);

  const setLobbyClockConfig = useCallback((clockConfig: ClockConfig) => {
    dispatch({ type: 'SET_LOBBY_CLOCK', clockConfig });
  }, []);

  const startMatch = useCallback(
    (
      mode: GameMode,
      names?: PlayerNames,
      clockConfig?: ClockConfig,
      humanColor?: Color
    ) => {
      dispatch({ type: 'START_MATCH', mode, names, clockConfig, humanColor });
    },
    []
  );

  const resetSameSides = useCallback(() => {
    dispatch({ type: 'RESET_SAME_SIDES' });
  }, []);

  const returnMatchToMenu = useCallback(() => {
    dispatch({ type: 'RETURN_TO_MENU' });
  }, []);

  const rematchSwapColors = useCallback(() => {
    dispatch({ type: 'REMATCH_SWAP_COLORS' });
  }, []);

  const resignMatch = useCallback((by: Color) => {
    dispatch({ type: 'RESIGN', by });
  }, []);

  const setDrawOffer = useCallback(
    (offeredBy: Color, status: 'pending' | 'declined', message?: string) => {
      dispatch({ type: 'SET_DRAW_OFFER', offeredBy, status, message });
    },
    []
  );

  const respondToDrawOffer = useCallback(
    (accept: boolean, responderName: string) => {
      dispatch({ type: 'RESPOND_DRAW', accept, responderName });
    },
    []
  );

  const clearDrawOffer = useCallback(() => {
    dispatch({ type: 'CLEAR_DRAW_OFFER' });
  }, []);

  const commitMoveClock = useCallback(
    (movedColor: Color, addIncrement: boolean) => {
      dispatch({ type: 'COMMIT_MOVE_CLOCK', movedColor, addIncrement });
    },
    []
  );

  const syncClockTimes = useCallback(
    (remainingMs: { w: number; b: number }) => {
      dispatch({ type: 'SYNC_CLOCK_TIMES', remainingMs });
    },
    []
  );

  const applyTimeoutResolution = useCallback((winner: Color, endedBy: Color) => {
    dispatch({ type: 'APPLY_TIMEOUT', winner, endedBy });
  }, []);

  const applyMatchSnapshot = useCallback((snapshot: MatchStateSnapshot) => {
    dispatch({ type: 'APPLY_SNAPSHOT', snapshot });
  }, []);

  return {
    matchState,
    dispatchMatchAction: dispatch,
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
  };
}
