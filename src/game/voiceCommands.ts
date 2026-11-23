import type { Move, PieceSymbol, Square } from 'chess.js';
import type { PromotionPiece } from './chessTypes';

export type VoiceParseResult =
  | {
      ok: true;
      move: Move;
      spokenSummary: string;
    }
  | {
      ok: false;
      error: string;
    };

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: 'Pawn',
  r: 'Rook',
  n: 'Knight',
  b: 'Bishop',
  q: 'Queen',
  k: 'King',
};

const PIECE_KEYWORDS: Record<string, PieceSymbol> = {
  pawn: 'p',
  pawns: 'p',
  pond: 'p',
  rook: 'r',
  rooks: 'r',
  rock: 'r',
  tower: 'r',
  knight: 'n',
  knights: 'n',
  night: 'n',
  nights: 'n',
  horse: 'n',
  bishop: 'b',
  bishops: 'b',
  queen: 'q',
  queens: 'q',
  king: 'k',
  kings: 'k',
};

const FILE_HOMOPHONES: Record<string, string> = {
  a: 'a',
  ay: 'a',
  eh: 'a',
  hey: 'a',
  alpha: 'a',
  b: 'b',
  bee: 'b',
  be: 'b',
  bravo: 'b',
  c: 'c',
  see: 'c',
  sea: 'c',
  charlie: 'c',
  d: 'd',
  dee: 'd',
  delta: 'd',
  e: 'e',
  ee: 'e',
  echo: 'e',
  f: 'f',
  eff: 'f',
  foxtrot: 'f',
  g: 'g',
  gee: 'g',
  jee: 'g',
  golf: 'g',
  h: 'h',
  aitch: 'h',
  ache: 'h',
  age: 'h',
  each: 'h',
  edge: 'h',
  hotel: 'h',
};

const RANK_HOMOPHONES: Record<string, string> = {
  '1': '1',
  one: '1',
  won: '1',
  '2': '2',
  two: '2',
  too: '2',
  '3': '3',
  three: '3',
  tree: '3',
  free: '3',
  '4': '4',
  four: '4',
  for: '4',
  fore: '4',
  '5': '5',
  five: '5',
  '6': '6',
  six: '6',
  sex: '6',
  '7': '7',
  seven: '7',
  '8': '8',
  eight: '8',
  ate: '8',
};

const PROMOTION_MAP: Record<string, PromotionPiece> = {
  queen: 'q',
  rook: 'r',
  castle: 'r',
  bishop: 'b',
  knight: 'n',
  night: 'n',
  horse: 'n',
};

function isSquareToken(token: string): token is Square {
  return /^[a-h][1-8]$/.test(token);
}

function normalizeSpeechTokens(raw: string): string[] {
  const cleaned = raw
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return [];

  const rawWords = cleaned.split(/[\s-]+/).filter(Boolean);
  const merged: string[] = [];

  for (let i = 0; i < rawWords.length; i++) {
    const w = rawWords[i];

    // Already a valid algebraic square like "e4" or "h3"
    if (isSquareToken(w)) {
      merged.push(w);
      continue;
    }

    // Handle fused spoken forms like "e4", "be4" -> "b4", "see3" -> "c3"
    const fusedMatch = /^([a-z]+)([1-8])$/.exec(w);
    if (fusedMatch && FILE_HOMOPHONES[fusedMatch[1]]) {
      merged.push(`${FILE_HOMOPHONES[fusedMatch[1]]}${fusedMatch[2]}`);
      continue;
    }

    // Combine "<file-word> <rank-word>" (e.g. "h 3", "aitch three", "e four")
    const fileLetter = FILE_HOMOPHONES[w];
    if (fileLetter && i + 1 < rawWords.length) {
      const next = rawWords[i + 1];
      // Treat "to" after a bare file letter as rank 2 only if it isn't "to <square>"
      const rankDigit =
        RANK_HOMOPHONES[next] ??
        (next === 'to' &&
        (i + 2 >= rawWords.length ||
          rawWords[i + 2] === 'to' ||
          Boolean(FILE_HOMOPHONES[rawWords[i + 2]]) ||
          isSquareToken(rawWords[i + 2]))
          ? '2'
          : undefined);

      if (rankDigit) {
        merged.push(`${fileLetter}${rankDigit}`);
        i += 1;
        continue;
      }
    }

    merged.push(w);
  }

  return merged;
}

function formatMoveSummary(move: Move): string {
  if (move.flags.includes('k')) return 'Castled kingside';
  if (move.flags.includes('q')) return 'Castled queenside';
  const pieceName = PIECE_NAMES[move.piece];
  const verb = move.captured ? 'captures on' : 'to';
  const promo = move.promotion
    ? ` (promoted to ${PIECE_NAMES[move.promotion]})`
    : '';
  return `${pieceName} ${verb} ${move.to.toUpperCase()}${promo}`;
}

