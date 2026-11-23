import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Mic, MicOff, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
import type { Color } from 'chess.js';
import {
  getAudioSettings,
  setAmbienceVolume,
  setMasterVolume,
  setMuted,
  setSfxVolume,
  unlockAudio,
  type AudioSettings,
} from '../utils/soundEffects';
import type {
  CapturedPieceSymbol,
  CapturedPiecesSummary,
  Difficulty,
  GameMode,
  GameStatus,
  PendingPromotion,
  PromotionPiece,
} from '../game/chessTypes';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface GameHUDProps {
  hasStarted: boolean;
  gameMode: GameMode;
  difficulty: Difficulty;
  status: GameStatus;
  capturedPieces: CapturedPiecesSummary;
  pendingPromotion: PendingPromotion | null;
  isAiThinking: boolean;
  isHumanTurn: boolean;
  isAnimating: boolean;
  checkmateTitleVisible: boolean;
  onSelectMode: (mode: GameMode) => void;
  onSelectDifficulty: (difficulty: Difficulty) => void;
  onStartGame: (mode: GameMode, difficulty: Difficulty) => void;
  onConfirmPromotion: (piece: PromotionPiece) => void;
  onCancelPromotion: () => void;
  onVoiceCommand: (transcript: string) => { ok: boolean; message: string };
  onResetGame: () => void;
  onReturnToMenu: () => void;
}

const PROMOTION_OPTIONS: { type: PromotionPiece; label: string }[] = [
  { type: 'q', label: 'Queen' },
  { type: 'r', label: 'Rook' },
  { type: 'b', label: 'Bishop' },
  { type: 'n', label: 'Knight' },
];

const DIFFICULTY_OPTIONS: {
  id: Difficulty;
  label: string;
  detail: string;
}[] = [
  { id: 'easy', label: 'Easy', detail: 'Casual depth · forgiving' },
  { id: 'medium', label: 'Medium', detail: 'Balanced tactical play' },
  { id: 'hard', label: 'Hard', detail: 'Deep search · full strength' },
];

const PIECE_NAMES: Record<CapturedPieceSymbol, string> = {
  q: 'Queen',
  r: 'Rook',
  b: 'Bishop',
  n: 'Knight',
  p: 'Pawn',
};

function formatDrawMessage(status: GameStatus): string {
  switch (status.reason) {
    case 'stalemate':
      return 'Draw by Stalemate';
    case 'threefold':
      return 'Draw by Threefold Repetition';
    case 'insufficient':
      return 'Draw by Insufficient Material';
    case 'draw':
      return 'Draw by 50-Move Rule';
    default:
      return 'Game Over';
  }
}

