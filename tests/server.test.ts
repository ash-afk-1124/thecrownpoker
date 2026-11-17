import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { createPokerServer, type RunningPokerServer } from '../src/server/app';
import type { Ack, JoinSuccess, RoomSnapshot } from '../src/shared/protocol';
import { getLegalActions, isCard, type Card } from '../src/engine';

let server: RunningPokerServer;
let url: string;
const clients: Client[] = [];

interface Client {
  socket: Socket;
  /** Every message this browser received, raw, in order (event name + payload). */
  messages: { event: string; payload: unknown }[];
  states: RoomSnapshot[];
  last(): RoomSnapshot;
  join?: JoinSuccess;
}

async function startServer(opts: Parameters<typeof createPokerServer>[0] = {}) {
  server = createPokerServer({ turnMs: 10_000, nextHandMs: 60_000, lobbyGraceMs: 60_000, ...opts });
  await new Promise<void>((r) => server.httpServer.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
}

async function client(): Promise<Client> {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  const c: Client = {
    socket, messages: [], states: [],
    last() {
      if (!this.states.length) throw new Error('no state yet');
      return this.states[this.states.length - 1];
    },
  };
  socket.onAny((event, payload) => {
    c.messages.push({ event, payload: JSON.parse(JSON.stringify(payload)) });
    if (event === 'room:state') c.states.push(payload);
  });
  await new Promise<void>((r) => socket.on('connect', () => r()));
  clients.push(c);
  return c;
}

function emit<T = object>(c: Client, event: string, ...args: unknown[]): Promise<Ack<T>> {
  return new Promise((resolve) => (c.socket.emit as (...a: unknown[]) => void)(event, ...args, resolve));
}

async function waitFor(pred: () => boolean, ms = 4000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function createRoom(name: string, capacity = 7) {
  const c = await client();
  const r = await emit<JoinSuccess>(c, 'room:create', { name, capacity });
  if (!r.ok) throw new Error(r.error);
  c.join = r;
  await waitFor(() => c.states.length > 0);
  return c;
}

async function joinRoom(code: string, name: string, token?: string) {
  const c = await client();
  const r = await emit<JoinSuccess>(c, 'room:join', { code, name, token });
  if (r.ok) {
    c.join = r;
    await waitFor(() => c.states.length > 0);
  }
  return { c, r };
}

async function roomWith(names: string[], capacity = 7) {
  const host = await createRoom(names[0], capacity);
  const code = host.join!.code;
  const others: Client[] = [];
  for (const n of names.slice(1)) {
    const { c, r } = await joinRoom(code, n);
    if (!r.ok) throw new Error(r.error);
    others.push(c);
  }
  const all = [host, ...others];
  await waitFor(() => host.last().members.length === names.length);
  return { code, host, all };
}

const roomOf = (code: string) => server.rooms.rooms.get(code)!;

/** Have whoever's turn it is call or check, until the hand is over. */
async function playHandPassively(code: string, all: Client[]) {
  const room = roomOf(code);
  const handNo = room.game!.handNumber;
  for (let guard = 0; guard < 100; guard++) {
    const g = room.game!;
    if (g.handNumber !== handNo || g.phase !== 'betting') return;
    const actor = all.find((c) => c.join!.playerId === g.players[g.toAct!].id)!;
    await waitFor(() => actor.last().game?.actionSeq === g.actionSeq);
    const legal = actor.last().game!.legal!;
    const r = await emit(actor, 'game:action', { seq: g.actionSeq, action: { type: legal.canCheck ? 'check' : 'call' } });
    expect(r).toEqual({ ok: true });
  }
}

beforeEach(async () => {
  await startServer({ publicUrl: 'https://poker.example.com/' });
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.socket.disconnect();
  await server.close();
});

describe('rooms and lobby', () => {
  it('creates a room with a six-digit code and an invite link using the public URL', async () => {
    const host = await createRoom('Alice', 5);
    const snap = host.last();
    expect(snap.code).toMatch(/^\d{6}$/);
    expect(snap.inviteUrl).toBe(`https://poker.example.com/room/${snap.code}`);
    expect(snap.capacity).toBe(5);
    expect(snap.you.isHost).toBe(true);
    expect(snap.phase).toBe('lobby');
  });

  it('defaults capacity to 7 and rejects capacities outside 3–7', async () => {
    const c = await client();
    expect(await emit(c, 'room:create', { name: 'A', capacity: 8 })).toMatchObject({ ok: false });
    expect(await emit(c, 'room:create', { name: 'A', capacity: 2 })).toMatchObject({ ok: false });
    const r = await emit<JoinSuccess>(c, 'room:create', { name: 'A' });
    expect(r.ok).toBe(true);
    await waitFor(() => c.states.length > 0);
    expect(c.last().capacity).toBe(7);
  });

  it('needs at least 3 players and only the host can start', async () => {
    const { host, all } = await roomWith(['Alice', 'Bob']);
    expect(await emit(host, 'room:start')).toMatchObject({ ok: false, error: expect.stringContaining('3') });
    const { c: carol } = await joinRoom(host.join!.code, 'Carol');
    expect(await emit(all[1], 'room:start')).toMatchObject({ ok: false, error: expect.stringContaining('host') });
    expect(await emit(host, 'room:start')).toEqual({ ok: true });
    await waitFor(() => carol.last().phase === 'playing');
    const g = carol.last().game!;
    expect(g.totalChips).toBe(15_000);
    expect(g.players).toHaveLength(3);
  });

  it('seven can play in a full room and an eighth gets "Room full"', async () => {
    const names = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
    const { code, host, all } = await roomWith(names, 7);
    const { r } = await joinRoom(code, 'P8');
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Room full/) });
    expect(await emit(host, 'room:start')).toEqual({ ok: true });
    await waitFor(() => all.every((c) => c.last().phase === 'playing'));
    expect(host.last().game!.totalChips).toBe(35_000);
    await playHandPassively(code, all);
    const g = roomOf(code).game!;
    expect(g.players.reduce((s, p) => s + p.stack + p.committed, 0)).toBe(35_000);
  });

  it('rejects unknown room codes and duplicate names', async () => {
    const host = await createRoom('Alice');
    expect((await joinRoom('000000', 'Bob')).r).toMatchObject({ ok: false, error: expect.stringContaining('not found') });
    expect((await joinRoom(host.join!.code, 'alice')).r).toMatchObject({ ok: false, error: expect.stringContaining('taken') });
  });

  it('transfers host controls when the host leaves the lobby', async () => {
    const { host, all } = await roomWith(['Alice', 'Bob', 'Carol']);
    host.socket.disconnect();
    await waitFor(() => all[1].last().hostId === all[1].join!.playerId);
    expect(all[1].last().you.isHost).toBe(true);
    expect(all[1].last().members.find((m) => m.name === 'Alice')!.connected).toBe(false);
  });

  it('lets new players wait in the lobby during a match, without a seat', async () => {
    const { code, host } = await roomWith(['Alice', 'Bob', 'Carol'], 4);
    await emit(host, 'room:start');
    const { c: dave, r } = await joinRoom(code, 'Dave');
    expect(r.ok).toBe(true);
    await waitFor(() => dave.last().phase === 'playing');
    expect(dave.last().you.seated).toBe(false);
    expect(dave.last().game!.players.map((p) => p.name)).not.toContain('Dave');
    expect(dave.last().game!.players.every((p) => p.holeCards === null)).toBe(true);
  });
});

