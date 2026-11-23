import Peer, { type DataConnection } from 'peerjs';
import type { Color } from 'chess.js';
import type { MatchStateSnapshot } from './chessTypes';

export const ROOM_PEER_PREFIX = 'stonebound-';
export const ROOM_CODE_LENGTH = 5;

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const VALID_ROOM_CODE_RE = /^[A-Z0-9]{5}$/;
const VALID_SQUARE_RE = /^[a-h][1-8]$/;
const VALID_PROMOTIONS = new Set(['q', 'r', 'b', 'n']);
const VALID_COLORS = new Set(['w', 'b']);
const VALID_CLOCK_MINUTES = new Set([0, 3, 5, 10]);
const VALID_CLOCK_INCREMENTS = new Set([0, 2, 5]);
const VALID_RESOLUTIONS = new Set(['resignation', 'draw_agreement', 'timeout']);

const JOIN_TIMEOUT_MS = 12_000;
const RECONNECT_TIMEOUT_MS = 30_000;
const RECONNECT_RETRY_MS = 2_500;
const ICE_DISCONNECT_GRACE_MS = 3_500;

export const ONLINE_EMOTES = [
  'Good move',
  'Hurry up',
  'GG',
  'Good game, rematch?',
] as const;

export type OnlineEmoteText = (typeof ONLINE_EMOTES)[number];
const VALID_EMOTES = new Set<string>(ONLINE_EMOTES);

export type OnlineRole = 'host' | 'guest';

export type OnlineConnectionStatus =
  | 'idle'
  | 'creating'
  | 'waiting'
  | 'joining'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export type OnlinePromotionCode = 'q' | 'r' | 'b' | 'n';

export interface ClockTimesPayload {
  w: number;
  b: number;
}

export type SyncableMatchAction =
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
    };

export type OnlineWireMessage =
  | {
      type: 'hello';
      name: string;
    }
  | {
      type: 'handshake';
      snapshot: MatchStateSnapshot;
    }
  | {
      type: 'move';
      from: string;
      to: string;
      promotion?: OnlinePromotionCode;
      remainingMs?: ClockTimesPayload;
    }
  | {
      type: 'clock_sync';
      remainingMs: ClockTimesPayload;
    }
  | {
      type: 'timeout';
      winner: Color;
      endedBy: Color;
    }
  | {
      type: 'match_action';
      action: SyncableMatchAction;
    }
  | {
      type: 'rematch_request';
    }
  | {
      type: 'rematch_sync';
      snapshot: MatchStateSnapshot;
    }
  | {
      type: 'state_sync';
      pgn: string;
      snapshot: MatchStateSnapshot;
    }
  | {
      type: 'emote';
      text: OnlineEmoteText;
    }
  | {
      type: 'leave';
    };

export interface OnlineSessionCallbacks {
  onStatusChange: (
    status: OnlineConnectionStatus,
    errorMessage?: string | null,
    isReconnect?: boolean
  ) => void;
  onRemoteMessage: (message: OnlineWireMessage) => void;
}

export function generateRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

export function normalizeRoomInput(raw: string): string {
  let trimmed = raw.trim();
  if (!trimmed) return '';

  const roomQueryMatch = trimmed.match(/[?&]room=([^&#]+)/i);
  if (roomQueryMatch?.[1]) {
    try {
      trimmed = decodeURIComponent(roomQueryMatch[1]).trim();
    } catch {
      trimmed = roomQueryMatch[1].trim();
    }
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith(ROOM_PEER_PREFIX)) {
    trimmed = trimmed.slice(ROOM_PEER_PREFIX.length);
  }

  return trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  return VALID_ROOM_CODE_RE.test(code);
}

export function sanitizeOnlinePlayerName(
  raw: string,
  fallback: string
): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, 20);
  return cleaned || fallback;
}

export function readRoomCodeFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('room');
  if (!raw) return null;
  const normalized = normalizeRoomInput(raw);
  return isValidRoomCode(normalized) ? normalized : null;
}