export function parseVoiceCommand(
  transcript: string,
  legalMoves: Move[]
): VoiceParseResult {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return { ok: false, error: 'No speech detected.' };
  }

  const tokens = normalizeSpeechTokens(trimmed);
  if (tokens.length === 0) {
    return { ok: false, error: `Could not understand "${trimmed}".` };
  }

  const joined = tokens.join(' ');

  // 1. Castling commands
  const mentionsQueenside =
    /\b(queenside|queen side|long)\b/.test(joined) || joined === 'o o o';
  const mentionsKingside =
    /\b(kingside|king side|short)\b/.test(joined) || joined === 'o o';
  const mentionsCastle =
    /\b(castle|castles|castling)\b/.test(joined) ||
    joined === 'o o' ||
    joined === 'o o o';

  if (mentionsCastle || mentionsQueenside || mentionsKingside) {
    if (mentionsQueenside) {
      const qCastle = legalMoves.find((m) => m.flags.includes('q'));
      return qCastle
        ? { ok: true, move: qCastle, spokenSummary: formatMoveSummary(qCastle) }
        : { ok: false, error: 'Queenside castling is not legal right now.' };
    }
    if (mentionsKingside) {
      const kCastle = legalMoves.find((m) => m.flags.includes('k'));
      return kCastle
        ? { ok: true, move: kCastle, spokenSummary: formatMoveSummary(kCastle) }
        : { ok: false, error: 'Kingside castling is not legal right now.' };
    }
    // Generic "castle" — check if only one castling move is legal
    const castlingMoves = legalMoves.filter(
      (m) => m.flags.includes('k') || m.flags.includes('q')
    );
    if (castlingMoves.length === 1) {
      return {
        ok: true,
        move: castlingMoves[0],
        spokenSummary: formatMoveSummary(castlingMoves[0]),
      };
    }
    if (castlingMoves.length > 1) {
      return {
        ok: false,
        error: 'Say "Castle kingside" or "Castle queenside".',
      };
    }
  }

  // 2. Detect promotion preference if mentioned near the end (e.g. "promote to queen")
  let requestedPromotion: PromotionPiece | undefined;
  const promoIdx = tokens.findIndex(
    (t) => t === 'promote' || t === 'promoted' || t === 'promotion' || t === 'becomes'
  );
  if (promoIdx !== -1) {
    for (let i = promoIdx + 1; i < tokens.length; i++) {
      const p = PROMOTION_MAP[tokens[i]];
      if (p) {
        requestedPromotion = p;
        break;
      }
    }
  }

  // 3. Detect capture phrasing ("takes", "captures", "eat", "x")
  const captureWords = new Set(['takes', 'take', 'captures', 'capture', 'x']);
  const captureIdx = tokens.findIndex((t) => captureWords.has(t));
  const isCapturePhrase = captureIdx !== -1;

  // 4. Extract squares mentioned in order
  const squares = tokens.filter(isSquareToken);

  // 5. Extract piece keywords before and after capture verb
  const tokensForPieces = promoIdx !== -1 ? tokens.slice(0, promoIdx) : tokens;
  let movingPiece: PieceSymbol | undefined;
  let capturedPiece: PieceSymbol | undefined;

  if (isCapturePhrase) {
    for (let i = 0; i < captureIdx; i++) {
      const pk =
        PIECE_KEYWORDS[tokensForPieces[i]] ??
        (tokensForPieces[i] === 'castle' ? 'r' : undefined);
      if (pk) {
        movingPiece = pk;
        break;
      }
    }
    for (let i = captureIdx + 1; i < tokensForPieces.length; i++) {
      const pk =
        PIECE_KEYWORDS[tokensForPieces[i]] ??
        (tokensForPieces[i] === 'castle' ? 'r' : undefined);
      if (pk) {
        capturedPiece = pk;
        break;
      }
    }
  } else {
    for (const tok of tokensForPieces) {
      const pk = PIECE_KEYWORDS[tok] ?? (tok === 'castle' ? 'r' : undefined);
      if (pk) {
        movingPiece = pk;
        break;
      }
    }
  }

  // 6. Filter legal moves based on extracted intent
  let candidates = legalMoves;

  if (squares.length >= 2) {
    const fromSq = squares[0];
    const toSq = squares[squares.length - 1];
    candidates = candidates.filter((m) => m.from === fromSq && m.to === toSq);
  } else if (squares.length === 1) {
    const targetSq = squares[0];
    candidates = candidates.filter((m) => m.to === targetSq);
  }

  if (movingPiece) {
    candidates = candidates.filter((m) => m.piece === movingPiece);
  } else if (squares.length === 1 && !isCapturePhrase) {
    // Standard algebraic voice shorthand like "e4" implies pawn if a pawn can move there
    const pawnCandidates = candidates.filter((m) => m.piece === 'p');
    if (pawnCandidates.length > 0) {
      candidates = pawnCandidates;
    }
  }

  if (isCapturePhrase) {
    candidates = candidates.filter((m) => Boolean(m.captured));
    if (capturedPiece) {
      candidates = candidates.filter((m) => m.captured === capturedPiece);
    }
  }

  // Handle promotion variants (chess.js emits 4 separate Move objects for q/r/b/n)
  const promoMoves = candidates.filter((m) => Boolean(m.promotion));
  if (promoMoves.length > 0 && candidates.length === promoMoves.length) {
    const desiredPromo = requestedPromotion ?? 'q';
    candidates = candidates.filter((m) => m.promotion === desiredPromo);
  }

  // Deduplicate exact from->to->promotion matches
  if (candidates.length === 1) {
    return {
      ok: true,
      move: candidates[0],
      spokenSummary: formatMoveSummary(candidates[0]),
    };
  }

  if (candidates.length > 1) {
    // If phrase didn't include a square or piece, avoid picking arbitrarily
    if (squares.length === 0 && !movingPiece) {
      return {
        ok: false,
        error: `Could not understand move "${trimmed}". Try "Pawn to E4" or "Knight to H3".`,
      };
    }
    return {
      ok: false,
      error: `Multiple moves match "${trimmed}" — specify the square (e.g. "${PIECE_NAMES[candidates[0].piece]} ${candidates[0].from.toUpperCase()} to ${candidates[0].to.toUpperCase()}").`,
    };
  }

  return {
    ok: false,
    error: `No legal move matches "${trimmed}".`,
  };
}