describe('server-side action validation', () => {
  it('rejects out-of-turn moves, illegal amounts and duplicate submissions', async () => {
    const { code, all } = await roomWith(['Alice', 'Bob', 'Carol']);
    await emit(all[0], 'room:start');
    const room = roomOf(code);
    await waitFor(() => all.every((c) => c.last().phase === 'playing'));
    const g = room.game!;
    const actor = all.find((c) => c.join!.playerId === g.players[g.toAct!].id)!;
    const other = all.find((c) => c !== actor)!;

    expect(await emit(other, 'game:action', { seq: g.actionSeq, action: { type: 'call' } }))
      .toMatchObject({ ok: false, error: expect.stringContaining('not your turn') });
    expect(await emit(actor, 'game:action', { seq: g.actionSeq, action: { type: 'raise', amount: 15 } }))
      .toMatchObject({ ok: false, error: expect.stringContaining('Raise to must be between') });
    expect(await emit(actor, 'game:action', { seq: g.actionSeq, action: { type: 'raise', amount: 999_999 } }))
      .toMatchObject({ ok: false });
    expect(await emit(actor, 'game:action', { seq: g.actionSeq, action: { type: 'steal' } }))
      .toMatchObject({ ok: false, error: 'Malformed action' });

    const seq = g.actionSeq;
    const [first, second] = await Promise.all([
      emit(actor, 'game:action', { seq, action: { type: 'call' } }),
      emit(actor, 'game:action', { seq, action: { type: 'call' } }),
    ]);
    expect(first).toEqual({ ok: true });
    expect(second).toMatchObject({ ok: false });
    expect(room.game!.actionSeq).toBe(seq + 1);
  });

  it('times out a player after the turn timer: check if legal, otherwise fold', async () => {
    await server.close();
    await startServer({ turnMs: 250 });
    const { code, all } = await roomWith(['Alice', 'Bob', 'Carol']);
    await emit(all[0], 'room:start');
    const room = roomOf(code);
    const first = room.game!.players[room.game!.toAct!];
    await waitFor(() => room.game!.players.find((p) => p.id === first.id)!.folded, 3000);
    expect(room.game!.log.some((e) => e.text.includes('timed out'))).toBe(true);
    const snap = all[0].last();
    expect(snap.turnEndsAt! - snap.serverNow).toBeLessThanOrEqual(250);
  });
});

