import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js';
import type { Difficulty, PromotionPiece } from './chessTypes';

export interface AiMoveChoice {
  from: Square;
  to: Square;
  promotion?: PromotionPiece;
  engine: 'stockfish' | 'minimax';
}

interface DifficultyConfig {
  stockfishSkill: number;
  stockfishDepth: number;
  stockfishMoveTimeMs: number;
  minimaxDepth: number;
  minDelayMs: number;
  randomnessMargin: number;
}

const DIFFICULTY_CONFIG: Record<Difficulty, DifficultyConfig> = {
  easy: {
    stockfishSkill: 2,
    stockfishDepth: 3,
    stockfishMoveTimeMs: 300,
    minimaxDepth: 2,
    minDelayMs: 420,
    randomnessMargin: 65,
  },
  medium: {
    stockfishSkill: 10,
    stockfishDepth: 8,
    stockfishMoveTimeMs: 650,
    minimaxDepth: 3,
    minDelayMs: 520,
    randomnessMargin: 15,
  },
  hard: {
    stockfishSkill: 20,
    stockfishDepth: 14,
    stockfishMoveTimeMs: 1200,
    minimaxDepth: 3,
    minDelayMs: 620,
    randomnessMargin: 0,
  },
};

// --------------------------------------------------------------------------
// Stockfish WASM Web Worker Manager
// --------------------------------------------------------------------------

class StockfishWorkerClient {
  private worker: Worker | null = null;
  private initPromise: Promise<boolean> | null = null;
  private failed = false;
  private listeners = new Set<(line: string) => void>();

  private ensureInit(): Promise<boolean> {
    if (this.failed || typeof Worker === 'undefined') {
      return Promise.resolve(false);
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (!ok) {
          this.failed = true;
          this.dispose();
        }
        resolve(ok);
      };

      const timeout = window.setTimeout(() => finish(false), 4000);

      try {
        const worker = new Worker('/stockfish/stockfish-19-lite-single.js');
        this.worker = worker;

        let uciReady = false;

        worker.onmessage = (ev: MessageEvent) => {
          const line = typeof ev.data === 'string' ? ev.data : String(ev.data ?? '');
          if (!uciReady && line.includes('uciok')) {
            uciReady = true;
            worker.postMessage('isready');
          } else if (uciReady && !settled && line.includes('readyok')) {
            window.clearTimeout(timeout);
            finish(true);
          }

          for (const listener of this.listeners) {
            listener(line);
          }
        };

        worker.onerror = () => {
          window.clearTimeout(timeout);
          finish(false);
        };

        worker.postMessage('uci');
      } catch {
        window.clearTimeout(timeout);
        finish(false);
      }
    });

    return this.initPromise;
  }

  async searchBestMove(
    fen: string,
    config: DifficultyConfig,
    signal?: AbortSignal
  ): Promise<{ from: Square; to: Square; promotion?: PromotionPiece } | null> {
    if (signal?.aborted) return null;

    const ok = await this.ensureInit();
    if (!ok || !this.worker || signal?.aborted) {
      return null;
    }

    return new Promise((resolve) => {
      const worker = this.worker;
      if (!worker) {
        resolve(null);
        return;
      }

      let done = false;
      const cleanup = () => {
        this.listeners.delete(onLine);
        signal?.removeEventListener('abort', onAbort);
        window.clearTimeout(timeout);
      };

      const finish = (
        result: { from: Square; to: Square; promotion?: PromotionPiece } | null
      ) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(result);
      };

      const onAbort = () => {
        try {
          worker.postMessage('stop');
        } catch {
          // Ignore stop errors
        }
        finish(null);
      };

      const onLine = (line: string) => {
        if (!line.startsWith('bestmove ')) return;
        const match = line.match(/^bestmove\s+([a-h][1-8])([a-h][1-8])([qrbn])?/);
        if (!match) {
          finish(null);
          return;
        }
        finish({
          from: match[1] as Square,
          to: match[2] as Square,
          promotion: match[3] as PromotionPiece | undefined,
        });
      };

      const timeout = window.setTimeout(() => {
        try {
          worker.postMessage('stop');
        } catch {
          // Ignore
        }
        finish(null);
      }, config.stockfishMoveTimeMs + 2500);

      this.listeners.add(onLine);
      signal?.addEventListener('abort', onAbort, { once: true });

      worker.postMessage(
        `setoption name Skill Level value ${config.stockfishSkill}`
      );
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(
        `go depth ${config.stockfishDepth} movetime ${config.stockfishMoveTimeMs}`
      );
    });
  }

  dispose() {
    this.listeners.clear();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.initPromise = null;
  }
}

const stockfishClient = new StockfishWorkerClient();

// --------------------------------------------------------------------------
// Minimax + Alpha-Beta Pruning Fallback (Depth 2-3)
// --------------------------------------------------------------------------

const PIECE_SCORE: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

// Piece-square tables (from White's perspective, rank 8 -> rank 1)
const PAWN_PST = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];

