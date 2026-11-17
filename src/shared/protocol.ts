import type { Action, PlayerView } from '../engine/types';

export const MIN_ROOM_PLAYERS = 3;
export const MAX_ROOM_PLAYERS = 7;
export const DEFAULT_ROOM_CAPACITY = 7;
export const MAX_NAME_LENGTH = 20;

export type RoomPhase = 'lobby' | 'playing' | 'finished';

export interface MemberInfo {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  /** Has a seat in the current match. */
  seated: boolean;
}

/** Sent to each browser individually; `game` is that viewer's redacted view. */
export interface RoomSnapshot {
  code: string;
  capacity: number;
  phase: RoomPhase;
  hostId: string | null;
  inviteUrl: string;
  matchNumber: number;
  you: { playerId: string; name: string; isHost: boolean; seated: boolean };
  members: MemberInfo[];
  game: PlayerView | null;
  /** Epoch ms (server clock) when the current turn times out. */
  turnEndsAt: number | null;
  /** Epoch ms (server clock) when the next hand starts automatically. */
  nextHandAt: number | null;
  /** Server clock at send time, so clients can correct for clock skew. */
  serverNow: number;
  turnSeconds: number;
}

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface JoinSuccess {
  code: string;
  playerId: string;
  /** Private reconnect token. Keep it secret; it is not the room code. */
  token: string;
  reclaimed: boolean;
}

export interface ClientToServerEvents {
  'room:create': (p: { name: string; capacity: number }, ack: (r: Ack<JoinSuccess>) => void) => void;
  'room:join': (p: { code: string; name?: string; token?: string }, ack: (r: Ack<JoinSuccess>) => void) => void;
  'room:start': (ack: (r: Ack) => void) => void;
  'room:leave': (ack: (r: Ack) => void) => void;
  'room:backToLobby': (ack: (r: Ack) => void) => void;
  'game:action': (p: { seq: number; action: Action }, ack: (r: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (s: RoomSnapshot) => void;
  'room:notice': (n: { message: string }) => void;
}

export function isValidRoomCode(code: unknown): code is string {
  return typeof code === 'string' && /^\d{6}$/.test(code);
}

export function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const n = name.replace(/\s+/g, ' ').trim();
  if (!n || n.length > MAX_NAME_LENGTH) return null;
  return n;
}