describe('reconnecting', () => {
  it('a refreshed browser reclaims the same seat and cards with its token', async () => {
    const { code, all } = await roomWith(['Alice', 'Bob', 'Carol']);
    await emit(all[0], 'room:start');
    await waitFor(() => all.every((c) => c.last().phase === 'playing'));
    const bob = all[1];
    const bobId = bob.join!.playerId;
    const token = bob.join!.token;
    const trueCards = roomOf(code).game!.players.find((p) => p.id === bobId)!.holeCards;
    const seat = roomOf(code).game!.players.find((p) => p.id === bobId)!.seat;

    bob.socket.disconnect(); // like closing the tab / refreshing
    await waitFor(() => all[0].last().members.find((m) => m.id === bobId)!.connected === false);

    const { c: bob2, r } = await joinRoom(code, '', token);
    expect(r).toMatchObject({ ok: true, playerId: bobId, reclaimed: true });
    const view = bob2.last().game!;
    const me = view.players.find((p) => p.id === bobId)!;
    expect(me.seat).toBe(seat);
    expect(me.holeCards).toEqual(trueCards);
    expect(bob2.last().you.seated).toBe(true);
  });

  it('a different browser with only the room code cannot take over a seat', async () => {
    const { code, all } = await roomWith(['Alice', 'Bob', 'Carol'], 4);
    await emit(all[0], 'room:start');
    const bobId = all[1].join!.playerId;
    all[1].socket.disconnect();

    // Same name, no token: rejected.
    expect((await joinRoom(code, 'Bob')).r).toMatchObject({ ok: false });
    // Wrong token: treated as a brand new person, never as Bob.
    const { c: impostor, r } = await joinRoom(code, 'Mallory', 'not-the-real-token');
    expect(r.ok && r.playerId).not.toBe(bobId);
    expect(impostor.last().you.seated).toBe(false);
    expect(impostor.last().game!.players.every((p) => p.holeCards === null)).toBe(true);
    const g = roomOf(code).game!;
    expect(await emit(impostor, 'game:action', { seq: g.actionSeq, action: { type: 'fold' } }))
      .toMatchObject({ ok: false, error: expect.stringContaining('not seated') });
  });
});

