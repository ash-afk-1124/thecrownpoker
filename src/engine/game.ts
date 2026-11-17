import { type Card, type Rng, freshDeck, secureRandom, shuffle } from './cards';
import { evaluateHand, type HandValue } from './evaluator';
import { computePots } from './pots';
import {
  type Action, type GameConfig, type GameState, type HandResult, type LegalActions,
  type LogEntry, type Player, type PotResult, type ShowdownHand, type Street,
  IllegalActionError,
} from './types';

export const DEFAULT_CONFIG: GameConfig = { startingStack: 5000, smallBlind: 5, bigBlind: 10 };

const gbp = (n: number) => `£${n.toLocaleString('en-GB')}`;
export const formatGBP = gbp;

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createGame(
  players: { id: string; name: string }[],
  config: Partial<GameConfig> = {},
): GameState {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (players.length < 2) throw new Error('Need at least two players');
  if (new Set(players.map((p) => p.id)).size !== players.length) throw new Error('Duplicate player ids');
  return {
    config: cfg,
    players: players.map((p, seat) => ({
      id: p.id, name: p.name, seat, stack: cfg.startingStack, holeCards: [], streetBet: 0,
      committed: 0, folded: false, allIn: false, inHand: false, eliminated: false, actedLevel: null,
    })),
    totalChips: cfg.startingStack * players.length,
    handNumber: 0,
    phase: 'notStarted',
    street: 'preflop',
    board: [],
    deck: [],
    sbSeat: null,
    bbSeat: null,
    playersInHand: 0,
    currentBet: 0,
    minRaise: cfg.bigBlind,
    toAct: null,
    actionSeq: 0,
    log: [],
    lastResult: null,
    history: [],
    winnerId: null,
  };
}

const clone = <T>(x: T): T => structuredClone(x);

// ---------------------------------------------------------------------------
// Seat helpers (clockwise = increasing seat index)
// ---------------------------------------------------------------------------

const survivors = (s: GameState) => s.players.filter((p) => !p.eliminated);

/** Next surviving seat strictly clockwise from `seat`. */
function nextSurvivor(s: GameState, seat: number): number {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const p = s.players[(seat + i) % n];
    if (!p.eliminated) return p.seat;
  }
  throw new Error('No surviving players');
}

/** Nearest surviving seat strictly counter-clockwise from `seat`. */
function prevSurvivor(s: GameState, seat: number): number {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const p = s.players[(seat - i + n) % n];
    if (!p.eliminated) return p.seat;
  }
  throw new Error('No surviving players');
}

const canAct = (p: Player) => p.inHand && !p.folded && !p.allIn;
const liveInHand = (s: GameState) => s.players.filter((p) => p.inHand && !p.folded);

/** Seats in clockwise order starting AT `start`. */
function seatsFrom(s: GameState, start: number): Player[] {
  const n = s.players.length;
  return Array.from({ length: n }, (_, i) => s.players[(start + i) % n]);
}

export function potTotal(s: GameState): number {
  return s.players.reduce((sum, p) => sum + p.committed, 0);
}

/** Stacks plus chips committed to the current hand. Must always equal totalChips. */
export function chipsAccountedFor(s: GameState): number {
  return s.players.reduce((sum, p) => sum + p.stack + p.committed, 0);
}

export function assertChipConservation(s: GameState): void {
  const total = chipsAccountedFor(s);
  if (total !== s.totalChips) {
    throw new Error(`Chip conservation violated: ${total} on table, expected ${s.totalChips}`);
  }
  for (const p of s.players) {
    if (p.stack < 0 || p.committed < 0 || p.streetBet < 0) throw new Error(`Negative chips for ${p.name}`);
    if (!Number.isInteger(p.stack) || !Number.isInteger(p.committed)) throw new Error('Non-integer chips');
  }
}

function log(s: GameState, entry: LogEntry) {
  s.log.push({ ...entry, street: entry.street ?? s.street });
}

// ---------------------------------------------------------------------------
// Starting a hand
// ---------------------------------------------------------------------------

export interface StartHandOptions {
  rng?: Rng;
  /** Preset deck, dealt from index 0. For tests. */
  deck?: Card[];
  /** Force the first hand's small-blind seat. For tests. */
  firstSmallBlindSeat?: number;
}