export function clearRoomCodeFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('room')) return;
  url.searchParams.delete('room');
  const nextSearch = url.searchParams.toString();
  const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`;
  window.history.replaceState(null, '', nextUrl);
}

export function buildInviteUrl(roomCode: string): string {
  if (typeof window === 'undefined') return `?room=${roomCode}`;
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomCode);
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidColorValue(value: unknown): value is Color {
  return typeof value === 'string' && VALID_COLORS.has(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isValidClockTimes(value: unknown): value is ClockTimesPayload {
  if (!isRecord(value)) return false;
  return isFiniteNonNegative(value.w) && isFiniteNonNegative(value.b);
}

export function isValidMatchSnapshot(
  raw: unknown
): raw is MatchStateSnapshot {
  if (!isRecord(raw)) return false;

  if (!isRecord(raw.names)) return false;
  if (
    typeof raw.names.w !== 'string' ||
    typeof raw.names.b !== 'string' ||
    raw.names.w.length > 40 ||
    raw.names.b.length > 40
  ) {
    return false;
  }

  if (!isValidColorValue(raw.humanColor)) return false;

  if (!isRecord(raw.clockConfig)) return false;
  if (
    typeof raw.clockConfig.initialMinutes !== 'number' ||
    !VALID_CLOCK_MINUTES.has(raw.clockConfig.initialMinutes) ||
    typeof raw.clockConfig.incrementSeconds !== 'number' ||
    !VALID_CLOCK_INCREMENTS.has(raw.clockConfig.incrementSeconds)
  ) {
    return false;
  }

  if (!isRecord(raw.clocks)) return false;
  if (
    typeof raw.clocks.enabled !== 'boolean' ||
    !isFiniteNonNegative(raw.clocks.initialMs) ||
    !isFiniteNonNegative(raw.clocks.incrementMs) ||
    !isValidClockTimes(raw.clocks.remainingMs)
  ) {
    return false;
  }

  if (raw.resignedBy !== null && !isValidColorValue(raw.resignedBy)) {
    return false;
  }

  if (raw.drawOffer !== null) {
    if (!isRecord(raw.drawOffer)) return false;
    if (!isValidColorValue(raw.drawOffer.offeredBy)) return false;
    if (
      raw.drawOffer.status !== 'pending' &&
      raw.drawOffer.status !== 'declined'
    ) {
      return false;
    }
    if (
      raw.drawOffer.message !== undefined &&
      (typeof raw.drawOffer.message !== 'string' ||
        raw.drawOffer.message.length > 120)
    ) {
      return false;
    }
  }

  if (raw.resolution !== null) {
    if (!isRecord(raw.resolution)) return false;
    if (
      raw.resolution.winner !== null &&
      !isValidColorValue(raw.resolution.winner)
    ) {
      return false;
    }
    if (
      typeof raw.resolution.reason !== 'string' ||
      !VALID_RESOLUTIONS.has(raw.resolution.reason)
    ) {
      return false;
    }
    if (
      raw.resolution.endedBy !== undefined &&
      !isValidColorValue(raw.resolution.endedBy)
    ) {
      return false;
    }
  }

  return true;
}

function parseSyncableMatchAction(raw: unknown): SyncableMatchAction | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;

  switch (raw.type) {
    case 'RESIGN': {
      if (!isValidColorValue(raw.by)) return null;
      return { type: 'RESIGN', by: raw.by };
    }
    case 'SET_DRAW_OFFER': {
      if (!isValidColorValue(raw.offeredBy)) return null;
      if (raw.status !== 'pending' && raw.status !== 'declined') return null;
      if (
        raw.message !== undefined &&
        (typeof raw.message !== 'string' || raw.message.length > 120)
      ) {
        return null;
      }
      return {
        type: 'SET_DRAW_OFFER',
        offeredBy: raw.offeredBy,
        status: raw.status,
        ...(raw.message !== undefined ? { message: raw.message } : {}),
      };
    }
    case 'RESPOND_DRAW': {
      if (
        typeof raw.accept !== 'boolean' ||
        typeof raw.responderName !== 'string' ||
        raw.responderName.length > 40
      ) {
        return null;
      }
      return {
        type: 'RESPOND_DRAW',
        accept: raw.accept,
        responderName: raw.responderName,
      };
    }
    default:
      return null;
  }
}

export function parseOnlineWireMessage(raw: unknown): OnlineWireMessage | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;

  switch (raw.type) {
    case 'hello': {
      if (typeof raw.name !== 'string' || raw.name.length > 40) return null;
      return {
        type: 'hello',
        name: sanitizeOnlinePlayerName(raw.name, 'Black'),
      };
    }
    case 'handshake': {
      if (!isValidMatchSnapshot(raw.snapshot)) return null;
      return { type: 'handshake', snapshot: raw.snapshot };
    }
    case 'move': {
      if (typeof raw.from !== 'string' || typeof raw.to !== 'string') {
        return null;
      }
      if (!VALID_SQUARE_RE.test(raw.from) || !VALID_SQUARE_RE.test(raw.to)) {
        return null;
      }
      let promotion: OnlinePromotionCode | undefined;
      if (raw.promotion !== undefined) {
        if (
          typeof raw.promotion !== 'string' ||
          !VALID_PROMOTIONS.has(raw.promotion)
        ) {
          return null;
        }
        promotion = raw.promotion as OnlinePromotionCode;
      }
      let remainingMs: ClockTimesPayload | undefined;
      if (raw.remainingMs !== undefined) {
        if (!isValidClockTimes(raw.remainingMs)) return null;
        remainingMs = {
          w: raw.remainingMs.w,
          b: raw.remainingMs.b,
        };
      }
      return {
        type: 'move',
        from: raw.from,
        to: raw.to,
        ...(promotion ? { promotion } : {}),
        ...(remainingMs ? { remainingMs } : {}),
      };
    }
    case 'clock_sync': {
      if (!isValidClockTimes(raw.remainingMs)) return null;
      return {
        type: 'clock_sync',
        remainingMs: {
          w: raw.remainingMs.w,
          b: raw.remainingMs.b,
        },
      };
    }
    case 'timeout': {
      if (!isValidColorValue(raw.winner) || !isValidColorValue(raw.endedBy)) {
        return null;
      }
      return {
        type: 'timeout',
        winner: raw.winner,
        endedBy: raw.endedBy,
      };
    }
    case 'match_action': {
      const action = parseSyncableMatchAction(raw.action);
      if (!action) return null;
      return { type: 'match_action', action };
    }
    case 'rematch_request': {
      return { type: 'rematch_request' };
    }
    case 'rematch_sync': {
      if (!isValidMatchSnapshot(raw.snapshot)) return null;
      return { type: 'rematch_sync', snapshot: raw.snapshot };
    }
    case 'state_sync': {
      if (
        typeof raw.pgn !== 'string' ||
        raw.pgn.length > 60_000 ||
        !isValidMatchSnapshot(raw.snapshot)
      ) {
        return null;
      }
      return {
        type: 'state_sync',
        pgn: raw.pgn,
        snapshot: raw.snapshot,
      };
    }
    case 'emote': {
      if (typeof raw.text !== 'string' || !VALID_EMOTES.has(raw.text)) {
        return null;
      }
      return {
        type: 'emote',
        text: raw.text as OnlineEmoteText,
      };
    }
    case 'leave': {
      return { type: 'leave' };
    }
    default:
      return null;
  }
}

function mapPeerErrorMessage(err: unknown, role: OnlineRole): string {
  const errType =
    err && typeof err === 'object' && 'type' in err
      ? String((err as { type?: unknown }).type ?? '')
      : '';

  switch (errType) {
    case 'peer-unavailable':
      return 'Room not found. Verify the 5-character code and make sure the host is waiting.';
    case 'unavailable-id':
      return 'That room code is currently in use. Please try creating a new code.';
    case 'browser-incompatible':
      return 'Your browser does not support WebRTC peer-to-peer connections.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Unable to reach the matchmaking signaling server. Check your connection and try again.';
    case 'webrtc':
      return role === 'host'
        ? 'Failed to establish peer-to-peer connection with opponent.'
        : 'Failed to connect to the host over WebRTC.';
    default:
      return role === 'host'
        ? 'Online room encountered a connection error.'
        : 'Could not join the online room.';
  }
}

export class OnlinePeerSession {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private status: OnlineConnectionStatus = 'idle';
  private roomCode = '';
  private hasEverConnected = false;
  private remoteLeftIntentionally = false;
  private destroyed = false;

  private joinTimer: number | null = null;
  private reconnectDeadlineTimer: number | null = null;
  private reconnectRetryTimer: number | null = null;
  private iceGraceTimer: number | null = null;
  private iceListenerTarget: RTCPeerConnection | null = null;
  private iceListenerFn: (() => void) | null = null;

  private readonly role: OnlineRole;
  private readonly callbacks: OnlineSessionCallbacks;

  constructor(role: OnlineRole, callbacks: OnlineSessionCallbacks) {
    this.role = role;
    this.callbacks = callbacks;
  }

  getStatus(): OnlineConnectionStatus {
    return this.status;
  }

  private updateStatus(
    next: OnlineConnectionStatus,
    errorMessage: string | null = null,
    isReconnect = false
  ): void {
    if (this.destroyed) return;
    if (this.status === next && !errorMessage && !isReconnect) return;
    this.status = next;
    this.callbacks.onStatusChange(next, errorMessage, isReconnect);
  }

  private clearJoinTimer(): void {
    if (this.joinTimer !== null) {
      window.clearTimeout(this.joinTimer);
      this.joinTimer = null;
    }
  }

  private clearReconnectTimers(): void {
    if (this.reconnectDeadlineTimer !== null) {
      window.clearTimeout(this.reconnectDeadlineTimer);
      this.reconnectDeadlineTimer = null;
    }
    if (this.reconnectRetryTimer !== null) {
      window.clearInterval(this.reconnectRetryTimer);
      this.reconnectRetryTimer = null;
    }
  }

  private clearIceGraceTimer(): void {
    if (this.iceGraceTimer !== null) {
      window.clearTimeout(this.iceGraceTimer);
      this.iceGraceTimer = null;
    }
  }

  private clearAllTimers(): void {
    this.clearJoinTimer();
    this.clearReconnectTimers();
    this.clearIceGraceTimer();
  }

  private detachIceListener(): void {
    this.clearIceGraceTimer();
    if (this.iceListenerTarget && this.iceListenerFn) {
      this.iceListenerTarget.removeEventListener(
        'iceconnectionstatechange',
        this.iceListenerFn
      );
    }
    this.iceListenerTarget = null;
    this.iceListenerFn = null;
  }

  private isExistingConnectionHealthy(): boolean {
    if (!this.conn || !this.conn.open) return false;
    const iceState = this.conn.peerConnection?.iceConnectionState;
    if (
      iceState === 'disconnected' ||
      iceState === 'failed' ||
      iceState === 'closed'
    ) {
      return false;
    }
    return true;
  }

  private initHostPeer(): void {
    if (this.destroyed || !this.roomCode) return;
    const peerId = `${ROOM_PEER_PREFIX}${this.roomCode}`;
    const peer = new Peer(peerId);
    this.peer = peer;

    peer.on('open', () => {
      if (this.destroyed || this.peer !== peer) return;
      if (!this.hasEverConnected && this.status !== 'reconnecting') {
        this.updateStatus('waiting');
      }
    });

    peer.on('connection', (incoming) => {
      if (this.destroyed || this.peer !== peer) {
        try {
          incoming.close();
        } catch {
          // Ignore close errors
        }
        return;
      }

      if (this.conn && this.isExistingConnectionHealthy()) {
        try {
          incoming.close();
        } catch {
          // Ignore close errors
        }
        return;
      }

      // Close stale half-open connection before attaching the fresh one
      if (this.conn) {
        this.detachIceListener();
        try {
          this.conn.close();
        } catch {
          // Ignore close errors
        }
        this.conn = null;
      }

      this.attachConnection(incoming);
    });

    peer.on('disconnected', () => {
      if (this.destroyed || this.peer !== peer) return;
      if (
        this.status === 'creating' ||
        this.status === 'waiting' ||
        this.status === 'reconnecting'
      ) {
        try {
          peer.reconnect();
        } catch {
          if (!this.hasEverConnected) {
            this.updateStatus(
              'error',
              'Lost connection to the matchmaking server.'
            );
          }
        }
      }
    });

    peer.on('error', (err) => {
      if (this.destroyed || this.peer !== peer) return;
      if (this.status === 'reconnecting') {
        // Keep retrying within the 30-second reconnect window
        return;
      }
      if (this.status === 'connected') {
        this.handleConnectionLost();
      } else {
        this.clearAllTimers();
        this.updateStatus('error', mapPeerErrorMessage(err, 'host'));
      }
    });
  }

  hostRoom(roomCode: string): void {
    if (this.destroyed) return;
    this.roomCode = roomCode;
    this.updateStatus('creating');
    this.initHostPeer();
  }

  private initGuestPeerAndDial(): void {
    if (this.destroyed || !this.roomCode) return;
    const peer = new Peer();
    this.peer = peer;

    peer.on('open', () => {
      if (this.destroyed || this.peer !== peer) return;
      if (this.status !== 'joining' && this.status !== 'reconnecting') return;
      const targetId = `${ROOM_PEER_PREFIX}${this.roomCode}`;
      const conn = peer.connect(targetId, {
        reliable: true,
        serialization: 'json',
      });
      this.attachConnection(conn);
    });

    peer.on('error', (err) => {
      if (this.destroyed || this.peer !== peer) return;
      if (this.status === 'reconnecting') {
        // Keep retrying until the 30-second reconnect window expires
        return;
      }
      this.clearJoinTimer();
      if (this.status === 'connected') {
        this.handleConnectionLost();
      } else {
        this.updateStatus('error', mapPeerErrorMessage(err, 'guest'));
      }
    });
  }

  joinRoom(rawCode: string): void {
    if (this.destroyed) return;
    const roomCode = normalizeRoomInput(rawCode);
    if (!isValidRoomCode(roomCode)) {
      this.updateStatus('error', 'Enter a valid 5-character room code.');
      return;
    }

    this.roomCode = roomCode;
    this.updateStatus('joining');

    this.joinTimer = window.setTimeout(() => {
      if (this.destroyed || this.status === 'connected') return;
      this.updateStatus(
        'error',
        'Timed out waiting for the host. Check the room code and try again.'
      );
      this.cleanupConnectionsOnly();
    }, JOIN_TIMEOUT_MS);

    this.initGuestPeerAndDial();
  }

  private attachConnection(conn: DataConnection): void {
    this.conn = conn;

    const markConnected = () => {
      if (this.destroyed || this.conn !== conn) return;
      const wasReconnect = this.hasEverConnected;
      this.hasEverConnected = true;
      this.clearJoinTimer();
      this.clearReconnectTimers();
      this.attachIceMonitoring(conn);
      this.updateStatus('connected', null, wasReconnect);
    };

    if (conn.open) {
      markConnected();
    } else {
      conn.on('open', markConnected);
    }

    conn.on('data', (raw) => {
      if (this.destroyed || this.conn !== conn) return;
      const msg = parseOnlineWireMessage(raw);
      if (!msg) return;

      if (msg.type === 'leave') {
        this.remoteLeftIntentionally = true;
        this.clearAllTimers();
        this.detachIceListener();
        this.cleanupConnectionsOnly();
        this.updateStatus('disconnected', 'Opponent left the match.');
        return;
      }

      this.callbacks.onRemoteMessage(msg);
    });

    conn.on('close', () => {
      if (this.destroyed || this.conn !== conn) return;
      this.handleConnectionLost();
    });

    conn.on('error', () => {
      if (this.destroyed || this.conn !== conn) return;
      this.handleConnectionLost();
    });
  }

  private attachIceMonitoring(conn: DataConnection): void {
    this.detachIceListener();
    const pc = conn.peerConnection;
    if (!pc) return;

    const onIceStateChange = () => {
      if (this.destroyed || this.conn !== conn) return;
      const state = pc.iceConnectionState;

      if (state === 'connected' || state === 'completed') {
        this.clearIceGraceTimer();
        return;
      }

      if (state === 'failed' || state === 'closed') {
        this.handleConnectionLost();
        return;
      }

      if (state === 'disconnected' && this.iceGraceTimer === null) {
        this.iceGraceTimer = window.setTimeout(() => {
          this.iceGraceTimer = null;
          if (this.destroyed || this.conn !== conn) return;
          if (
            pc.iceConnectionState === 'disconnected' ||
            pc.iceConnectionState === 'failed' ||
            pc.iceConnectionState === 'closed'
          ) {
            this.handleConnectionLost();
          }
        }, ICE_DISCONNECT_GRACE_MS);
      }
    };

    this.iceListenerTarget = pc;
    this.iceListenerFn = onIceStateChange;
    pc.addEventListener('iceconnectionstatechange', onIceStateChange);
  }

  private attemptReconnectStep(): void {
    if (this.destroyed || this.status !== 'reconnecting') return;

    if (this.role === 'host') {
      if (!this.peer || this.peer.destroyed) {
        this.initHostPeer();
        return;
      }
      if (this.peer.disconnected) {
        try {
          this.peer.reconnect();
        } catch {
          // Ignore and retry on next interval
        }
      }
      return;
    }

    // Guest: clean up dead conn and dial host again
    if (this.conn) {
      this.detachIceListener();
      try {
        this.conn.close();
      } catch {
        // Ignore close errors
      }
      this.conn = null;
    }

    if (!this.peer || this.peer.destroyed) {
      this.initGuestPeerAndDial();
      return;
    }

    if (this.peer.disconnected) {
      try {
        this.peer.reconnect();
      } catch {
        try {
          this.peer.destroy();
        } catch {
          // Ignore
        }
        this.peer = null;
        this.initGuestPeerAndDial();
      }
      return;
    }

    if (this.peer.open) {
      const targetId = `${ROOM_PEER_PREFIX}${this.roomCode}`;
      const conn = this.peer.connect(targetId, {
        reliable: true,
        serialization: 'json',
      });
      this.attachConnection(conn);
    }
  }

  private beginReconnecting(): void {
    if (this.destroyed || this.status === 'reconnecting') return;

    this.detachIceListener();
    if (this.conn) {
      try {
        this.conn.close();
      } catch {
        // Ignore
      }
      this.conn = null;
    }

    this.updateStatus('reconnecting', 'Connection lost. Reconnecting...');

    this.reconnectDeadlineTimer = window.setTimeout(() => {
      if (this.destroyed || this.status !== 'reconnecting') return;
      this.clearReconnectTimers();
      this.cleanupConnectionsOnly();
      this.updateStatus(
        'disconnected',
        'Connection lost. Could not reconnect within 30 seconds.'
      );
    }, RECONNECT_TIMEOUT_MS);

    this.attemptReconnectStep();
    this.reconnectRetryTimer = window.setInterval(() => {
      this.attemptReconnectStep();
    }, RECONNECT_RETRY_MS);
  }

  private handleConnectionLost(): void {
    if (this.destroyed) return;
    this.clearJoinTimer();
    this.detachIceListener();

    if (this.remoteLeftIntentionally) {
      this.clearAllTimers();
      this.cleanupConnectionsOnly();
      this.updateStatus('disconnected', 'Opponent left the match.');
      return;
    }

    if (this.hasEverConnected) {
      if (this.status === 'connected') {
        this.beginReconnecting();
      }
      return;
    }

    if (this.status === 'joining') {
      this.updateStatus(
        'error',
        'Could not connect to the room. It may have closed.'
      );
    }
  }

  sendMessage(msg: OnlineWireMessage): boolean {
    if (this.destroyed || !this.conn || !this.conn.open) {
      return false;
    }
    try {
      this.conn.send(msg);
      return true;
    } catch {
      return false;
    }
  }

  sendLeaveAndDestroy(): void {
    if (this.destroyed) return;
    this.sendMessage({ type: 'leave' });
    this.destroy();
  }

  private cleanupConnectionsOnly(): void {
    this.clearAllTimers();
    this.detachIceListener();
    if (this.conn) {
      try {
        this.conn.close();
      } catch {
        // Ignore close errors
      }
      this.conn = null;
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // Ignore destroy errors
      }
      this.peer = null;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cleanupConnectionsOnly();
  }
}
