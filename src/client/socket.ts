import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '../shared/protocol';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: ClientSocket | null = null;

/** One Socket.IO connection to the same origin that served the page. */
export function getSocket(): ClientSocket {
  if (!socket) {
    socket = io({ transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 3000 });
  }
  return socket;
}

export function request<T = object>(emit: (cb: (r: Ack<T>) => void) => void, timeoutMs = 8000): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: 'The server did not respond. Check your connection.' }), timeoutMs);
    emit((r) => {
      clearTimeout(t);
      resolve(r);
    });
  });
}

// ------------------------------------------------------------ seat storage
//
// The reconnect token is kept in sessionStorage (per tab, survives refresh) and in
// localStorage (survives closing the browser). A tab with its own session copy rejoins
// automatically; another tab only offers a "Rejoin" button, so you can still open a
// second tab and join as a different player when testing on one computer.

export interface StoredSeat {
  playerId: string;
  token: string;
  name: string;
}

const seatKey = (code: string) => `poker:room:${code}`;

function read(store: Storage | undefined, code: string): StoredSeat | null {
  try {
    const raw = store?.getItem(seatKey(code));
    return raw ? (JSON.parse(raw) as StoredSeat) : null;
  } catch {
    return null;
  }
}

export function loadSeat(code: string): { seat: StoredSeat; thisTab: boolean } | null {
  const tab = read(globalThis.sessionStorage, code);
  if (tab) return { seat: tab, thisTab: true };
  const saved = read(globalThis.localStorage, code);
  return saved ? { seat: saved, thisTab: false } : null;
}

export function saveSeat(code: string, seat: StoredSeat) {
  for (const store of [globalThis.sessionStorage, globalThis.localStorage]) {
    try {
      store.setItem(seatKey(code), JSON.stringify(seat));
    } catch {
      /* storage unavailable: reconnecting after a refresh will not work */
    }
  }
}

export function forgetSeat(code: string) {
  for (const store of [globalThis.sessionStorage, globalThis.localStorage]) {
    try {
      store.removeItem(seatKey(code));
    } catch {
      /* ignore */
    }
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem('poker:name') ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem('poker:name', name);
  } catch {
    /* ignore */
  }
}