export function startHand(prev: GameState, opts: StartHandOptions = {}): GameState {
  if (prev.phase === 'betting') throw new Error('Hand already in progress');
  if (prev.phase === 'gameOver') throw new Error('Game is over');
  const s = clone(prev);
  const rng = opts.rng ?? secureRandom;
  const alive = survivors(s);
  if (alive.length < 2) throw new Error('Not enough players');

  s.handNumber += 1;
  s.log = [];
  s.board = [];
  s.street = 'preflop';
  s.lastResult = null;

  // Blinds. The big blind moves to the next surviving player clockwise from the
  // previous big blind; the surviving player immediately before it posts the small blind.
  let sb: number;
  let bb: number;
  if (s.bbSeat === null) {
    sb = opts.firstSmallBlindSeat ?? alive[Math.floor(rng() * alive.length)].seat;
    if (s.players[sb].eliminated) throw new Error('First small blind must be a live seat');
    bb = nextSurvivor(s, sb);
  } else {
    bb = nextSurvivor(s, s.bbSeat);
    sb = prevSurvivor(s, bb);
  }
  s.sbSeat = sb;
  s.bbSeat = bb;

  for (const p of s.players) {
    p.inHand = !p.eliminated;
    p.holeCards = [];
    p.streetBet = 0;
    p.committed = 0;
    p.folded = false;
    p.allIn = false;
    p.actedLevel = null;
  }
  s.playersInHand = alive.length;

  s.deck = opts.deck ? opts.deck.slice() : shuffle(freshDeck(), rng);
  if (new Set(s.deck).size !== s.deck.length) throw new Error('Deck contains duplicates');

  log(s, { kind: 'hand-start', text: `Hand #${s.handNumber}` });
  post(s, sb, s.config.smallBlind, 'small blind');
  post(s, bb, s.config.bigBlind, 'big blind');
  s.currentBet = s.config.bigBlind; // nominal big blind, even if the BB is short
  s.minRaise = s.config.bigBlind;

  // Deal two cards each, one at a time, starting with the small blind.
  const order = seatsFrom(s, sb).filter((p) => p.inHand);
  for (let round = 0; round < 2; round++) for (const p of order) p.holeCards.push(draw(s));
  log(s, { kind: 'deal', text: 'Hole cards dealt' });

  s.phase = 'betting';
  s.toAct = null;
  if (isRoundComplete(s)) endBettingRound(s);
  else s.toAct = nextToAct(s, bb);
  assertChipConservation(s);
  return s;
}

function post(s: GameState, seat: number, blind: number, label: string) {
  const p = s.players[seat];
  const amt = Math.min(blind, p.stack);
  pay(p, amt);
  log(s, {
    kind: 'post', playerId: p.id, amount: amt,
    text: `${p.name} posts ${label} ${gbp(amt)}${p.allIn ? ' (all-in)' : ''}`,
  });
}

function pay(p: Player, amount: number) {
  if (amount < 0 || amount > p.stack) throw new Error('Invalid payment');
  p.stack -= amount;
  p.streetBet += amount;
  p.committed += amount;
  if (p.stack === 0) p.allIn = true;
}

function draw(s: GameState): Card {
  const c = s.deck.shift();
  if (!c) throw new Error('Deck exhausted');
  return c;
}

// ---------------------------------------------------------------------------
// Turn order and round completion
// ---------------------------------------------------------------------------

const needsToAct = (s: GameState, p: Player) =>
  canAct(p) && (p.actedLevel === null || p.streetBet < s.currentBet);

/** Next player clockwise (strictly after `fromSeat`) who still needs to act. */
function nextToAct(s: GameState, fromSeat: number): number | null {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const p = s.players[(fromSeat + i) % n];
    if (needsToAct(s, p)) return p.seat;
  }
  return null;
}

export function isRoundComplete(s: GameState): boolean {
  const actors = s.players.filter(canAct);
  if (actors.length === 0) return true;
  if (actors.length === 1) {
    // Nobody left to bet against: done once this player has matched the bet.
    return actors[0].streetBet >= s.currentBet;
  }
  return actors.every((p) => p.actedLevel !== null && p.streetBet === s.currentBet);
}

