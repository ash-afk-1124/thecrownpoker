import {
  type Card, type GameState, applyAction, assertChipConservation, createGame, freshDeck, startHand,
} from '../src/engine';

export function newGame(names: string[], stacks?: number[]): GameState {
  const s = createGame(names.map((n) => ({ id: n.toLowerCase(), name: n })));
  if (stacks) {
    s.players.forEach((p, i) => (p.stack = stacks[i]));
    s.totalChips = stacks.reduce((a, b) => a + b, 0);
  }
  return s;
}

/**
 * Build a deck that deals the given hole cards and board. `dealOrder` lists seats in the
 * order the engine deals (small blind first, clockwise, players in the hand only).
 */
export function stackedDeck(dealOrder: number[], holes: Record<number, [Card, Card]>, board: Card[]): Card[] {
  const used: Card[] = [];
  const top: Card[] = [];
  for (const round of [0, 1]) for (const seat of dealOrder) top.push(holes[seat][round]);
  used.push(...top);
  const rest = freshDeck().filter((c) => !used.includes(c) && !board.includes(c));
  const burns = rest.splice(0, 3);
  const deck = [...top, burns[0], board[0], board[1], board[2], burns[1], board[3], burns[2], board[4], ...rest];
  if (new Set(deck).size !== 52) throw new Error('bad stacked deck');
  return deck;
}

/** Apply a sequence of [playerId, action] steps, checking conservation after each. */
export function play(s: GameState, steps: [string, string, number?][]): GameState {
  for (const [id, type, amount] of steps) {
    s = applyAction(s, id, { type: type as never, amount });
    assertChipConservation(s);
  }
  return s;
}

export const actorId = (s: GameState) => (s.toAct === null ? null : s.players[s.toAct].id);

export function start(s: GameState, opts: Parameters<typeof startHand>[1] = {}) {
  return startHand(s, opts);
}