const KNIGHT_PST = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];

const BISHOP_PST = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];

const ROOK_PST = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];

const QUEEN_PST = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
];

const KING_PST = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
];

const PST_MAP: Record<PieceSymbol, number[]> = {
  p: PAWN_PST,
  n: KNIGHT_PST,
  b: BISHOP_PST,
  r: ROOK_PST,
  q: QUEEN_PST,
  k: KING_PST,
};

function evaluateBoardForBlack(game: Chess): number {
  if (game.isCheckmate()) {
    return game.turn() === 'w' ? 100000 : -100000;
  }
  if (game.isDraw() || game.isStalemate()) {
    return 0;
  }

  const board = game.board();
  let score = 0;

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (!piece) continue;

      const pstIndex =
        piece.color === 'w' ? row * 8 + col : (7 - row) * 8 + col;
      const val = PIECE_SCORE[piece.type] + PST_MAP[piece.type][pstIndex];
      score += piece.color === 'b' ? val : -val;
    }
  }

  if (game.inCheck()) {
    score += game.turn() === 'w' ? 35 : -35;
  }

  return score;
}

function orderMoves(moves: Move[]): Move[] {
  return moves.sort((a, b) => {
    const scoreA =
      (a.captured ? PIECE_SCORE[a.captured] * 10 - PIECE_SCORE[a.piece] : 0) +
      (a.promotion ? PIECE_SCORE[a.promotion] : 0);
    const scoreB =
      (b.captured ? PIECE_SCORE[b.captured] * 10 - PIECE_SCORE[b.piece] : 0) +
      (b.promotion ? PIECE_SCORE[b.promotion] : 0);
    return scoreB - scoreA;
  });
}

function minimax(
  game: Chess,
  depth: number,
  alpha: number,
  beta: number,
  maximizingBlack: boolean
): number {
  if (depth === 0 || game.isGameOver()) {
    const evalScore = evaluateBoardForBlack(game);
    // Prefer faster checkmates
    if (evalScore > 50000) return evalScore + depth;
    if (evalScore < -50000) return evalScore - depth;
    return evalScore;
  }

  const moves = orderMoves(game.moves({ verbose: true }));

  if (maximizingBlack) {
    let maxEval = -Infinity;
    for (const move of moves) {
      game.move(move);
      const evaluation = minimax(game, depth - 1, alpha, beta, false);
      game.undo();
      if (evaluation > maxEval) maxEval = evaluation;
      if (evaluation > alpha) alpha = evaluation;
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      game.move(move);
      const evaluation = minimax(game, depth - 1, alpha, beta, true);
      game.undo();
      if (evaluation < minEval) minEval = evaluation;
      if (evaluation < beta) beta = evaluation;
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function findBestMoveMinimax(
  fen: string,
  config: DifficultyConfig
): AiMoveChoice | null {
  const game = new Chess(fen);
  const moves = orderMoves(game.moves({ verbose: true }));
  if (moves.length === 0) return null;

  const isBlackTurn = game.turn() === 'b';
  const scored: { move: Move; score: number }[] = [];

  for (const move of moves) {
    game.move(move);
    const score = minimax(
      game,
      config.minimaxDepth - 1,
      -Infinity,
      Infinity,
      !isBlackTurn
    );
    game.undo();
    scored.push({ move, score });
  }

  scored.sort((a, b) => (isBlackTurn ? b.score - a.score : a.score - b.score));

  const bestScore = scored[0].score;
  let chosen = scored[0].move;

  if (config.randomnessMargin > 0) {
    const candidates = scored.filter(
      (s) => Math.abs(s.score - bestScore) <= config.randomnessMargin
    );
    chosen = candidates[Math.floor(Math.random() * candidates.length)].move;
  }

  return {
    from: chosen.from,
    to: chosen.to,
    promotion: chosen.promotion as PromotionPiece | undefined,
    engine: 'minimax',
  };
}

// --------------------------------------------------------------------------
// Public AI Entry Point (Stockfish WASM with Minimax Fallback + Delay)
// --------------------------------------------------------------------------

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function computeAiMove(
  fen: string,
  difficulty: Difficulty,
  signal?: AbortSignal
): Promise<AiMoveChoice | null> {
  const config = DIFFICULTY_CONFIG[difficulty];
  const startTime = performance.now();

  let choice: AiMoveChoice | null = null;

  const sfMove = await stockfishClient.searchBestMove(fen, config, signal);
  if (signal?.aborted) return null;

  if (sfMove) {
    choice = {
      ...sfMove,
      engine: 'stockfish',
    };
  } else {
    choice = findBestMoveMinimax(fen, config);
  }

  const elapsed = performance.now() - startTime;
  const remainingDelay = Math.max(0, config.minDelayMs - elapsed);
  if (remainingDelay > 0) {
    await delay(remainingDelay, signal);
  }

  if (signal?.aborted) return null;
  return choice;
}