function firstToActPostflop(s: GameState): number | null {
  // Heads-up: big blind acts first after the flop. Otherwise start at the small blind's seat.
  const start = s.playersInHand === 2 ? s.bbSeat! : s.sbSeat!;
  const p = seatsFrom(s, start).find((pl) => canAct(pl));
  return p ? p.seat : null;
}

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

export function getLegalActions(s: GameState, playerId: string): LegalActions | null {
  if (s.phase !== 'betting' || s.toAct === null) return null;
  const p = s.players[s.toAct];
  if (p.id !== playerId || !canAct(p)) return null;

  const toCall = Math.max(0, s.currentBet - p.streetBet);
  const maxTotal = p.streetBet + p.stack;
  const legal: LegalActions = {
    playerId, toCall, canFold: toCall > 0, canCheck: toCall === 0,
    call: null, callIsAllIn: false, bet: null, raise: null, allIn: null,
    pot: potTotal(s), currentBet: s.currentBet, streetBet: p.streetBet, stack: p.stack,
  };

  if (toCall > 0) {
    legal.call = Math.min(toCall, p.stack);
    legal.callIsAllIn = p.stack <= toCall;
  }

  if (p.stack > toCall) {
    // Betting is reopened for this player only if they have not acted yet, or the bet
    // has risen by at least a full raise since they last acted.
    const reopened = p.actedLevel === null || s.currentBet - p.actedLevel >= s.minRaise;
    if (s.currentBet === 0) {
      legal.bet = { min: Math.min(s.config.bigBlind, maxTotal), max: maxTotal };
      legal.allIn = maxTotal;
    } else if (reopened) {
      const minTo = s.currentBet + s.minRaise;
      legal.raise = { min: Math.min(minTo, maxTotal), max: maxTotal };
      legal.allIn = maxTotal;
    }
  } else if (p.stack > 0) {
    legal.allIn = maxTotal; // all-in is a (short) call
  }
  return legal;
}

// ---------------------------------------------------------------------------
// Applying actions
// ---------------------------------------------------------------------------

export function applyAction(prev: GameState, playerId: string, action: Action): GameState {
  if (prev.phase !== 'betting' || prev.toAct === null) throw new IllegalActionError('No betting in progress');
  if (prev.players[prev.toAct].id !== playerId) throw new IllegalActionError('Not your turn');
  const legal = getLegalActions(prev, playerId);
  if (!legal) throw new IllegalActionError('You cannot act now');

  const s = clone(prev);
  const p = s.players[s.toAct!];

  let { type } = action;
  let amount = action.amount;

  if (type === 'allin') {
    if (legal.allIn === null) throw new IllegalActionError('All-in is not a legal action here');
    amount = legal.allIn;
    if (legal.bet) type = 'bet';
    else if (legal.raise) type = 'raise';
    else type = 'call';
  }

  switch (type) {
    case 'fold': {
      if (!legal.canFold) throw new IllegalActionError('You can check instead of folding');
      p.folded = true;
      log(s, { kind: 'fold', playerId: p.id, text: `${p.name} folds` });
      break;
    }
    case 'check': {
      if (!legal.canCheck) throw new IllegalActionError(`You must call ${gbp(legal.toCall)} or fold`);
      p.actedLevel = s.currentBet;
      log(s, { kind: 'check', playerId: p.id, text: `${p.name} checks` });
      break;
    }
    case 'call': {
      if (legal.call === null) throw new IllegalActionError('Nothing to call');
      pay(p, legal.call);
      p.actedLevel = s.currentBet;
      log(s, {
        kind: 'call', playerId: p.id, amount: legal.call,
        text: `${p.name} calls ${gbp(legal.call)}${p.allIn ? ' (all-in)' : ''}`,
      });
      break;
    }
    case 'bet':
    case 'raise': {
      const range = type === 'bet' ? legal.bet : legal.raise;
      if (!range) throw new IllegalActionError(type === 'bet' ? 'You cannot bet now' : 'You cannot raise now');
      if (typeof amount !== 'number' || !Number.isInteger(amount)) {
        throw new IllegalActionError('Amount must be a whole number of pounds');
      }
      if (amount < range.min || amount > range.max) {
        throw new IllegalActionError(
          `${type === 'bet' ? 'Bet' : 'Raise to'} must be between ${gbp(range.min)} and ${gbp(range.max)}`,
        );
      }
      const increment = amount - s.currentBet;
      pay(p, amount - p.streetBet);
      if (increment >= s.minRaise) s.minRaise = increment; // full bet/raise
      s.currentBet = amount;
      p.actedLevel = amount;
      const verb = type === 'bet' ? 'bets' : 'raises to';
      log(s, {
        kind: type, playerId: p.id, amount,
        text: `${p.name} ${verb} ${gbp(amount)}${p.allIn ? ' (all-in)' : ''}`,
      });
      break;
    }
    default:
      throw new IllegalActionError('Unknown action');
  }

  s.actionSeq += 1;
  advance(s, p.seat);
  assertChipConservation(s);
  return s;
}