describe('privacy at the network-message level', () => {
  /** Collect every card-like string anywhere in a payload. */
  function cardsIn(x: unknown, out: Set<Card> = new Set()): Set<Card> {
    if (isCard(x)) out.add(x);
    else if (Array.isArray(x)) x.forEach((v) => cardsIn(v, out));
    else if (x && typeof x === 'object') Object.values(x).forEach((v) => cardsIn(v, out));
    return out;
  }

  it('each browser only ever receives its own hole cards (plus board and showdown reveals)', async () => {
    const { code, all } = await roomWith(['Alice', 'Bob', 'Carol', 'Dave']);
    await emit(all[0], 'room:start');
    await waitFor(() => all.every((c) => c.last().phase === 'playing'));
    const g0 = roomOf(code).game!;
    const truth = new Map(g0.players.map((p) => [p.id, p.holeCards.slice()]));
    const deckAtStart = new Set(g0.deck);
    await playHandPassively(code, all);
    await waitFor(() => all.every((c) => c.last().game!.phase !== 'betting'));

    const tokens = all.map((c) => c.join!.token);
    for (const c of all) {
      const me = c.join!.playerId;
      for (const { event, payload } of c.messages) {
        const raw = JSON.stringify(payload);
        expect(raw).not.toContain('"deck"');
        for (const t of tokens) if (t !== c.join!.token) expect(raw).not.toContain(t);
        const snap = payload as RoomSnapshot;
        const allowed = new Set<Card>(truth.get(me));
        if (event === 'room:state' && snap.game) {
          snap.game.board.forEach((x) => allowed.add(x));
          snap.game.lastResult?.showdown?.forEach((h) => [...h.holeCards, ...h.bestFive].forEach((x) => allowed.add(x)));
          snap.game.lastResult?.board.forEach((x) => allowed.add(x));
          // Before showdown, every other player's cards must be hidden.
          if (snap.game.phase === 'betting') {
            for (const p of snap.game.players) if (p.id !== me) expect(p.holeCards).toBeNull();
          }
        }
        for (const card of cardsIn(payload)) {
          expect(allowed.has(card), `${c.join!.playerId} received ${card} in ${event}`).toBe(true);
        }
      }
      // Burn cards and undealt cards never leave the server.
      const seen = new Set<Card>();
      c.messages.forEach((m) => cardsIn(m.payload, seen));
      const final = roomOf(code).game!;
      for (const card of deckAtStart) if (!final.board.includes(card)) expect(seen.has(card)).toBe(false);
    }

    // At showdown, everyone sees the same result.
    const results = all.map((c) => JSON.stringify(c.last().game!.lastResult));
    expect(new Set(results).size).toBe(1);
  });

  it('two rooms play at the same time without sharing cards, players or events', async () => {
    const a = await roomWith(['A1', 'A2', 'A3']);
    const b = await roomWith(['B1', 'B2', 'B3']);
    expect(a.code).not.toBe(b.code);
    await Promise.all([emit(a.host, 'room:start'), emit(b.host, 'room:start')]);
    await Promise.all([playHandPassively(a.code, a.all), playHandPassively(b.code, b.all)]);

    const bIds = b.all.map((c) => c.join!.playerId);
    const aIds = a.all.map((c) => c.join!.playerId);
    const bCards = roomOf(b.code).game!.players.flatMap((p) => p.holeCards);
    for (const c of a.all) {
      for (const m of c.messages) {
        const raw = JSON.stringify(m.payload);
        expect(raw).not.toContain(b.code);
        for (const id of bIds) expect(raw).not.toContain(id);
        expect(raw).not.toMatch(/"B[123]"/);
      }
    }
    for (const c of b.all) {
      for (const m of c.messages) {
        const raw = JSON.stringify(m.payload);
        expect(raw).not.toContain(a.code);
        for (const id of aIds) expect(raw).not.toContain(id);
      }
    }
    expect(bCards).toHaveLength(6);
  });
});

describe('match flow', () => {
  it('starts the next hand automatically after a short pause', async () => {
    await server.close();
    await startServer({ nextHandMs: 150 });
    const { code, all } = await roomWith(['Alice', 'Bob', 'Carol']);
    await emit(all[0], 'room:start');
    await playHandPassively(code, all);
    await waitFor(() => all[0].last().nextHandAt !== null || roomOf(code).game!.handNumber === 2);
    await waitFor(() => roomOf(code).game!.handNumber === 2);
    await waitFor(() => all.every((c) => c.last().game!.handNumber === 2));
    expect(all[0].last().game!.history).toHaveLength(1);
  });

  it('plays to a finish when one player holds all the chips', async () => {
    await server.close();
    await startServer({ nextHandMs: 20 });
    const { code, all } = await roomWith(['Alice', 'Bob', 'Carol']);
    await emit(all[0], 'room:start');
    const room = roomOf(code);
    for (let guard = 0; guard < 3000 && room.phase === 'playing'; guard++) {
      const g = room.game!;
      if (g.phase !== 'betting') {
        await new Promise((r) => setTimeout(r, 25));
        continue;
      }
      const actor = all.find((c) => c.join!.playerId === g.players[g.toAct!].id)!;
      const legal = getLegalActions(g, g.players[g.toAct!].id)!;
      const action = legal.allIn !== null ? { type: 'allin' } : { type: legal.canCheck ? 'check' : 'call' };
      await emit(actor, 'game:action', { seq: g.actionSeq, action });
      const chips = room.game!.players.reduce((s, p) => s + p.stack + p.committed, 0);
      expect(chips).toBe(15_000);
    }
    expect(room.phase).toBe('finished');
    await waitFor(() => all.every((c) => c.last().phase === 'finished'));
    const g = all[0].last().game!;
    const winner = g.players.find((p) => p.id === g.winnerId)!;
    expect(winner.stack).toBe(15_000);
    expect(await emit(all[0], 'room:backToLobby')).toMatchObject({ ok: expect.any(Boolean) });
  });
});
