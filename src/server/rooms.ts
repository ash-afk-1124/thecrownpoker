import { randomBytes, randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  type Action, type GameState, applyAction, applyTimeout, createGame, getPlayerView, IllegalActionError,
  startHand,
} from '../engine';
import {
  type Ack, type ClientToServerEvents, type JoinSuccess, type MemberInfo, type RoomPhase,
  type RoomSnapshot, type ServerToClientEvents, cleanName, DEFAULT_ROOM_CAPACITY, isValidRoomCode,
  MAX_ROOM_PLAYERS, MIN_ROOM_PLAYERS,
} from '../shared/protocol';

export type PokerServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
export type PokerSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
export interface SocketData {
  code?: string;
  memberId?: string;
}

export interface RoomOptions {
  turnMs: number;
  nextHandMs: number;
  /** How long a disconnected player keeps their lobby spot before it is freed. */
  lobbyGraceMs: number;
  /** Rooms with nobody connected are deleted after this long. */
  idleRoomMs: number;
}

interface Member {
  id: string;
  name: string;
  token: string;
  sockets: Set<string>;
  joinedAt: number;
  removeTimer: NodeJS.Timeout | null;
}

const ALLOWED_ACTIONS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'allin']);

class Room {
  members: Member[] = [];
  hostId: string | null = null;
  phase: RoomPhase = 'lobby';
  game: GameState | null = null;
  seated = new Set<string>();
  matchNumber = 0;
  turnEndsAt: number | null = null;
  nextHandAt: number | null = null;
  lastActivity = Date.now();
  private turnTimer: NodeJS.Timeout | null = null;
  private turnKey = '';
  private nextHandTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly code: string,
    readonly capacity: number,
    readonly inviteUrl: string,
    private readonly io: PokerServer,
    private readonly opts: RoomOptions,
  ) {}

  member(id: string | undefined) {
    return this.members.find((m) => m.id === id);
  }

  connected(m: Member) {
    return m.sockets.size > 0;
  }

  hasConnectedMembers() {
    return this.members.some((m) => this.connected(m));
  }

  addMember(name: string): Member {
    const m: Member = {
      id: 'p_' + randomBytes(6).toString('hex'),
      name,
      token: randomBytes(24).toString('base64url'),
      sockets: new Set(),
      joinedAt: Date.now(),
      removeTimer: null,
    };
    this.members.push(m);
    if (!this.hostId) this.hostId = m.id;
    return m;
  }

  attach(m: Member, socket: PokerSocket) {
    if (m.removeTimer) clearTimeout(m.removeTimer);
    m.removeTimer = null;
    m.sockets.add(socket.id);
    socket.data.code = this.code;
    socket.data.memberId = m.id;
    socket.join(this.code);
    const host = this.member(this.hostId ?? undefined);
    if (!host || !this.connected(host)) this.hostId = m.id;
    this.touch();
  }

  detach(socketId: string) {
    const m = this.members.find((x) => x.sockets.has(socketId));
    if (!m) return;
    m.sockets.delete(socketId);
    if (this.connected(m)) return;
    if (this.hostId === m.id) this.transferHost();
    // Free lobby spots held by players who went away (never seats in a running match).
    if (m.removeTimer) clearTimeout(m.removeTimer);
    if (this.phase !== 'playing' || !this.seated.has(m.id)) {
      m.removeTimer = setTimeout(() => {
        if (!this.connected(m) && (this.phase !== 'playing' || !this.seated.has(m.id))) {
          this.removeMember(m.id);
          this.broadcast();
        }
      }, this.opts.lobbyGraceMs);
    }
    this.broadcast();
  }

  removeMember(id: string) {
    const m = this.member(id);
    if (!m) return;
    if (m.removeTimer) clearTimeout(m.removeTimer);
    this.members = this.members.filter((x) => x.id !== id);
    if (this.hostId === id) this.transferHost();
  }

  transferHost() {
    const next = this.members.find((m) => m.id !== this.hostId && this.connected(m));
    if (next) this.hostId = next.id;
    else if (!this.member(this.hostId ?? undefined)) this.hostId = this.members[0]?.id ?? null;
  }

  touch() {
    this.lastActivity = Date.now();
  }

  // ---------------------------------------------------------------- match control

  start(memberId: string): Ack {
    if (memberId !== this.hostId) return { ok: false, error: 'Only the host can start the match' };
    if (this.phase === 'playing') return { ok: false, error: 'The match has already started' };
    const players = this.members.filter((m) => this.connected(m)).slice(0, MAX_ROOM_PLAYERS);
    if (players.length < MIN_ROOM_PLAYERS) {
      return { ok: false, error: `At least ${MIN_ROOM_PLAYERS} connected players are needed to start` };
    }
    this.seated = new Set(players.map((m) => m.id));
    this.game = createGame(players.map((m) => ({ id: m.id, name: m.name })));
    this.phase = 'playing';
    this.matchNumber += 1;
    this.game = startHand(this.game);
    this.afterChange();
    return { ok: true };
  }

  backToLobby(memberId: string): Ack {
    if (memberId !== this.hostId) return { ok: false, error: 'Only the host can do that' };
    if (this.phase !== 'finished') return { ok: false, error: 'The match is still running' };
    this.phase = 'lobby';
    this.seated.clear();
    this.game = null;
    // Players who left during the match free their spot now.
    for (const m of [...this.members]) if (!this.connected(m)) this.removeMember(m.id);
    this.broadcast();
    return { ok: true };
  }

  act(memberId: string, payload: unknown): Ack {
    const g = this.game;
    if (this.phase !== 'playing' || !g) return { ok: false, error: 'No hand in progress' };
    if (!this.seated.has(memberId)) return { ok: false, error: 'You are not seated in this match' };
    const p = payload as { seq?: unknown; action?: Action } | null;
    if (!p || typeof p.seq !== 'number' || !p.action || !ALLOWED_ACTIONS.has(p.action.type)) {
      return { ok: false, error: 'Malformed action' };
    }
    if (g.phase !== 'betting' || g.toAct === null || g.players[g.toAct].id !== memberId) {
      return { ok: false, error: 'It is not your turn' };
    }
    if (p.seq !== g.actionSeq) return { ok: false, error: 'Duplicate or out-of-date action ignored' };
    const action: Action = { type: p.action.type };
    if (p.action.amount !== undefined) {
      if (typeof p.action.amount !== 'number') return { ok: false, error: 'Amount must be a number' };
      action.amount = p.action.amount;
    }
    try {
      this.game = applyAction(g, memberId, action);
    } catch (e) {
      if (e instanceof IllegalActionError) return { ok: false, error: e.message };
      throw e;
    }
    this.touch();
    this.afterChange();
    return { ok: true };
  }

  private afterChange() {
    const g = this.game;
    if (!g) return;
    if (g.phase === 'betting') {
      const key = `${g.handNumber}:${g.actionSeq}`;
      if (key !== this.turnKey) {
        this.turnKey = key;
        this.clearTurnTimer();
        this.turnEndsAt = Date.now() + this.opts.turnMs;
        this.turnTimer = setTimeout(() => this.onTimeout(key), this.opts.turnMs);
      }
      this.nextHandAt = null;
    } else {
      this.clearTurnTimer();
      if (g.phase === 'handComplete') {
        this.nextHandAt = Date.now() + this.opts.nextHandMs;
        if (this.nextHandTimer) clearTimeout(this.nextHandTimer);
        this.nextHandTimer = setTimeout(() => {
          this.nextHandTimer = null;
          if (this.game?.phase !== 'handComplete') return;
          this.game = startHand(this.game);
          this.afterChange();
        }, this.opts.nextHandMs);
      } else if (g.phase === 'gameOver') {
        this.phase = 'finished';
        this.nextHandAt = null;
      }
    }
    this.broadcast();
  }

  private onTimeout(key: string) {
    const g = this.game;
    if (!g || g.phase !== 'betting' || `${g.handNumber}:${g.actionSeq}` !== key) return;
    this.game = applyTimeout(g);
    this.afterChange();
  }

  private clearTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnEndsAt = null;
  }

  dispose() {
    this.clearTurnTimer();
    if (this.nextHandTimer) clearTimeout(this.nextHandTimer);
    for (const m of this.members) if (m.removeTimer) clearTimeout(m.removeTimer);
  }

  // ---------------------------------------------------------------- broadcasting

  snapshotFor(m: Member): RoomSnapshot {
    const members: MemberInfo[] = this.members.map((x) => ({
      id: x.id, name: x.name, connected: this.connected(x), isHost: x.id === this.hostId, seated: this.seated.has(x.id),
    }));
    return {
      code: this.code,
      capacity: this.capacity,
      phase: this.phase,
      hostId: this.hostId,
      inviteUrl: this.inviteUrl,
      matchNumber: this.matchNumber,
      you: { playerId: m.id, name: m.name, isHost: m.id === this.hostId, seated: this.seated.has(m.id) },
      members,
      // Each viewer gets a view built for them alone: only their own hole cards.
      game: this.game ? getPlayerView(this.game, this.seated.has(m.id) ? m.id : null, 100) : null,
      turnEndsAt: this.turnEndsAt,
      nextHandAt: this.nextHandAt,
      serverNow: Date.now(),
      turnSeconds: Math.round(this.opts.turnMs / 1000),
    };
  }

  broadcast() {
    for (const m of this.members) {
      if (!m.sockets.size) continue;
      const snap = this.snapshotFor(m);
      for (const sid of m.sockets) this.io.to(sid).emit('room:state', snap);
    }
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private sweeper: NodeJS.Timeout;

  constructor(
    private readonly io: PokerServer,
    private readonly opts: RoomOptions,
    private readonly publicUrl: (socket: PokerSocket) => string,
  ) {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
    io.on('connection', (socket) => this.onConnection(socket));
  }

  private newCode(): string {
    for (let i = 0; i < 1000; i++) {
      const code = String(randomInt(100000, 1000000));
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('No room codes available');
  }

  private sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (!room.hasConnectedMembers() && now - room.lastActivity > this.opts.idleRoomMs) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }

  close() {
    clearInterval(this.sweeper);
    for (const r of this.rooms.values()) r.dispose();
    this.rooms.clear();
  }

  private currentRoom(socket: PokerSocket) {
    const room = socket.data.code ? this.rooms.get(socket.data.code) : undefined;
    const member = room?.member(socket.data.memberId);
    return room && member ? { room, member } : null;
  }

  private leaveCurrent(socket: PokerSocket) {
    const cur = this.currentRoom(socket);
    if (!cur) return;
    socket.leave(cur.room.code);
    cur.room.detach(socket.id);
    socket.data.code = undefined;
    socket.data.memberId = undefined;
  }

  private onConnection(socket: PokerSocket) {
    const safe = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => {
      try {
        fn(...args);
      } catch (err) {
        console.error('Socket handler error', err);
        const ack = args[args.length - 1];
        if (typeof ack === 'function') ack({ ok: false, error: 'Server error' });
      }
    };
    const isFn = (f: unknown): f is (r: unknown) => void => typeof f === 'function';

    socket.on('room:create', safe((p, ack) => {
      if (!isFn(ack)) return;
      const name = cleanName(p?.name);
      if (!name) return ack({ ok: false, error: 'Enter a display name (1–20 characters)' });
      const capacity = Number.isInteger(p?.capacity) ? p.capacity : DEFAULT_ROOM_CAPACITY;
      if (capacity < MIN_ROOM_PLAYERS || capacity > MAX_ROOM_PLAYERS) {
        return ack({ ok: false, error: `Capacity must be between ${MIN_ROOM_PLAYERS} and ${MAX_ROOM_PLAYERS}` });
      }
      this.leaveCurrent(socket);
      const code = this.newCode();
      const room = new Room(code, capacity, `${this.publicUrl(socket)}/room/${code}`, this.io, this.opts);
      this.rooms.set(code, room);
      const m = room.addMember(name);
      room.attach(m, socket);
      ack({ ok: true, code, playerId: m.id, token: m.token, reclaimed: false } satisfies Ack<JoinSuccess>);
      room.broadcast();
    }));

    socket.on('room:join', safe((p, ack) => {
      if (!isFn(ack)) return;
      const code = typeof p?.code === 'string' ? p.code.trim() : '';
      if (!isValidRoomCode(code)) return ack({ ok: false, error: 'Room codes are six digits' });
      const room = this.rooms.get(code);
      if (!room) return ack({ ok: false, error: 'Room not found. Check the code or ask for a new link.' });

      // Reclaim a seat with the private reconnect token.
      if (typeof p.token === 'string' && p.token) {
        const existing = room.members.find((m) => m.token === p.token);
        if (existing) {
          if (socket.data.code !== code || socket.data.memberId !== existing.id) this.leaveCurrent(socket);
          room.attach(existing, socket);
          ack({ ok: true, code, playerId: existing.id, token: existing.token, reclaimed: true } satisfies Ack<JoinSuccess>);
          room.broadcast();
          return;
        }
      }

      const name = cleanName(p?.name);
      if (!name) return ack({ ok: false, error: 'Enter a display name (1–20 characters)' });
      if (room.members.length >= room.capacity) {
        return ack({ ok: false, error: `Room full — all ${room.capacity} seats are taken.` });
      }
      if (room.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
        return ack({ ok: false, error: 'That name is already taken in this room. Pick another.' });
      }
      this.leaveCurrent(socket);
      const m = room.addMember(name);
      room.attach(m, socket);
      ack({ ok: true, code, playerId: m.id, token: m.token, reclaimed: false } satisfies Ack<JoinSuccess>);
      if (room.phase === 'playing') {
        socket.emit('room:notice', { message: 'A match is in progress. You are in the lobby for the next match.' });
      }
      room.broadcast();
    }));

    socket.on('room:start', safe((ack) => {
      if (!isFn(ack)) return;
      const cur = this.currentRoom(socket);
      if (!cur) return ack({ ok: false, error: 'Join a room first' });
      ack(cur.room.start(cur.member.id));
    }));

    socket.on('room:backToLobby', safe((ack) => {
      if (!isFn(ack)) return;
      const cur = this.currentRoom(socket);
      if (!cur) return ack({ ok: false, error: 'Join a room first' });
      ack(cur.room.backToLobby(cur.member.id));
    }));

    socket.on('room:leave', safe((ack) => {
      const cur = this.currentRoom(socket);
      if (cur) {
        const { room, member } = cur;
        socket.leave(room.code);
        socket.data.code = undefined;
        socket.data.memberId = undefined;
        if (room.phase === 'playing' && room.seated.has(member.id)) {
          room.detach(socket.id); // seat stays locked; their turns time out
        } else {
          room.removeMember(member.id);
          room.broadcast();
        }
      }
      if (isFn(ack)) ack({ ok: true });
    }));

    socket.on('game:action', safe((p, ack) => {
      if (!isFn(ack)) return;
      const cur = this.currentRoom(socket);
      if (!cur) return ack({ ok: false, error: 'Join a room first' });
      ack(cur.room.act(cur.member.id, p));
    }));

    socket.on('disconnect', () => {
      const cur = this.currentRoom(socket);
      if (cur) cur.room.detach(socket.id);
    });
  }
}