/** Timeout behaviour: check if legal, otherwise fold. */
export function applyTimeout(prev: GameState): GameState {
  if (prev.phase !== 'betting' || prev.toAct === null) return prev;
  const p = prev.players[prev.toAct];
  const legal = getLegalActions(prev, p.id)!;
  const s = applyAction(prev, p.id, { type: legal.canCheck ? 'check' : 'fold' });
  // Annotate the log entry we just added.
  const idx = s.log.findIndex((e, i) => i >= prev.log.length && e.playerId === p.id);
  if (idx >= 0) s.log[idx] = { ...s.log[idx], text: `${s.log[idx].text} (timed out)` };
  return s;
}

function advance(s: GameState, fromSeat: number) {
  if (liveInHand(s).length === 1) {
    returnUncalled(s);
    awardUncontested(s);
    return;
  }
  if (isRoundComplete(s)) {
    endBettingRound(s);
    return;
  }
  s.toAct = nextToAct(s, fromSeat);
}

function returnUncalled(s: GameState) {
  const inHand = s.players.filter((p) => p.inHand);
  const sorted = inHand.slice().sort((a, b) => b.streetBet - a.streetBet);
  if (sorted.length < 2) return;
  const [top, second] = sorted;
  const excess = top.streetBet - second.streetBet;
  if (excess > 0) {
    top.streetBet -= excess;
    top.committed -= excess;
    top.stack += excess;
    top.allIn = top.stack === 0;
    log(s, { kind: 'uncalled', playerId: top.id, amount: excess, text: `Uncalled ${gbp(excess)} returned to ${top.name}` });
  }
}

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river'];

function dealStreet(s: GameState) {
  const next = STREET_ORDER[STREET_ORDER.indexOf(s.street) + 1];
  draw(s); // burn
  const count = next === 'flop' ? 3 : 1;
  for (let i = 0; i < count; i++) s.board.push(draw(s));
  s.street = next;
  const label = next[0].toUpperCase() + next.slice(1);
  log(s, { kind: 'street', text: `${label}: ${s.board.join(' ')}` });
}

