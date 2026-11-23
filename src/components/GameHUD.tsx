import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Check,
  Clock,
  Copy,
  Flag,
  Globe,
  GraduationCap,
  Handshake,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  RefreshCw,
  Repeat2,
  SlidersHorizontal,
  UserPlus,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from 'lucide-react';
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
import {
  buildInviteUrl,
  isValidRoomCode,
  normalizeRoomInput,
  ONLINE_EMOTES,
  type OnlineConnectionStatus,
  type OnlineEmoteText,
  type OnlineRole,
} from '../game/onlineMultiplayer';
import type {
  CapturedPieceSymbol,
  CapturedPiecesSummary,
  ClockConfig,
  ClockIncrement,
  ClockMinutes,
  Difficulty,
  GameMode,
  GameStatus,
  MatchStateSnapshot,
  PendingPromotion,
  PlayerNames,
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
  tutorMode: boolean;
  matchState: MatchStateSnapshot;
  status: GameStatus;
  capturedPieces: CapturedPiecesSummary;
  pendingPromotion: PendingPromotion | null;
  isAiThinking: boolean;
  isTutorEvaluating: boolean;
  hasPendingTutorWarning: boolean;
  isOfferDrawBusy: boolean;
  isHumanTurn: boolean;
  localPlayerColor: Color;
  onlineRole: OnlineRole | null;
  onlineStatus: OnlineConnectionStatus;
  onlineRoomCode: string;
  onlineJoinCodeInput: string;
  onlinePlayerName: string;
  onlineError: string | null;
  isRematchPending: boolean;
  opponentEmote: { id: number; text: OnlineEmoteText } | null;
  isEmoteOnCooldown: boolean;
  isAnimating: boolean;
  checkmateTitleVisible: boolean;
  onSelectMode: (mode: GameMode) => void;
  onSelectDifficulty: (difficulty: Difficulty) => void;
  onToggleTutorMode: (enabled: boolean) => void;
  onUpdateLobbyNames: (names: PlayerNames) => void;
  onUpdateLobbyClock: (clockConfig: ClockConfig) => void;
  onUpdateJoinCodeInput: (code: string) => void;
  onUpdateOnlinePlayerName: (name: string) => void;
  onCreateOnlineGame: () => void;
  onJoinOnlineGame: (code?: string) => void;
  onCancelOnlineLobby: () => void;
  onStartGame: (
    mode: GameMode,
    difficulty: Difficulty,
    names: PlayerNames,
    clockConfig: ClockConfig
  ) => void;
  onConfirmPromotion: (piece: PromotionPiece) => void;
  onCancelPromotion: () => void;
  onVoiceCommand: (transcript: string) => { ok: boolean; message: string };
  onResignGame: () => void;
  onOfferDraw: () => void;
  onRespondDrawOffer: (accept: boolean) => void;
  onSendEmote: (text: OnlineEmoteText) => void;
  onResetGame: () => void;
  onRematchGame: () => void;
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

const CLOCK_MINUTE_OPTIONS: { value: ClockMinutes; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 3, label: '3 min' },
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
];

const CLOCK_INCREMENT_OPTIONS: { value: ClockIncrement; label: string }[] = [
  { value: 0, label: '+0s' },
  { value: 2, label: '+2s' },
  { value: 5, label: '+5s' },
];

const PIECE_NAMES: Record<CapturedPieceSymbol, string> = {
  q: 'Queen',
  r: 'Rook',
  b: 'Bishop',
  n: 'Knight',
  p: 'Pawn',
};

function formatWinnerPhrase(winnerName: string): string {
  return winnerName.trim().toLowerCase() === 'you'
    ? 'You win'
    : `${winnerName} wins`;
}