function ChessPieceGlyph({
  type,
  pieceColor,
}: {
  type: CapturedPieceSymbol;
  pieceColor: Color;
}) {
  const fill = pieceColor === 'w' ? '#ece4d4' : '#262b34';
  const stroke = pieceColor === 'w' ? '#5e564a' : '#8590a4';

  const paths: Record<CapturedPieceSymbol, ReactElement> = {
    p: (
      <path
        d="M12 5a2.6 2.6 0 1 0 0 5.2A2.6 2.6 0 0 0 12 5Zm-2.5 6.4h5l1.2 4.6H8.3l1.2-4.6ZM7 17.5h10v2H7v-2Z"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    ),
    r: (
      <path
        d="M7 5h2v2h2V5h2v2h2V5h2v4l-1.5 1.5v6.5L17 18.5v1.5H7v-1.5L8.5 17V10.5L7 9V5Z"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    ),
    n: (
      <path
        d="M8.5 18.5v-1.8l2-2.2c.6-1.8-.3-3.2-1.8-3.6l-1.7.7-.8-1.4L9.2 6.8 9 4.5l2.5 1.1c2.7.2 4.8 2.4 5 5.4l.4 5.5 1.1 2v1.5H7v-1.5h1.5Z"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    ),
    b: (
      <path
        d="M12 3.5a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm0 3.2c-2.3 1.6-3.4 4.1-2.5 6.6l-.8 3.7h6.6l-.8-3.7c.9-2.5-.2-5-2.5-6.6Zm-5 11.3h10v2H7v-2Z"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    ),
    q: (
      <path
        d="m5 7 3.2 4.5L12 5.5l3.8 6L19 7l-1.7 9.5H6.7L5 7Zm1.5 11h11v2h-11v-2Z"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      aria-label={`${pieceColor === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[type]}`}
    >
      {paths[type]}
    </svg>
  );
}

function CapturedColorSection({
  label,
  capturedPieceColor,
  pieces,
  advantage,
}: {
  label: string;
  capturedPieceColor: Color;
  pieces: CapturedPieceSymbol[];
  advantage: number;
}) {
  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-[#b5becd]">
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span
            className={`inline-block h-2.5 w-2.5 border ${
              capturedPieceColor === 'b'
                ? 'border-white/30 bg-[#ece4d4]'
                : 'border-white/30 bg-[#23262b]'
            }`}
            aria-hidden="true"
          />
          {label}
        </span>
        {advantage > 0 && (
          <span className="font-mono-tabular text-xs font-semibold text-[#e5b85c]">
            +{advantage}
          </span>
        )}
      </div>

      {pieces.length === 0 ? (
        <p className="mt-1.5 text-xs text-[#697385]">No captures</p>
      ) : (
        <div
          className="mt-1.5 flex flex-wrap gap-1"
          aria-label={`${label} captured pieces`}
        >
          {pieces.map((type, idx) => (
            <span
              key={`${type}-${idx}`}
              title={`${capturedPieceColor === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[type]}`}
              className="inline-flex items-center justify-center rounded bg-[#161b26] p-0.5"
            >
              <ChessPieceGlyph type={type} pieceColor={capturedPieceColor} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AudioControlsBar({
  settings,
  onToggleMute,
  onMasterChange,
  onSfxChange,
  onAmbienceChange,
}: {
  settings: AudioSettings;
  onToggleMute: () => void;
  onMasterChange: (val: number) => void;
  onSfxChange: (val: number) => void;
  onAmbienceChange: (val: number) => void;
}) {
  const [mixOpen, setMixOpen] = useState(false);

  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={settings.muted ? 'Unmute audio' : 'Mute audio'}
        title={settings.muted ? 'Unmute audio' : 'Mute audio'}
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded border px-2.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
          settings.muted
            ? 'border-red-400/45 bg-red-950/80 text-red-100 hover:bg-red-900/80'
            : 'border-white/15 bg-[#151a24] text-[#cfd6e3] hover:bg-[#1e2534] hover:text-white'
        }`}
      >
        {settings.muted ? (
          <VolumeX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className="hidden md:inline">
          {settings.muted ? 'Muted' : 'Sound'}
        </span>
      </button>

      <label className="flex items-center gap-1.5 rounded border border-white/10 bg-[#151a24] px-2.5 py-1.5 text-xs text-[#b8c1d0] shrink-0">
        <span className="sr-only">Master Volume</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(settings.masterVolume * 100)}
          onChange={(e) => onMasterChange(Number(e.target.value) / 100)}
          aria-label="Master volume"
          className="h-1.5 w-16 cursor-pointer accent-[#c99b3b]"
        />
        <span className="font-mono-tabular w-7 text-right text-[11px] text-[#e5b85c]">
          {Math.round(settings.masterVolume * 100)}%
        </span>
      </label>

      <button
        type="button"
        onClick={() => setMixOpen((v) => !v)}
        aria-expanded={mixOpen}
        aria-label="Audio mix settings"
        title="Effects & Ambience mix"
        className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
          mixOpen
            ? 'border-[#c99b3b]/60 bg-[#1f1c16] text-[#f1dca7]'
            : 'border-white/15 bg-[#151a24] text-[#cfd6e3] hover:bg-[#1e2534] hover:text-white'
        }`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </button>

      {mixOpen && (
        <div
          role="dialog"
          aria-label="Audio Mix"
          className="absolute right-0 top-full z-30 mt-2 w-56 border border-[#c99b3b]/35 bg-[#0d111a] p-3.5 shadow-2xl"
        >
          <div className="border-b border-white/10 pb-1.5 text-xs font-semibold text-[#e7e0d2]">
            Audio Mix
          </div>

          <div className="mt-3 space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs text-[#b8c1d0]">
                <label htmlFor="audio-sfx-slider">Effects</label>
                <span className="font-mono-tabular text-[#e5b85c]">
                  {Math.round(settings.sfxVolume * 100)}%
                </span>
              </div>
              <input
                id="audio-sfx-slider"
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(settings.sfxVolume * 100)}
                onChange={(e) => onSfxChange(Number(e.target.value) / 100)}
                className="mt-1 h-1.5 w-full cursor-pointer accent-[#c99b3b]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs text-[#b8c1d0]">
                <label htmlFor="audio-ambience-slider">Ambience</label>
                <span className="font-mono-tabular text-[#e5b85c]">
                  {Math.round(settings.ambienceVolume * 100)}%
                </span>
              </div>
              <input
                id="audio-ambience-slider"
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(settings.ambienceVolume * 100)}
                onChange={(e) => onAmbienceChange(Number(e.target.value) / 100)}
                className="mt-1 h-1.5 w-full cursor-pointer accent-[#c99b3b]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function GameHUD({
  hasStarted,
  gameMode,
  difficulty,
  status,
  capturedPieces,
  pendingPromotion,
  isAiThinking,
  isHumanTurn,
  isAnimating,
  checkmateTitleVisible,
  onSelectMode,
  onSelectDifficulty,
  onStartGame,
  onConfirmPromotion,
  onCancelPromotion,
  onVoiceCommand,
  onResetGame,
  onReturnToMenu,
}: GameHUDProps) {
  const [panelOpen, setPanelOpen] = useState(true);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(() =>
    getAudioSettings()
  );
  const [isListening, setIsListening] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const handleToggleMute = useCallback(() => {
    unlockAudio();
    const nextMuted = !audioSettings.muted;
    setMuted(nextMuted);
    setAudioSettings(getAudioSettings());
  }, [audioSettings.muted]);

  const handleMasterVolume = useCallback((val: number) => {
    unlockAudio();
    setMasterVolume(val);
    if (val > 0 && getAudioSettings().muted) {
      setMuted(false);
    }
    setAudioSettings(getAudioSettings());
  }, []);

  const handleSfxVolume = useCallback((val: number) => {
    unlockAudio();
    setSfxVolume(val);
    setAudioSettings(getAudioSettings());
  }, []);

  const handleAmbienceVolume = useCallback((val: number) => {
    unlockAudio();
    setAmbienceVolume(val);
    setAudioSettings(getAudioSettings());
  }, []);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const speechSupported = getSpeechRecognitionCtor() !== null;

  const showVoiceFeedback = useCallback((ok: boolean, message: string) => {
    setVoiceFeedback({ ok, message });
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => {
      setVoiceFeedback(null);
      feedbackTimerRef.current = null;
    }, 3800);
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore abort errors
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  useEffect(() => {
    return () => {
      stopListening();
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, [stopListening]);

  useEffect(() => {
    if (!hasStarted || status.isGameOver) {
      stopListening();
    }
  }, [hasStarted, status.isGameOver, stopListening]);

  const toggleVoiceInput = useCallback(() => {
    if (isListening) {
      stopListening();
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      showVoiceFeedback(
        false,
        'Voice input is not supported in this browser.'
      );
      return;
    }

    try {
      const recognition = new Ctor();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 3;

      recognition.onresult = (event) => {
        const result = event.results[0];
        if (!result || result.length === 0) {
          showVoiceFeedback(false, 'No speech recognized.');
          return;
        }

        let bestResult = onVoiceCommand(result[0].transcript);
        if (!bestResult.ok) {
          for (let i = 1; i < result.length; i++) {
            const altAttempt = onVoiceCommand(result[i].transcript);
            if (altAttempt.ok) {
              bestResult = altAttempt;
              break;
            }
          }
        }
        showVoiceFeedback(bestResult.ok, bestResult.message);
      };

      recognition.onerror = (event) => {
        if (event.error !== 'aborted') {
          const msg =
            event.error === 'not-allowed'
              ? 'Microphone permission denied.'
              : 'Could not capture voice command.';
          showVoiceFeedback(false, msg);
        }
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      setIsListening(true);
      setVoiceFeedback(null);
      recognition.start();
    } catch {
      setIsListening(false);
      showVoiceFeedback(false, 'Unable to start voice recognition.');
    }
  }, [isListening, onVoiceCommand, showVoiceFeedback, stopListening]);

  const turnLabel = status.turn === 'w' ? 'White' : 'Black';

  if (!hasStarted) {
    return (
      <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-[#06090f]/68 p-4">
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
          <AudioControlsBar
            settings={audioSettings}
            onToggleMute={handleToggleMute}
            onMasterChange={handleMasterVolume}
            onSfxChange={handleSfxVolume}
            onAmbienceChange={handleAmbienceVolume}
          />
        </div>
        <section
          aria-label="Start Menu"
          className="w-full max-w-md border border-[#c99b3b]/40 bg-[#0d111a]/95 p-7 shadow-2xl"
        >
          <div className="border-b border-white/10 pb-5 text-center">
            <h1 className="font-display text-3xl font-semibold tracking-wide text-[#f3ede0]">
              Stonebound Gambit
            </h1>
            <p className="mt-1.5 text-xs tracking-wide text-[#9aa3b2]">
              Obsidian &amp; Marble Chess
            </p>
          </div>

          <div className="mt-6">
            <div className="text-xs font-semibold text-[#b8c1d0]">
              Game Mode
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 bg-[#141925] p-1 border border-white/10">
              <button
                type="button"
                onClick={() => onSelectMode('single')}
                className={`cursor-pointer px-3 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
                  gameMode === 'single'
                    ? 'bg-[#c99b3b] text-[#14110b]'
                    : 'text-[#c4ccd9] hover:text-white'
                }`}
              >
                Single Player
              </button>
              <button
                type="button"
                onClick={() => onSelectMode('local')}
                className={`cursor-pointer px-3 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
                  gameMode === 'local'
                    ? 'bg-[#c99b3b] text-[#14110b]'
                    : 'text-[#c4ccd9] hover:text-white'
                }`}
              >
                Two Players
              </button>
            </div>
            <p className="mt-2 text-xs text-[#8d96a6]">
              {gameMode === 'single'
                ? 'Play as White against the Black AI.'
                : 'Local pass-and-play match on a single board.'}
            </p>
          </div>

          {gameMode === 'single' && (
            <div className="mt-5">
              <div className="text-xs font-semibold text-[#b8c1d0]">
                AI Difficulty
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 bg-[#141925] p-1 border border-white/10">
                {DIFFICULTY_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onSelectDifficulty(opt.id)}
                    className={`cursor-pointer px-2.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
                      difficulty === opt.id
                        ? 'bg-[#e5b85c] text-[#14110b]'
                        : 'text-[#c4ccd9] hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-[#8d96a6]">
                {
                  DIFFICULTY_OPTIONS.find((d) => d.id === difficulty)?.detail
                }
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => onStartGame(gameMode, difficulty)}
            className="mt-7 w-full cursor-pointer bg-[#c99b3b] px-6 py-3 text-sm font-semibold text-[#14110b] transition-colors hover:bg-[#dcae4c] focus-visible:outline-2 focus-visible:outline-white"
          >
            Start Game
          </button>
        </section>
      </div>
    );
  }

  const modeLabel =
    gameMode === 'single'
      ? `Single Player · ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}`
      : 'Two Players';

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-4 sm:p-6">
      {/* Top Bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-[#0b0e16]/88 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-lg font-semibold tracking-wide text-[#f3ede0] whitespace-nowrap shrink-0 sm:text-xl">
            Stonebound Gambit
          </h1>
          <span className="hidden text-xs text-[#8e97a8] sm:inline whitespace-nowrap">
            {modeLabel}
          </span>
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center gap-4 shrink-0">
          {!status.isGameOver && (
            <div className="flex items-center gap-2.5 text-sm font-medium text-[#e7e0d2] whitespace-nowrap">
              <span
                className={`inline-block h-3 w-3 border border-white/35 ${
                  status.turn === 'w' ? 'bg-[#ede7db]' : 'bg-[#23262b]'
                }`}
                aria-hidden="true"
              />
              <span>
                {isAiThinking
                  ? 'Black is thinking...'
                  : `${turnLabel} to Move`}
              </span>
            </div>
          )}

          {status.isCheck && !status.isGameOver && (
            <div
              role="status"
              className="border border-red-400/50 bg-red-950/90 px-3 py-1 text-xs font-semibold tracking-wide text-red-100 whitespace-nowrap"
            >
              Check
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <AudioControlsBar
              settings={audioSettings}
              onToggleMute={handleToggleMute}
              onMasterChange={handleMasterVolume}
              onSfxChange={handleSfxVolume}
              onAmbienceChange={handleAmbienceVolume}
            />
            {!status.isGameOver && (
              <button
                type="button"
                onClick={toggleVoiceInput}
                disabled={
                  !speechSupported ||
                  !isHumanTurn ||
                  isAiThinking ||
                  isAnimating ||
                  Boolean(pendingPromotion)
                }
                title={
                  speechSupported
                    ? 'Speak a move (e.g. "Knight to H3" or "Pawn to E4")'
                    : 'Voice commands require Web Speech API browser support'
                }
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#e5b85c] disabled:cursor-not-allowed disabled:opacity-45 ${
                  isListening
                    ? 'border-[#e5b85c] bg-[#c99b3b] text-[#14110b]'
                    : 'border-white/15 bg-[#151a24] text-[#cfd6e3] hover:bg-[#1e2534] hover:text-white'
                }`}
              >
                {isListening ? (
                  <MicOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <Mic className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>{isListening ? 'Listening...' : 'Voice Move'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              className="cursor-pointer rounded border border-white/15 bg-[#151a24] px-3 py-2 text-xs font-medium text-[#cfd6e3] transition-colors hover:bg-[#1e2534] hover:text-white focus-visible:outline-2 focus-visible:outline-[#e5b85c] whitespace-nowrap shrink-0"
            >
              {panelOpen ? 'Hide Captures' : 'Show Captures'}
            </button>
            <button
              type="button"
              onClick={onReturnToMenu}
              className="cursor-pointer rounded border border-white/15 bg-[#151a24] px-3 py-2 text-xs font-medium text-[#cfd6e3] transition-colors hover:bg-[#1e2534] hover:text-white focus-visible:outline-2 focus-visible:outline-[#e5b85c] whitespace-nowrap shrink-0"
            >
              Menu
            </button>
            <button
              type="button"
              onClick={onResetGame}
              className="cursor-pointer rounded border border-[#c99b3b]/45 bg-[#1b1915] px-4 py-2 text-xs font-semibold text-[#f1dca7] transition-colors hover:bg-[#2a251c] hover:text-white focus-visible:outline-2 focus-visible:outline-[#e5b85c] whitespace-nowrap shrink-0"
            >
              New Game
            </button>
          </div>
        </div>
      </header>

      {(isListening || voiceFeedback) && !checkmateTitleVisible && (
        <div
          role="status"
          className={`mt-2 self-center border px-4 py-1.5 text-xs font-medium shadow-lg ${
            isListening
              ? 'border-[#e5b85c]/60 bg-[#141720]/94 text-[#f3e3bd]'
              : voiceFeedback?.ok
                ? 'border-emerald-400/40 bg-[#0f1916]/94 text-emerald-100'
                : 'border-amber-400/45 bg-[#1b1410]/94 text-amber-100'
          }`}
        >
          {isListening
            ? 'Speak a move — e.g. "Knight to H3", "Pawn to E4", "Castle kingside"'
            : voiceFeedback?.message}
        </div>
      )}

      {/* Captured Pieces Side Panel */}
      {panelOpen && !checkmateTitleVisible && (
        <aside
          aria-label="Captured pieces"
          className="pointer-events-auto self-end mt-3 w-52 border border-white/10 bg-[#0d1018]/92 px-3.5 py-1.5 shadow-xl"
        >
          <div className="border-b border-white/10 pb-1.5 pt-1 text-xs font-semibold tracking-wide text-[#9aa3b2]">
            Captured Pieces
          </div>

          <CapturedColorSection
            label="White"
            capturedPieceColor="b"
            pieces={capturedPieces.byWhite}
            advantage={
              capturedPieces.whiteAdvantage > 0
                ? capturedPieces.whiteAdvantage
                : 0
            }
          />

          <div className="border-t border-white/10" />

          <CapturedColorSection
            label="Black"
            capturedPieceColor="w"
            pieces={capturedPieces.byBlack}
            advantage={
              capturedPieces.whiteAdvantage < 0
                ? Math.abs(capturedPieces.whiteAdvantage)
                : 0
            }
          />
        </aside>
      )}

      {/* Dramatic Checkmate Title Fade-In Overlay */}
      {status.isGameOver && status.reason === 'checkmate' && (
        <div
          className={`fixed inset-x-0 bottom-0 z-20 flex flex-col items-center justify-end bg-gradient-to-t from-[#05070c]/95 via-[#05070c]/60 to-transparent px-6 pb-14 pt-24 text-center transition-opacity duration-700 ${
            checkmateTitleVisible
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0'
          }`}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkmate-title"
            className="max-w-md"
          >
            <h2
              id="checkmate-title"
              className="font-display text-4xl font-semibold tracking-wider text-[#f3ede0] sm:text-5xl"
            >
              Checkmate
            </h2>
            <p className="mt-2.5 text-sm font-medium text-[#e5b85c]">
              {status.winner === 'w' ? 'White' : 'Black'} claims victory
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={onResetGame}
                className="cursor-pointer rounded bg-[#c99b3b] px-6 py-2.5 text-sm font-semibold text-[#14110b] transition-colors hover:bg-[#dcae4c] focus-visible:outline-2 focus-visible:outline-white whitespace-nowrap"
              >
                New Game
              </button>
              <button
                type="button"
                onClick={onReturnToMenu}
                className="cursor-pointer rounded border border-white/20 bg-[#121620] px-5 py-2.5 text-sm font-medium text-[#e0e6f0] transition-colors hover:bg-[#1b2232] focus-visible:outline-2 focus-visible:outline-[#e5b85c] whitespace-nowrap"
              >
                Main Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Draw Game Over Modal */}
      {status.isGameOver && status.reason !== 'checkmate' && (
        <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-[#06080d]/75 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-over-title"
            className="w-full max-w-sm border border-[#c99b3b]/40 bg-[#121620] p-7 text-center shadow-2xl"
          >
            <h2
              id="game-over-title"
              className="font-display text-2xl font-semibold text-[#f3ede0]"
            >
              Game Over
            </h2>
            <p className="mt-2 text-sm text-[#c6cdd9]">
              {formatDrawMessage(status)}
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={onResetGame}
                className="cursor-pointer rounded bg-[#c99b3b] px-6 py-2.5 text-sm font-semibold text-[#14110b] transition-colors hover:bg-[#dcae4c] focus-visible:outline-2 focus-visible:outline-white whitespace-nowrap"
              >
                New Game
              </button>
              <button
                type="button"
                onClick={onReturnToMenu}
                className="cursor-pointer rounded border border-white/15 bg-[#191f2d] px-4 py-2.5 text-sm font-medium text-[#d4dce8] transition-colors hover:bg-[#232b3d] focus-visible:outline-2 focus-visible:outline-[#e5b85c] whitespace-nowrap"
              >
                Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pawn Promotion Modal */}
      {pendingPromotion && (
        <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-[#06080d]/75 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="promotion-title"
            className="w-full max-w-sm border border-[#c99b3b]/40 bg-[#121620] p-7 text-center shadow-2xl"
          >
            <h2
              id="promotion-title"
              className="font-display text-xl font-semibold text-[#f3ede0]"
            >
              Promote Pawn
            </h2>
            <p className="mt-1.5 text-sm text-[#b9c1cf]">
              Select a piece for promotion:
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              {PROMOTION_OPTIONS.map((option) => (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => onConfirmPromotion(option.type)}
                  className="cursor-pointer rounded bg-[#c99b3b] px-4 py-2.5 text-sm font-semibold text-[#14110b] transition-colors hover:bg-[#dcae4c] focus-visible:outline-2 focus-visible:outline-white"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onCancelPromotion}
              className="mt-4 cursor-pointer text-xs font-medium text-[#9aa3b2] underline hover:text-white focus-visible:outline-2 focus-visible:outline-[#e5b85c]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Quiet Controls Footer */}
      {!checkmateTitleVisible && (
        <footer className="mt-auto self-center border border-white/10 bg-[#0b0e16]/85 px-4 py-1.5 text-center text-xs text-[#9aa3b2]">
          Click a piece to select · Click a highlighted square to move
          {speechSupported ? ' · Voice commands supported' : ''} · Drag to orbit
          · Scroll to zoom
        </footer>
      )}
    </div>
  );
}