function endBettingRound(s: GameState) {
  returnUncalled(s);
  for (const p of s.players) {
    p.streetBet = 0;
    p.actedLevel = null;
  }
  s.currentBet = 0;
  s.minRaise = s.config.bigBlind;
  s.toAct = null;

  if (liveInHand(s).length === 1) {
    awardUncontested(s);
    return;
  }
  const bettingPossible = s.players.filter(canAct).length >= 2;
  if (s.street === 'river' || !bettingPossible) {
    while (s.street !== 'river') dealStreet(s);
    showdown(s);
    return;
  }
  dealStreet(s);
  s.toAct = firstToActPostflop(s);
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

/** Order of seats clockwise starting from the small-blind seat (for odd chips). */
function oddChipOrder(s: GameState, ids: string[]): string[] {
  const n = s.players.length;
  const sb = s.sbSeat ?? 0;
  return ids
    .map((id) => s.players.find((p) => p.id === id)!)
    .sort((a, b) => ((a.seat - sb + n) % n) - ((b.seat - sb + n) % n))
    .map((p) => p.id);
}

function awardUncontested(s: GameState) {
  const winner = liveInHand(s)[0];
  const amount = potTotal(s);
  winner.stack += amount;
  for (const p of s.players) {
    p.committed = 0;
    p.streetBet = 0;
  }
  log(s, { kind: 'win', playerId: winner.id, amount, text: `${winner.name} wins ${gbp(amount)} uncontested` });
  const result: HandResult = {
    handNumber: s.handNumber,
    board: s.board.slice(),
    uncontested: true,
    pots: [{
      label: 'Pot', amount, eligible: [winner.id],
      winners: [{ playerId: winner.id, name: winner.name, amount }], handDescription: null,
    }],
    winners: [{ playerId: winner.id, name: winner.name, amount, handDescription: null }],
    showdown: null,
    eliminated: [],
    summary: `${winner.name} won ${gbp(amount)} (everyone else folded)`,
  };
  finishHand(s, result);
}

function showdown(s: GameState) {
  const live = liveInHand(s);
  const values = new Map<string, HandValue>();
  for (const p of live) values.set(p.id, evaluateHand([...p.holeCards, ...s.board]));

  const showdownHands: ShowdownHand[] = oddChipOrder(s, live.map((p) => p.id)).map((id) => {
    const p = s.players.find((x) => x.id === id)!;
    const v = values.get(id)!;
    return { playerId: id, name: p.name, holeCards: p.holeCards.slice(), description: v.description, bestFive: v.cards };
  });
  for (const h of showdownHands) {
    log(s, { kind: 'showdown', playerId: h.playerId, text: `${h.name} shows ${h.holeCards.join(' ')} — ${h.description}` });
  }

  const pots = computePots(s.players.filter((p) => p.inHand).map((p) => ({ id: p.id, committed: p.committed, folded: p.folded })));
  const totals = new Map<string, number>();
  const potResults: PotResult[] = pots.map((pot, i) => {
    const best = Math.max(...pot.eligible.map((id) => values.get(id)!.score));
    const winnerIds = oddChipOrder(s, pot.eligible.filter((id) => values.get(id)!.score === best));
    const share = Math.floor(pot.amount / winnerIds.length);
    let remainder = pot.amount - share * winnerIds.length;
    const winners = winnerIds.map((id) => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      const amt = share + extra;
      totals.set(id, (totals.get(id) ?? 0) + amt);
      return { playerId: id, name: s.players.find((p) => p.id === id)!.name, amount: amt };
    });
    return {
      label: pots.length === 1 ? 'Pot' : i === 0 ? 'Main pot' : pots.length > 2 ? `Side pot ${i}` : 'Side pot',
      amount: pot.amount, eligible: pot.eligible, winners,
      handDescription: values.get(winnerIds[0])!.description,
    };
  });

  for (const [id, amt] of totals) s.players.find((p) => p.id === id)!.stack += amt;
  for (const p of s.players) {
    p.committed = 0;
    p.streetBet = 0;
  }
  for (const pr of potResults) {
    const names = pr.winners.map((w) => `${w.name} (${gbp(w.amount)})`).join(', ');
    log(s, {
      kind: 'win', amount: pr.amount,
      text: `${pr.label} ${gbp(pr.amount)}: ${pr.winners.length > 1 ? 'split — ' : ''}${names} with ${pr.handDescription}`,
    });
  }

  const winners = [...totals.entries()].map(([id, amount]) => {
    const p = s.players.find((x) => x.id === id)!;
    return { playerId: id, name: p.name, amount, handDescription: values.get(id)!.description };
  });
  const result: HandResult = {
    handNumber: s.handNumber,
    board: s.board.slice(),
    uncontested: false,
    pots: potResults,
    winners,
    showdown: showdownHands,
    eliminated: [],
    summary: winners.map((w) => `${w.name} won ${gbp(w.amount)} with ${w.handDescription}`).join('; '),
  };
  finishHand(s, result);
}

function finishHand(s: GameState, result: HandResult) {
  s.toAct = null;
  s.currentBet = 0;
  for (const p of s.players) {
    if (p.inHand && p.stack === 0 && !p.eliminated) {
      p.eliminated = true;
      result.eliminated.push({ playerId: p.id, name: p.name });
      log(s, { kind: 'eliminated', playerId: p.id, text: `${p.name} is eliminated` });
    }
  }
  s.lastResult = result;
  s.history = [...s.history, result];
  const alive = survivors(s);
  if (alive.length === 1) {
    s.phase = 'gameOver';
    s.winnerId = alive[0].id;
    log(s, { kind: 'game-over', playerId: alive[0].id, text: `${alive[0].name} wins the game with ${gbp(alive[0].stack)}` });
  } else {
    s.phase = 'handComplete';
  }
  assertChipConservation(s);
}