function formatGameOverMessage(
  status: GameStatus,
  names: PlayerNames
): string {
  const winnerName = status.winner ? names[status.winner] : null;

  switch (status.reason) {
    case 'resignation':
      return winnerName
        ? `${formatWinnerPhrase(winnerName)} by resignation`
        : 'Game ended by resignation';
    case 'timeout':
      return winnerName
        ? `${formatWinnerPhrase(winnerName)} on time`
        : 'Game ended on time';
    case 'draw_agreement':
      return 'Draw by Agreement';
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

function formatClockMs(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 20_000) {
    const totalTenths = Math.ceil(clamped / 100);
    const secs = Math.floor(totalTenths / 10);
    const tenths = totalTenths % 10;
    return `0:${secs.toString().padStart(2, '0')}.${tenths}`;
  }
  const totalSeconds = Math.ceil(clamped / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
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
  playerName,
  sideLabel,
  capturedPieceColor,
  pieces,
  advantage,
}: {
  playerName: string;
  sideLabel: 'White' | 'Black';
  capturedPieceColor: Color;
  pieces: CapturedPieceSymbol[];
  advantage: number;
}) {
  const showSideTag = playerName.trim().toLowerCase() !== sideLabel.toLowerCase();

  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-[#b5becd]">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`inline-block h-2.5 w-2.5 shrink-0 border ${
              capturedPieceColor === 'b'
                ? 'border-white/30 bg-[#ece4d4]'
                : 'border-white/30 bg-[#23262b]'
            }`}
            aria-hidden="true"
          />
          <span className="truncate font-semibold text-[#e7e0d2]">
            {playerName}
          </span>
          {showSideTag && (
            <span className="shrink-0 text-[11px] text-[#7c8698]">
              ({sideLabel})
            </span>
          )}
        </span>
        {advantage > 0 && (
          <span className="font-mono-tabular shrink-0 text-xs font-semibold text-[#e5b85c]">
            +{advantage}
          </span>
        )}
      </div>

      {pieces.length === 0 ? (
        <p className="mt-1.5 text-xs text-[#697385]">No captures</p>
      ) : (
        <div
          className="mt-1.5 flex flex-wrap gap-1"
          aria-label={`${playerName} captured pieces`}
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

function ClockRow({
  color,
  playerName,
  remainingMs,
  isActive,
}: {
  color: Color;
  playerName: string;
  remainingMs: number;
  isActive: boolean;
}) {
  const isLowTime = remainingMs < 30_000;

  return (
    <div
      className={`flex items-center justify-between gap-2 border px-3 py-2 transition-colors ${
        isLowTime
          ? 'border-red-400/75 bg-red-950/85 text-red-100'
          : isActive
            ? 'border-[#c99b3b]/65 bg-[#1b1812] text-[#f3ede0]'
            : 'border-white/10 bg-[#121622] text-[#aeb7c6]'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 shrink-0 border border-white/35 ${
            color === 'w' ? 'bg-[#ede7db]' : 'bg-[#23262b]'
          }`}
          aria-hidden="true"
        />
        <span className="truncate text-xs font-medium">{playerName}</span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isLowTime && (
          <span className="text-[10px] font-semibold text-red-200">
            Low
          </span>
        )}
        <span
          aria-label={`${playerName} clock`}
          className={`font-mono-tabular text-sm font-semibold ${
            isLowTime
              ? 'text-red-100'
              : isActive
                ? 'text-[#f1dca7]'
                : 'text-[#cfd6e3]'
          }`}
        >
          {formatClockMs(remainingMs)}
        </span>
      </div>
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
  tutorMode,
  matchState,
  status,
  capturedPieces,
  pendingPromotion,
  isAiThinking,
  isTutorEvaluating,
  hasPendingTutorWarning,
  isOfferDrawBusy,
  isHumanTurn,
  localPlayerColor,
  onlineRole,
  onlineStatus,
  onlineRoomCode,
  onlineJoinCodeInput,
  onlinePlayerName,
  onlineError,
  isRematchPending,
  opponentEmote,
  isEmoteOnCooldown,
  isAnimating,
  checkmateTitleVisible,
  onSelectMode,
  onSelectDifficulty,
  onToggleTutorMode,
  onUpdateLobbyNames,
  onUpdateLobbyClock,
  onUpdateJoinCodeInput,
  onUpdateOnlinePlayerName,
  onCreateOnlineGame,
  onJoinOnlineGame,
  onCancelOnlineLobby,
  onStartGame,
  onConfirmPromotion,
  onCancelPromotion,
  onVoiceCommand,
  onResignGame,
  onOfferDraw,
  onRespondDrawOffer,
  onSendEmote,
  onResetGame,
  onRematchGame,
  onReturnToMenu,
}: GameHUDProps) {
  const [panelOpen, setPanelOpen] = useState(true);
  const [resignConfirmOpen, setResignConfirmOpen] = useState(false);
  const [onlineOption, setOnlineOption] = useState<'create' | 'join' | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(() =>
    getAudioSettings()
  );
  const [isListening, setIsListening] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!hasStarted || status.isGameOver) {
      setResignConfirmOpen(false);
    }
  }, [hasStarted, status.isGameOver]);

  useEffect(() => {
    if (onlineRole === 'guest') {
      setOnlineOption('join');
    } else if (onlineRole === 'host') {
      setOnlineOption('create');
    } else if (gameMode !== 'online') {
      setOnlineOption(null);
    }
  }, [onlineRole, gameMode]);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const handleCopyInviteLink = useCallback(async (roomCode: string) => {
    if (!roomCode) return;
    const url = buildInviteUrl(roomCode);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedInvite(true);
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopiedInvite(false);
        copyResetTimerRef.current = null;
      }, 2200);
    } catch {
      setCopiedInvite(false);
    }
  }, []);

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

  if (!hasStarted) {
    const { names, clockConfig } = matchState;
    const defaultWhite = gameMode === 'single' ? 'You' : 'White';
    const defaultBlack = gameMode === 'single' ? 'Stockfish' : 'Black';
    const normalizedJoinCode = normalizeRoomInput(onlineJoinCodeInput);
    const joinReady = isValidRoomCode(normalizedJoinCode);

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
          className="max-h-[92vh] w-full max-w-lg overflow-y-auto border border-[#c99b3b]/40 bg-[#0d111a]/95 p-7 shadow-2xl"
        >
          <div className="border-b border-white/10 pb-4 text-center">
            <h1 className="font-display text-3xl font-semibold tracking-wide text-[#f3ede0]">
              Stonebound Gambit
            </h1>
            <p className="mt-1.5 text-xs tracking-wide text-[#9aa3b2]">
              Obsidian &amp; Marble Chess
            </p>
          </div>

          <div className="mt-5">
            <div className="text-xs font-semibold text-[#b8c1d0]">
              Game Mode
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 border border-white/10 bg-[#141925] p-1">
              <button
                type="button"
                onClick={() => onSelectMode('single')}
                className={`cursor-pointer px-2.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
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
                className={`cursor-pointer px-2.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
                  gameMode === 'local'
                    ? 'bg-[#c99b3b] text-[#14110b]'
                    : 'text-[#c4ccd9] hover:text-white'
                }`}
              >
                Two Players
              </button>
              <button
                type="button"
                onClick={() => onSelectMode('online')}
                className={`cursor-pointer px-2.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
                  gameMode === 'online'
                    ? 'bg-[#c99b3b] text-[#14110b]'
                    : 'text-[#c4ccd9] hover:text-white'
                }`}
              >
                Play Online
              </button>
            </div>
            <p className="mt-1.5 text-xs text-[#8d96a6]">
              {gameMode === 'single'
                ? 'Play as White against the Black AI.'
                : gameMode === 'local'
                  ? 'Local pass-and-play match on a single board.'
                  : 'Peer-to-peer online chess over WebRTC with no server required.'}
            </p>
          </div>

          {gameMode === 'online' ? (
            <div className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="online-player-name-input"
                  className="block text-xs font-semibold text-[#b8c1d0]"
                >
                  Your Name
                </label>
                <input
                  id="online-player-name-input"
                  type="text"
                  maxLength={20}
                  value={onlinePlayerName}
                  placeholder={onlineOption === 'join' ? 'Black' : 'White'}
                  onChange={(e) => onUpdateOnlinePlayerName(e.target.value)}
                  className="mt-1.5 w-full border border-white/15 bg-[#141925] px-3 py-2 text-xs text-[#f3ede0] placeholder:text-[#656f80] focus:border-[#c99b3b] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 border border-white/10 bg-[#141925] p-1">
                <button
                  type="button"
                  onClick={() => {
                    setOnlineOption('create');
                    setCopiedInvite(false);
                    if (onlineRole !== 'host') {
                      onCreateOnlineGame();
                    }
                  }}
                  className={`inline-flex cursor-pointer items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
                    onlineOption === 'create'
                      ? 'bg-[#e5b85c] text-[#14110b]'
                      : 'text-[#c4ccd9] hover:text-white'
                  }`}
                >
                  <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Create Game</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onlineRole === 'host') {
                      onCancelOnlineLobby();
                    }
                    setOnlineOption('join');
                  }}
                  className={`inline-flex cursor-pointer items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
                    onlineOption === 'join'
                      ? 'bg-[#e5b85c] text-[#14110b]'
                      : 'text-[#c4ccd9] hover:text-white'
                  }`}
                >
                  <UserPlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Join Game</span>
                </button>
              </div>

              {onlineOption === null && (
                <div className="border border-white/10 bg-[#141925] p-4 text-center text-xs text-[#9aa3b2]">
                  Choose <strong className="text-[#e7e0d2]">Create Game</strong> to host as White with a 5-character room code, or{' '}
                  <strong className="text-[#e7e0d2]">Join Game</strong> to enter a friend&apos;s code and play as Black.
                </div>
              )}

              {onlineOption === 'create' && (
                <div className="border border-[#c99b3b]/35 bg-[#121723] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#e7e0d2]">
                      Room Code (Host · White)
                    </span>
                    <span
                      role="status"
                      className={`border px-2 py-0.5 text-[11px] font-medium ${
                        onlineStatus === 'error'
                          ? 'border-red-400/45 bg-red-950/80 text-red-100'
                          : 'border-[#c99b3b]/45 bg-[#1e1a12] text-[#f1dca7]'
                      }`}
                    >
                      {onlineStatus === 'creating'
                        ? 'Registering...'
                        : onlineStatus === 'waiting'
                          ? 'Waiting for opponent'
                          : onlineStatus === 'error'
                            ? 'Room Error'
                            : 'Ready'}
                    </span>
                  </div>

                  {onlineRoomCode && (
                    <div className="mt-3 flex items-center justify-between gap-3 border border-white/10 bg-[#0b0e16] px-4 py-3">
                      <span
                        aria-label="Room code"
                        className="font-mono-tabular text-2xl font-semibold tracking-[0.26em] text-[#f1dca7]"
                      >
                        {onlineRoomCode}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyInviteLink(onlineRoomCode)}
                        className="inline-flex cursor-pointer items-center gap-1.5 border border-[#c99b3b]/45 bg-[#1b1915] px-3 py-1.5 text-xs font-semibold text-[#f1dca7] transition-colors hover:bg-[#2a251c] hover:text-white focus-visible:outline-2 focus-visible:outline-[#e5b85c] whitespace-nowrap"
                      >
                        {copiedInvite ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden="true" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        )}
                        <span>{copiedInvite ? 'Copied!' : 'Copy invite link'}</span>
                      </button>
                    </div>
                  )}

                  {onlineRoomCode && (
                    <p className="mt-2 break-all text-[11px] text-[#7f899a]">
                      Invite link: {buildInviteUrl(onlineRoomCode)}
                    </p>
                  )}

                  {/* Host Clock Settings */}
                  <div className="mt-3.5 border-t border-white/10 pt-3">
                    <div className="flex items-center justify-between text-xs font-semibold text-[#b8c1d0]">
                      <span>Chess Clock</span>
                      {clockConfig.initialMinutes > 0 && (
                        <span className="font-mono-tabular text-[11px] font-medium text-[#e5b85c]">
                          {clockConfig.initialMinutes}+{clockConfig.incrementSeconds}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1.5 border border-white/10 bg-[#0d111a] p-1">
                      {CLOCK_MINUTE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() =>
                            onUpdateLobbyClock({
                              ...clockConfig,
                              initialMinutes: opt.value,
                            })
                          }
                          className={`cursor-pointer px-2 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
                            clockConfig.initialMinutes === opt.value
                              ? 'bg-[#c99b3b] text-[#14110b]'
                              : 'text-[#c4ccd9] hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    {clockConfig.initialMinutes > 0 && (
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span className="text-xs text-[#8d96a6]">Increment</span>
                        <div className="grid grid-cols-3 gap-1.5 border border-white/10 bg-[#0d111a] p-1">
                          {CLOCK_INCREMENT_OPTIONS.map((inc) => (
                            <button
                              key={inc.value}
                              type="button"
                              onClick={() =>
                                onUpdateLobbyClock({
                                  ...clockConfig,
                                  incrementSeconds: inc.value,
                                })
                              }
                              className={`cursor-pointer px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
                                clockConfig.incrementSeconds === inc.value
                                  ? 'bg-[#e5b85c] text-[#14110b]'
                                  : 'text-[#c4ccd9] hover:text-white'
                              }`}
                            >
                              {inc.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {onlineError && (
                    <p className="mt-2.5 border border-red-400/40 bg-red-950/75 px-3 py-2 text-xs text-red-100">
                      {onlineError}
                    </p>
                  )}

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-[#8d96a6]">
                      Game starts automatically when your opponent joins.
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setCopiedInvite(false);
                          onCreateOnlineGame();
                        }}
                        title="Generate a new room code"
                        className="inline-flex cursor-pointer items-center gap-1 border border-white/15 bg-[#161c29] px-2.5 py-1.5 text-[11px] font-medium text-[#cfd6e3] transition-colors hover:bg-[#1f2738] hover:text-white focus-visible:outline-2 focus-visible:outline-[#e5b85c]"
                      >
                        <RefreshCw className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>New Code</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onCancelOnlineLobby();
                          setOnlineOption(null);
                        }}
                        className="cursor-pointer border border-white/15 bg-[#161c29] px-2.5 py-1.5 text-[11px] font-medium text-[#cfd6e3] transition-colors hover:bg-[#1f2738] hover:text-white focus-visible:outline-2 focus-visible:outline-[#e5b85c]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {onlineOption === 'join' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (joinReady && onlineStatus !== 'joining') {
                      onJoinOnlineGame(normalizedJoinCode);
                    }
                  }}
                  className="border border-[#c99b3b]/35 bg-[#121723] p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="online-room-code-input"
                      className="text-xs font-semibold text-[#e7e0d2]"
                    >
                      Enter Room Code (Guest · Black)
                    </label>
                    {onlineStatus === 'joining' && (
                      <span
                        role="status"
                        className="border border-[#c99b3b]/45 bg-[#1e1a12] px-2 py-0.5 text-[11px] font-medium text-[#f1dca7]"
                      >
                        Connecting...
                      </span>
                    )}
                  </div>

                  <div className="mt-2.5 flex gap-2">
                    <input
                      id="online-room-code-input"
                      type="text"
                      value={onlineJoinCodeInput}
                      placeholder="e.g. K7P9M"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      onChange={(e) =>
                        onUpdateJoinCodeInput(normalizeRoomInput(e.target.value))
                      }
                      className="font-mono-tabular min-w-0 flex-1 border border-white/15 bg-[#0b0e16] px-3 py-2 text-sm uppercase tracking-[0.2em] text-[#f3ede0] placeholder:tracking-normal placeholder:normal-case placeholder:text-[#656f80] focus:border-[#c99b3b] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!joinReady || onlineStatus === 'joining'}
                      className="cursor-pointer bg-[#c99b3b] px-4 py-2 text-xs font-semibold text-[#14110b] transition-colors hover:bg-[#dcae4c] focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
                    >
                      {onlineStatus === 'joining' ? 'Joining...' : 'Join Match'}
                    </button>
                  </div>

                  {onlineError && (
                    <p className="mt-2.5 border border-red-400/40 bg-red-950/75 px-3 py-2 text-xs text-red-100">
                      {onlineError}
                    </p>
                  )}

                  <p className="mt-2.5 text-[11px] text-[#8d96a6]">
                    You play as Black and the 3D board camera flips to your side.
                  </p>
                </form>
              )}
            </div>
          ) : (
            <>
              {gameMode === 'single' && (
                <div className="mt-4">
                  <div className="text-xs font-semibold text-[#b8c1d0]">
                    AI Difficulty
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 border border-white/10 bg-[#141925] p-1">
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
                  <p className="mt-1.5 text-xs text-[#8d96a6]">
                    {
                      DIFFICULTY_OPTIONS.find((d) => d.id === difficulty)?.detail
                    }
                  </p>
                </div>
              )}

              {/* Player Name Inputs */}
              <div className="mt-4">
                <div className="text-xs font-semibold text-[#b8c1d0]">
                  Players
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#9aa3b2]">
                      <span
                        className="inline-block h-2.5 w-2.5 border border-white/35 bg-[#ede7db]"
                        aria-hidden="true"
                      />
                      White
                    </span>
                    <input
                      type="text"
                      maxLength={20}
                      value={names.w}
                      placeholder={defaultWhite}
                      onChange={(e) =>
                        onUpdateLobbyNames({ ...names, w: e.target.value })
                      }
                      className="mt-1 w-full border border-white/15 bg-[#141925] px-3 py-2 text-xs text-[#f3ede0] placeholder:text-[#656f80] focus:border-[#c99b3b] focus:outline-none"
                    />
                  </label>

                  <label className="block">
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#9aa3b2]">
                      <span
                        className="inline-block h-2.5 w-2.5 border border-white/35 bg-[#23262b]"
                        aria-hidden="true"
                      />
                      Black
                    </span>
                    <input
                      type="text"
                      maxLength={20}
                      value={names.b}
                      placeholder={defaultBlack}
                      onChange={(e) =>
                        onUpdateLobbyNames({ ...names, b: e.target.value })
                      }
                      className="mt-1 w-full border border-white/15 bg-[#141925] px-3 py-2 text-xs text-[#f3ede0] placeholder:text-[#656f80] focus:border-[#c99b3b] focus:outline-none"
                    />
                  </label>
                </div>
              </div>

              {/* Optional Chess Clock */}
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs font-semibold text-[#b8c1d0]">
                  <span>Chess Clock</span>
                  {clockConfig.initialMinutes > 0 && (
                    <span className="font-mono-tabular text-[11px] font-medium text-[#e5b85c]">
                      {clockConfig.initialMinutes}+{clockConfig.incrementSeconds}
                    </span>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1.5 border border-white/10 bg-[#141925] p-1">
                  {CLOCK_MINUTE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        onUpdateLobbyClock({
                          ...clockConfig,
                          initialMinutes: opt.value,
                        })
                      }
                      className={`cursor-pointer px-2 py-2 text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
                        clockConfig.initialMinutes === opt.value
                          ? 'bg-[#c99b3b] text-[#14110b]'
                          : 'text-[#c4ccd9] hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {clockConfig.initialMinutes > 0 && (
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-[#8d96a6]">Increment</span>
                    <div className="grid grid-cols-3 gap-1.5 border border-white/10 bg-[#141925] p-1">
                      {CLOCK_INCREMENT_OPTIONS.map((inc) => (
                        <button
                          key={inc.value}
                          type="button"
                          onClick={() =>
                            onUpdateLobbyClock({
                              ...clockConfig,
                              incrementSeconds: inc.value,
                            })
                          }
                          className={`cursor-pointer px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
                            clockConfig.incrementSeconds === inc.value
                              ? 'bg-[#e5b85c] text-[#14110b]'
                              : 'text-[#c4ccd9] hover:text-white'
                          }`}
                        >
                          {inc.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Tutor Mode Toggle (Disabled in Online Multiplayer) */}
          {gameMode !== 'online' && (
            <div className="mt-4 flex items-center justify-between gap-3 border border-white/10 bg-[#141925] px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#e7e0d2]">
                  <GraduationCap className="h-3.5 w-3.5 text-[#c99b3b]" aria-hidden="true" />
                  <span>Tutor Mode</span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#8d96a6]">
                  Evaluates moves before confirmation and warns on blunders.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={tutorMode}
                onClick={() => onToggleTutorMode(!tutorMode)}
                className={`cursor-pointer rounded border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
                  tutorMode
                    ? 'border-[#e5b85c] bg-[#c99b3b] text-[#14110b]'
                    : 'border-white/15 bg-[#1b2130] text-[#cfd6e3] hover:text-white'
                }`}
              >
                {tutorMode ? 'On' : 'Off'}
              </button>
            </div>
          )}

          {gameMode !== 'online' && (
            <button
              type="button"
              onClick={() =>
                onStartGame(gameMode, difficulty, names, clockConfig)
              }
              className="mt-6 w-full cursor-pointer bg-[#c99b3b] px-6 py-3 text-sm font-semibold text-[#14110b] transition-colors hover:bg-[#dcae4c] focus-visible:outline-2 focus-visible:outline-white"
            >
              Start Game
            </button>
          )}
        </section>
      </div>
    );
  }

  const activePlayerName = matchState.names[status.turn];
  const clockTag = matchState.clocks.enabled
    ? ` · ${matchState.clockConfig.initialMinutes}+${matchState.clockConfig.incrementSeconds}`
    : '';
  const modeLabel =
    gameMode === 'single'
      ? `Single Player · ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}${clockTag}`
      : gameMode === 'online'
        ? `Online · Room ${onlineRoomCode} · ${localPlayerColor === 'w' ? 'White' : 'Black'}${clockTag}`
        : `Two Players${clockTag}`;

  const drawOffer = matchState.drawOffer;
  const drawOfferDisabled =
    status.isGameOver ||
    isAnimating ||
    isOfferDrawBusy ||
    (gameMode === 'single' && isAiThinking) ||
    (gameMode === 'online' && onlineStatus !== 'connected') ||
    drawOffer?.status === 'pending' ||
    drawOffer?.status === 'declined';

  const resigningColor: Color =
    gameMode === 'online'
      ? localPlayerColor
      : gameMode === 'single'
        ? matchState.humanColor
        : status.turn;
  const resignerName = matchState.names[resigningColor];
  const resignOpponentName =
    matchState.names[resigningColor === 'w' ? 'b' : 'w'];

  const opponentColor: Color = localPlayerColor === 'w' ? 'b' : 'w';
  const opponentName = matchState.names[opponentColor];
  const winnerName = status.winner ? matchState.names[status.winner] : null;

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

        <div className="pointer-events-auto flex flex-wrap items-center gap-3 shrink-0">
          {gameMode === 'online' && (
            <div
              role="status"
              className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                onlineStatus === 'connected'
                  ? 'border-emerald-400/40 bg-emerald-950/75 text-emerald-100'
                  : onlineStatus === 'reconnecting'
                    ? 'border-amber-400/50 bg-amber-950/80 text-amber-100'
                    : onlineStatus === 'disconnected' || onlineStatus === 'error'
                      ? 'border-red-400/50 bg-red-950/85 text-red-100'
                      : 'border-[#c99b3b]/45 bg-[#1e1a12] text-[#f1dca7]'
              }`}
            >
              {onlineStatus === 'connected' ? (
                <Wifi className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : onlineStatus === 'reconnecting' ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>
                {onlineStatus === 'connected'
                  ? 'Connected'
                  : onlineStatus === 'reconnecting'
                    ? 'Reconnecting...'
                    : onlineStatus === 'disconnected' || onlineStatus === 'error'
                      ? 'Opponent Disconnected'
                      : 'Waiting'}
              </span>
            </div>
          )}

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
                  ? `${activePlayerName} is thinking...`
                  : isTutorEvaluating
                    ? 'Checking move...'
                    : gameMode === 'online'
                      ? status.turn === localPlayerColor
                        ? 'Your Turn'
                        : "Opponent's Turn"
                      : `${activePlayerName} to Move`}
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
              <>
                {gameMode !== 'online' && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={tutorMode}
                    onClick={() => onToggleTutorMode(!tutorMode)}
                    title="Evaluate moves with Stockfish before confirming and warn on blunders"
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#e5b85c] ${
                      tutorMode
                        ? 'border-[#e5b85c] bg-[#c99b3b] font-semibold text-[#14110b]'
                        : 'border-white/15 bg-[#151a24] text-[#cfd6e3] hover:bg-[#1e2534] hover:text-white'
                    }`}
                  >
                    <GraduationCap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{tutorMode ? 'Tutor: On' : 'Tutor: Off'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  disabled={
                    !speechSupported ||
                    !isHumanTurn ||
                    isAiThinking ||
                    isTutorEvaluating ||
                    hasPendingTutorWarning ||
                    isAnimating ||
                    Boolean(pendingPromotion) ||
                    (gameMode === 'online' && onlineStatus !== 'connected')
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

                <button
                  type="button"
                  onClick={onOfferDraw}
                  disabled={drawOfferDisabled || isTutorEvaluating || hasPendingTutorWarning}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-white/15 bg-[#151a24] px-3 py-2 text-xs font-medium text-[#cfd6e3] transition-colors hover:bg-[#1e2534] hover:text-white focus-visible:outline-2 focus-visible:outline-[#e5b85c] disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
                >
                  <Handshake className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{isOfferDrawBusy ? 'Evaluating...' : 'Offer Draw'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setResignConfirmOpen(true)}
                  disabled={gameMode === 'online' && onlineStatus !== 'connected'}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-red-400/35 bg-[#1f1317] px-3 py-2 text-xs font-medium text-red-200 transition-colors hover:bg-red-950/90 hover:text-white focus-visible:outline-2 focus-visible:outline-[#e5b85c] disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
                >
                  <Flag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Resign</span>
                </button>
              </>
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
              {gameMode === 'online' ? 'Back to Menu' : 'Menu'}
            </button>
            {gameMode !== 'online' && (
              <button
                type="button"
                onClick={onResetGame}
                className="cursor-pointer rounded border border-[#c99b3b]/45 bg-[#1b1915] px-4 py-2 text-xs font-semibold text-[#f1dca7] transition-colors hover:bg-[#2a251c] hover:text-white focus-visible:outline-2 focus-visible:outline-[#e5b85c] whitespace-nowrap shrink-0"
              >
                New Game
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Draw Offer Banner (Local / Online Accept/Decline or Status Notice) */}
      {!status.isGameOver && drawOffer && (
        <div
          role="status"
          className="pointer-events-auto mt-2 self-center border border-[#c99b3b]/55 bg-[#0f141e]/95 px-4 py-2.5 text-xs text-[#f3ede0] shadow-xl"
        >
          {drawOffer.status === 'pending' ? (
            gameMode === 'online' && drawOffer.offeredBy === localPlayerColor ? (
              <span>
                Draw offer sent — waiting for{' '}
                <strong className="text-[#f1dca7]">
                  {matchState.names[drawOffer.offeredBy === 'w' ? 'b' : 'w']}
                </strong>
                ...
              </span>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  <strong className="text-[#f1dca7]">
                    {matchState.names[drawOffer.offeredBy]}
                  </strong>{' '}
                  offers a draw —{' '}
                  <strong className="text-[#f1dca7]">
                    {matchState.names[drawOffer.offeredBy === 'w' ? 'b' : 'w']}
                  </strong>
                  :
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={gameMode === 'online' && onlineStatus !== 'connected'}
                    onClick={() => onRespondDrawOffer(true)}
                    className="cursor-pointer rounded bg-[#c99b3b] px-3 py-1 text-xs font-semibold text-[#14110b] transition-colors hover:bg-[#dcae4c] focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={gameMode === 'online' && onlineStatus !== 'connected'}
                    onClick={() => onRespondDrawOffer(false)}
                    className="cursor-pointer rounded border border-white/20 bg-[#191f2d] px-3 py-1 text-xs font-medium text-[#d4dce8] transition-colors hover:bg-[#232b3d] focus-visible:outline-2 focus-visible:outline-[#e5b85c] disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
                  >
                    Decline
                  </button>
                </div>
              </div>
            )
          ) : (
            <span className="text-[#d6dde9]">{drawOffer.message}</span>
          )}
        </div>
      )}

      {/* Opponent Emote Speech Bubble */}
      {gameMode === 'online' && opponentEmote && (
        <div
          key={opponentEmote.id}
          role="status"
          aria-live="polite"
          className="fixed left-1/2 top-20 z-30 -translate-x-1/2 border border-[#c99b3b]/70 bg-[#121723]/95 px-4 py-2 text-xs text-[#f3ede0] shadow-2xl"
        >
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span
              className={`inline-block h-2.5 w-2.5 shrink-0 border border-white/35 ${
                opponentColor === 'w' ? 'bg-[#ede7db]' : 'bg-[#23262b]'
              }`}
              aria-hidden="true"
            />
            <span className="font-semibold text-[#f1dca7]">
              {opponentName}:
            </span>
            <span className="font-medium text-white">
              &ldquo;{opponentEmote.text}&rdquo;
            </span>
          </div>
          <span
            aria-hidden="true"
            className="absolute -bottom-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-[#c99b3b]/70 bg-[#121723]"
          />
        </div>
      )}

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

      {/* Right-side Match Clocks & Captured Pieces */}
      {!checkmateTitleVisible && (matchState.clocks.enabled || panelOpen) && (
        <div className="pointer-events-auto self-end mt-3 flex w-56 flex-col gap-2.5">
          {matchState.clocks.enabled && (
            <section
              aria-label="Chess Clocks"
              className="border border-white/10 bg-[#0d1018]/92 p-2.5 shadow-xl"
            >
              <div className="mb-2 flex items-center justify-between text-xs font-semibold tracking-wide text-[#9aa3b2]">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-[#c99b3b]" aria-hidden="true" />
                  Clocks
                </span>
                {isAnimating && !status.isGameOver && (
                  <span className="text-[11px] font-medium text-[#e5b85c]">
                    Paused
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                <ClockRow
                  color="b"
                  playerName={matchState.names.b}
                  remainingMs={matchState.clocks.remainingMs.b}
                  isActive={!status.isGameOver && status.turn === 'b'}
                />
                <ClockRow
                  color="w"
                  playerName={matchState.names.w}
                  remainingMs={matchState.clocks.remainingMs.w}
                  isActive={!status.isGameOver && status.turn === 'w'}
                />
              </div>
            </section>
          )}

          {panelOpen && (
            <aside
              aria-label="Captured pieces"
              className="border border-white/10 bg-[#0d1018]/92 px-3.5 py-1.5 shadow-xl"
            >
              <div className="border-b border-white/10 pb-1.5 pt-1 text-xs font-semibold tracking-wide text-[#9aa3b2]">
                Captured Pieces
              </div>

              <CapturedColorSection
                playerName={matchState.names.w}
                sideLabel="White"
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
                playerName={matchState.names.b}
                sideLabel="Black"
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
        </div>
      )}

      {/* Resign Confirmation Modal */}
      {resignConfirmOpen && !status.isGameOver && (
        <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-[#06080d]/75 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="resign-title"
            className="w-full max-w-sm border border-[#c99b3b]/40 bg-[#121620] p-6 text-center shadow-2xl"
          >
            <h2
              id="resign-title"
              className="font-display text-xl font-semibold text-[#f3ede0]"
            >
              Resign Match?
            </h2>
            <p className="mt-2 text-sm text-[#c6cdd9]">
              {resignerName} ({resigningColor === 'w' ? 'White' : 'Black'}) will
              forfeit the game. {formatWinnerPhrase(resignOpponentName)} by
              resignation.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setResignConfirmOpen(false);
                  onResignGame();
                }}
                className="cursor-pointer rounded bg-red-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-white whitespace-nowrap"
              >
                Confirm Resign
              </button>
              <button
                type="button"
                onClick={() => setResignConfirmOpen(false)}
                className="cursor-pointer rounded border border-white/15 bg-[#191f2d] px-5 py-2.5 text-sm font-medium text-[#d4dce8] transition-colors hover:bg-[#232b3d] focus-visible:outline-2 focus-visible:outline-[#e5b85c] whitespace-nowrap"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reconnecting Overlay (30s Retry Window) */}
      {gameMode === 'online' &&
        onlineStatus === 'reconnecting' &&
        !status.isGameOver && (
          <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-[#06080d]/72 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="reconnecting-title"
              className="w-full max-w-sm border border-amber-400/50 bg-[#121620] p-7 text-center shadow-2xl"
            >
              <div className="mx-auto flex h-10 w-10 items-center justify-center border border-amber-400/40 bg-amber-950/60 text-amber-200">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              </div>
              <h2
                id="reconnecting-title"
                className="font-display mt-3 text-xl font-semibold text-[#f3ede0]"
              >
                Reconnecting...
              </h2>
              <p className="mt-2 text-sm text-[#c6cdd9]">
                Connection dropped mid-game. Retrying for up to 30 seconds...
              </p>
              <button
                type="button"
                onClick={onReturnToMenu}
                className="mt-6 w-full cursor-pointer border border-white/20 bg-[#191f2d] px-5 py-2.5 text-sm font-medium text-[#e0e6f0] transition-colors hover:bg-[#232b3d] focus-visible:outline-2 focus-visible:outline-[#e5b85c]"
              >
                Back to Menu
              </button>
            </div>
          </div>
        )}

      {/* Opponent Disconnected Modal */}
      {gameMode === 'online' &&
        onlineStatus === 'disconnected' &&
        !status.isGameOver && (
          <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-[#06080d]/78 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="opponent-disconnected-title"
              className="w-full max-w-sm border border-red-400/45 bg-[#121620] p-7 text-center shadow-2xl"
            >
              <div className="mx-auto flex h-10 w-10 items-center justify-center border border-red-400/35 bg-red-950/60 text-red-200">
                <WifiOff className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2
                id="opponent-disconnected-title"
                className="font-display mt-3 text-xl font-semibold text-[#f3ede0]"
              >
                Opponent Disconnected
              </h2>
              <p className="mt-2 text-sm text-[#c6cdd9]">
                Your opponent lost connection or left the online match.
              </p>
              <button
                type="button"
                onClick={onReturnToMenu}
                className="mt-6 w-full cursor-pointer bg-[#c99b3b] px-5 py-2.5 text-sm font-semibold text-[#14110b] transition-colors hover:bg-[#dcae4c] focus-visible:outline-2 focus-visible:outline-white"
              >
                Back to Menu
              </button>
            </div>
          </div>
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
            className="max-w-lg"
          >
            <h2
              id="checkmate-title"
              className="font-display text-4xl font-semibold tracking-wider text-[#f3ede0] sm:text-5xl"
            >
              Checkmate
            </h2>
            <p className="mt-2.5 text-sm font-medium text-[#e5b85c]">
              {winnerName
                ? `${formatWinnerPhrase(winnerName)} by checkmate`
                : 'Checkmate'}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onRematchGame}
                disabled={
                  gameMode === 'online' &&
                  (onlineStatus !== 'connected' || isRematchPending)
                }
                title="Swap White and Black colors and play again"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded bg-[#c99b3b] px-6 py-2.5 text-sm font-semibold text-[#14110b] transition-colors hover:bg-[#dcae4c] focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
              >
                <Repeat2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {gameMode === 'online' && isRematchPending
                    ? 'Waiting for Host...'
                    : 'Rematch'}
                </span>
              </button>
              {gameMode !== 'online' && (
                <button
                  type="button"
                  onClick={onResetGame}
                  className="cursor-pointer rounded border border-[#c99b3b]/45 bg-[#1b1915] px-5 py-2.5 text-sm font-semibold text-[#f1dca7] transition-colors hover:bg-[#2a251c] hover:text-white focus-visible:outline-2 focus-visible:outline-[#e5b85c] whitespace-nowrap"
                >
                  New Game
                </button>
              )}
              <button
                type="button"
                onClick={onReturnToMenu}
                className="cursor-pointer rounded border border-white/20 bg-[#121620] px-5 py-2.5 text-sm font-medium text-[#e0e6f0] transition-colors hover:bg-[#1b2232] focus-visible:outline-2 focus-visible:outline-[#e5b85c] whitespace-nowrap"
              >
                {gameMode === 'online' ? 'Back to Menu' : 'Main Menu'}
              </button>
            </div>
            {gameMode === 'online' && onlineStatus !== 'disconnected' && (
              <div
                role="group"
                aria-label="Post-game Emotes"
                className="mt-4 flex flex-wrap items-center justify-center gap-1.5"
              >
                {ONLINE_EMOTES.map((emote) => (
                  <button
                    key={emote}
                    type="button"
                    onClick={() => onSendEmote(emote)}
                    disabled={onlineStatus !== 'connected' || isEmoteOnCooldown}
                    className="cursor-pointer rounded border border-white/15 bg-[#151a24] px-2.5 py-1 text-xs font-medium text-[#cfd6e3] transition-colors hover:border-[#c99b3b]/50 hover:bg-[#1e2534] hover:text-white focus-visible:outline-2 focus-visible:outline-[#e5b85c] disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
                  >
                    {emote}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Non-Checkmate Game Over Modal (Draw / Resignation / Time) */}
      {status.isGameOver && status.reason !== 'checkmate' && (
        <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-[#06080d]/75 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-over-title"
            className="w-full max-w-md border border-[#c99b3b]/40 bg-[#121620] p-7 text-center shadow-2xl"
          >
            <h2
              id="game-over-title"
              className="font-display text-2xl font-semibold text-[#f3ede0]"
            >
              Game Over
            </h2>
            <p className="mt-2 text-sm font-medium text-[#e5b85c]">
              {formatGameOverMessage(status, matchState.names)}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onRematchGame}
                disabled={
                  gameMode === 'online' &&
                  (onlineStatus !== 'connected' || isRematchPending)
                }
                title="Swap White and Black colors and play again"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded bg-[#c99b3b] px-5 py-2.5 text-sm font-semibold text-[#14110b] transition-colors hover:bg-[#dcae4c] focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
              >
                <Repeat2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {gameMode === 'online' && isRematchPending
                    ? 'Waiting for Host...'
                    : 'Rematch'}
                </span>
              </button>
              {gameMode !== 'online' && (
                <button
                  type="button"
                  onClick={onResetGame}
                  className="cursor-pointer rounded border border-[#c99b3b]/45 bg-[#1b1915] px-5 py-2.5 text-sm font-semibold text-[#f1dca7] transition-colors hover:bg-[#2a251c] hover:text-white focus-visible:outline-2 focus-visible:outline-[#e5b85c] whitespace-nowrap"
                >
                  New Game
                </button>
              )}
              <button
                type="button"
                onClick={onReturnToMenu}
                className="cursor-pointer rounded border border-white/15 bg-[#191f2d] px-4 py-2.5 text-sm font-medium text-[#d4dce8] transition-colors hover:bg-[#232b3d] focus-visible:outline-2 focus-visible:outline-[#e5b85c] whitespace-nowrap"
              >
                {gameMode === 'online' ? 'Back to Menu' : 'Menu'}
              </button>
            </div>
            {gameMode === 'online' && onlineStatus !== 'disconnected' && (
              <div
                role="group"
                aria-label="Post-game Emotes"
                className="mt-4 flex flex-wrap items-center justify-center gap-1.5 border-t border-white/10 pt-4"
              >
                {ONLINE_EMOTES.map((emote) => (
                  <button
                    key={emote}
                    type="button"
                    onClick={() => onSendEmote(emote)}
                    disabled={onlineStatus !== 'connected' || isEmoteOnCooldown}
                    className="cursor-pointer rounded border border-white/15 bg-[#151a24] px-2.5 py-1 text-xs font-medium text-[#cfd6e3] transition-colors hover:border-[#c99b3b]/50 hover:bg-[#1e2534] hover:text-white focus-visible:outline-2 focus-visible:outline-[#e5b85c] disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
                  >
                    {emote}
                  </button>
                ))}
              </div>
            )}
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

      {/* Online Emote Bar & Quiet Controls Footer */}
      {!checkmateTitleVisible && (
        <div className="mt-auto flex flex-col items-center gap-2">
          {gameMode === 'online' &&
            !status.isGameOver &&
            onlineStatus !== 'disconnected' && (
            <div
              role="group"
              aria-label="Quick Emotes"
              className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5 border border-white/10 bg-[#0d1018]/92 px-2.5 py-1.5 shadow-xl"
            >
              <MessageSquare
                className="h-3.5 w-3.5 shrink-0 text-[#c99b3b]"
                aria-hidden="true"
              />
              {ONLINE_EMOTES.map((emote) => (
                <button
                  key={emote}
                  type="button"
                  onClick={() => onSendEmote(emote)}
                  disabled={onlineStatus !== 'connected' || isEmoteOnCooldown}
                  className="cursor-pointer rounded border border-white/15 bg-[#151a24] px-2.5 py-1 text-xs font-medium text-[#cfd6e3] transition-colors hover:border-[#c99b3b]/50 hover:bg-[#1e2534] hover:text-white focus-visible:outline-2 focus-visible:outline-[#e5b85c] disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
                >
                  {emote}
                </button>
              ))}
            </div>
          )}

          <footer className="self-center border border-white/10 bg-[#0b0e16]/85 px-4 py-1.5 text-center text-xs text-[#9aa3b2]">
            Click a piece to select · Click a highlighted square to move
            {speechSupported ? ' · Voice commands supported' : ''} · Drag to orbit
            · Scroll to zoom
          </footer>
        </div>
      )}
    </div>
  );
}
