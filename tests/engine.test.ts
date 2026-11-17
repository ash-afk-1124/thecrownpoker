import { describe, expect, it } from 'vitest';
import {
  type GameState, applyAction, assertChipConservation, chipsAccountedFor, computePots, createGame,
  decideBotAction, BOT_PROFILES, evaluateHand, getLegalActions, getPlayerView, IllegalActionError,
  seededRng, startHand, HandCategory,
} from '../src/engine';
import { actorId, newGame, play, stackedDeck } from './helpers';

describe('hand evaluator', () => {
  const ev = (s: string) => evaluateHand(s.split(' '));

  it('ranks categories correctly', () => {
    expect(ev('As Ks Qs Js Ts 2c 3d').category).toBe(HandCategory.StraightFlush);
    expect(ev('As Ad Ac Ah 2s 3c 4d').category).toBe(HandCategory.FourOfAKind);
    expect(ev('As Ad Ac Kh Ks 3c 4d').category).toBe(HandCategory.FullHouse);
    expect(ev('2s 7s 9s Js Ks 3c 4d').category).toBe(HandCategory.Flush);
    expect(ev('9c Td Jh Qs Kc 2d 2h').category).toBe(HandCategory.Straight);
    expect(ev('9c 9d 9h Qs Kc 2d 3h').category).toBe(HandCategory.ThreeOfAKind);
    expect(ev('9c 9d Qh Qs Kc 2d 3h').category).toBe(HandCategory.TwoPair);
    expect(ev('9c 9d Ah Qs Kc 2d 3h').category).toBe(HandCategory.Pair);
    expect(ev('9c 8d Ah Qs Kc 2d 3h').category).toBe(HandCategory.HighCard);
  });

  it('handles ace-low straights (the wheel) as the lowest straight', () => {
    const wheel = ev('Ac 2d 3h 4s 5c Kd Kh');
    expect(wheel.category).toBe(HandCategory.Straight);
    expect(wheel.ranks).toEqual([5]);
    expect(wheel.score).toBeLessThan(ev('2d 3h 4s 5c 6c Kd Kh').score);
    const steelWheel = ev('Ac 2c 3c 4c 5c Kd Kh');
    expect(steelWheel.category).toBe(HandCategory.StraightFlush);
    expect(steelWheel.description).toBe('Straight Flush, Five high');
  });

  it('compares kickers', () => {
    const aceKing = ev('Ac Kd 9h 7s 2c 3d 4h'.replace('3d 4h', 'Ah 5d'));
    const aceQueen = ev('Ac Qd 9h 7s 2c Ah 5d');
    expect(aceKing.score).toBeGreaterThan(aceQueen.score);
    // Two pair: higher kicker wins.
    expect(ev('Kc Kd 7h 7s Ac 2d 3h').score).toBeGreaterThan(ev('Kc Kd 7h 7s Qc 2d 3h').score);
    // Third pair does not count; best kicker does.
    const twoPair = ev('Kc Kd 7h 7s 5c 5d Ah');
    expect(twoPair.ranks).toEqual([13, 7, 14]);
  });

  it('picks the best full house from two sets of trips', () => {
    const fh = ev('Kc Kd Kh 7s 7c 7d 2h');
    expect(fh.category).toBe(HandCategory.FullHouse);
    expect(fh.ranks).toEqual([13, 7]);
  });

  it('detects identical hands when both players play the board', () => {
    const board = 'Ah Kh Qh Jh Th';
    expect(ev(`2c 3d ${board}`).score).toBe(ev(`4s 5s ${board}`).score);
  });
});

describe('side pot construction', () => {
  it('builds main and side pots from contributions, folded chips stay in', () => {
    const pots = computePots([
      { id: 'a', committed: 100, folded: false },
      { id: 'b', committed: 300, folded: false },
      { id: 'c', committed: 300, folded: false },
      { id: 'd', committed: 50, folded: true },
    ]);
    expect(pots).toEqual([
      { amount: 350, eligible: ['a', 'b', 'c'] },
      { amount: 400, eligible: ['b', 'c'] },
    ]);
  });
});

describe('blind rotation', () => {
  it('chooses the first small blind randomly and the next player posts the BB', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed < 60; seed++) {
      const s = startHand(newGame(['A', 'B', 'C', 'D', 'E']), { rng: seededRng(seed) });
      seen.add(s.sbSeat!);
      expect(s.bbSeat).toBe((s.sbSeat! + 1) % 5);
    }
    expect(seen.size).toBe(5);
  });

  it('moves the BB one surviving seat clockwise each hand', () => {
    let s = startHand(newGame(['A', 'B', 'C', 'D', 'E']), { firstSmallBlindSeat: 0 });
    expect([s.sbSeat, s.bbSeat]).toEqual([0, 1]);
    // Everyone folds to the BB.
    s = play(s, [['c', 'fold'], ['d', 'fold'], ['e', 'fold'], ['a', 'fold']]);
    expect(s.phase).toBe('handComplete');
    s = startHand(s);
    expect([s.sbSeat, s.bbSeat]).toEqual([1, 2]);
  });

  it('skips eliminated players after an elimination', () => {
    // C (seat 2) has only £100 and busts in hand 1.
    let s = newGame(['A', 'B', 'C', 'D', 'E'], [5000, 5000, 100, 9900, 5000]);
    const deck = stackedDeck([0, 1, 2, 3, 4], {
      0: ['2c', '7d'], 1: ['3c', '8d'], 2: ['4c', '9d'], 3: ['Ac', 'As'], 4: ['5c', 'Td'],
    }, ['Kh', 'Qd', '6s', '2h', 'Jc']);
    s = startHand(s, { firstSmallBlindSeat: 0, deck });
    expect(actorId(s)).toBe('c');
    s = play(s, [['c', 'allin'], ['d', 'call'], ['e', 'fold'], ['a', 'fold'], ['b', 'fold']]);
    expect(s.phase).toBe('handComplete');
    expect(s.players[2].eliminated).toBe(true);
    expect(s.lastResult!.eliminated.map((e) => e.name)).toEqual(['C']);

    // Previous BB was seat 1; next surviving seat clockwise is 3 (seat 2 is out).
    // The surviving player immediately before seat 3 is seat 1, who posts the SB.
    s = startHand(s);
    expect(s.bbSeat).toBe(3);
    expect(s.sbSeat).toBe(1);
    expect(s.players[2].inHand).toBe(false);
    expect(actorId(s)).toBe('e'); // first to act: clockwise from the BB
    assertChipConservation(s);
  });

  it('when the previous BB is eliminated, the BB still moves to the next survivor', () => {
    let s = startHand(newGame(['A', 'B', 'C', 'D', 'E']), { firstSmallBlindSeat: 0 });
    s = play(s, [['c', 'fold'], ['d', 'fold'], ['e', 'fold'], ['a', 'fold']]);
    // Simulate B (the previous BB) having busted: move their chips to A to conserve the total.
    s = structuredClone(s);
    s.players[0].stack += s.players[1].stack;
    s.players[1].stack = 0;
    s.players[1].eliminated = true;
    s = startHand(s);
    expect(s.bbSeat).toBe(2);
    expect(s.sbSeat).toBe(0);
  });

  it('posts a short blind as an all-in but keeps the nominal BB at £10', () => {
    let s = newGame(['A', 'B', 'C'], [5000, 6, 5000]);
    s = startHand(s, { firstSmallBlindSeat: 0 });
    expect(s.players[1].streetBet).toBe(6);
    expect(s.players[1].allIn).toBe(true);
    expect(s.currentBet).toBe(10);
    expect(getLegalActions(s, 'c')!.call).toBe(10);
  });
});

describe('turn order', () => {
  it('with 3+ players, preflop starts left of the BB and postflop at the SB seat', () => {
    let s = startHand(newGame(['A', 'B', 'C', 'D', 'E']), { firstSmallBlindSeat: 2 });
    expect([s.sbSeat, s.bbSeat]).toEqual([2, 3]);
    expect(actorId(s)).toBe('e');
    s = play(s, [['e', 'call'], ['a', 'call'], ['b', 'call'], ['c', 'call'], ['d', 'check']]);
    expect(s.street).toBe('flop');
    expect(actorId(s)).toBe('c');
  });

  it('postflop skips a folded small blind', () => {
    let s = startHand(newGame(['A', 'B', 'C']), { firstSmallBlindSeat: 0 });
    s = play(s, [['c', 'call'], ['a', 'fold'], ['b', 'check']]);
    expect(s.street).toBe('flop');
    expect(actorId(s)).toBe('b');
  });

  it('heads-up: SB acts first preflop, BB acts first after the flop', () => {
    let s = startHand(newGame(['A', 'B']), { firstSmallBlindSeat: 0 });
    expect([s.sbSeat, s.bbSeat]).toEqual([0, 1]);
    expect(actorId(s)).toBe('a');
    s = play(s, [['a', 'call'], ['b', 'check']]);
    expect(s.street).toBe('flop');
    expect(actorId(s)).toBe('b');
    s = play(s, [['b', 'check'], ['a', 'check']]);
    expect(s.street).toBe('turn');
    expect(actorId(s)).toBe('b');
    // Next hand: blinds swap.
    s = play(s, [['b', 'bet', 10], ['a', 'fold']]);
    s = startHand(s);
    expect([s.sbSeat, s.bbSeat]).toEqual([1, 0]);
    expect(actorId(s)).toBe('b');
  });

  it('switches to heads-up order once eliminations leave two players', () => {
    let s = newGame(['A', 'B', 'C'], [5000, 5000, 100]);
    const deck = stackedDeck([0, 1, 2], { 0: ['2c', '7d'], 1: ['Ac', 'As'], 2: ['4c', '9d'] }, ['Kh', 'Qd', '6s', '2h', 'Jc']);
    s = startHand(s, { firstSmallBlindSeat: 0, deck });
    s = play(s, [['c', 'allin'], ['a', 'fold'], ['b', 'call']]);
    expect(s.players[2].eliminated).toBe(true);
    s = startHand(s);
    // Previous BB seat 1 -> next survivor is seat 0 (BB); seat 1 posts SB.
    expect([s.sbSeat, s.bbSeat]).toEqual([1, 0]);
    expect(s.playersInHand).toBe(2);
    expect(actorId(s)).toBe('b'); // SB first preflop
    s = play(s, [['b', 'call'], ['a', 'check']]);
    expect(actorId(s)).toBe('a'); // BB first postflop
  });
});

describe("big blind's option", () => {
  it('gives the BB a check-or-raise option when everyone limps', () => {
    let s = startHand(newGame(['A', 'B', 'C', 'D', 'E']), { firstSmallBlindSeat: 0 });
    s = play(s, [['c', 'call'], ['d', 'call'], ['e', 'call'], ['a', 'call']]);
    expect(s.street).toBe('preflop');
    expect(actorId(s)).toBe('b');
    const legal = getLegalActions(s, 'b')!;
    expect(legal.canCheck).toBe(true);
    expect(legal.canFold).toBe(false);
    expect(legal.raise).toEqual({ min: 20, max: 5000 });
    const checked = play(s, [['b', 'check']]);
    expect(checked.street).toBe('flop');
    // Or the BB raises, and action continues around.
    const raised = play(s, [['b', 'raise', 40]]);
    expect(raised.street).toBe('preflop');
    expect(actorId(raised)).toBe('c');
  });

  it('gives the BB the option when everyone else folds to a limping SB', () => {
    let s = startHand(newGame(['A', 'B', 'C']), { firstSmallBlindSeat: 0 });
    s = play(s, [['c', 'fold'], ['a', 'call']]);
    expect(actorId(s)).toBe('b');
    expect(getLegalActions(s, 'b')!.canCheck).toBe(true);
  });

  it('when everyone folds to the BB, the BB wins and keeps cards private', () => {
    let s = startHand(newGame(['A', 'B', 'C']), { firstSmallBlindSeat: 0 });
    s = play(s, [['c', 'fold'], ['a', 'fold']]);
    expect(s.phase).toBe('handComplete');
    expect(s.lastResult!.uncontested).toBe(true);
    expect(s.lastResult!.showdown).toBeNull();
    expect(s.players[1].stack).toBe(5005);
    const view = getPlayerView(s, 'a');
    expect(view.players[1].holeCards).toBeNull();
  });
});

describe('minimum bets and raises', () => {
  it('requires a raise at least as large as the previous raise increment', () => {
    let s = startHand(newGame(['A', 'B', 'C', 'D']), { firstSmallBlindSeat: 0 });
    expect(getLegalActions(s, 'c')!.raise!.min).toBe(20);
    s = play(s, [['c', 'raise', 30]]);
    const legal = getLegalActions(s, 'd')!;
    expect(legal.raise!.min).toBe(50);
    expect(() => applyAction(s, 'd', { type: 'raise', amount: 40 })).toThrow(IllegalActionError);
    s = play(s, [['d', 'raise', 100]]);
    expect(getLegalActions(s, 'a')!.raise!.min).toBe(170);
  });

  it('opening bet minimum is £10 after the flop and amounts must be whole pounds', () => {
    let s = startHand(newGame(['A', 'B', 'C']), { firstSmallBlindSeat: 0 });
    s = play(s, [['c', 'call'], ['a', 'call'], ['b', 'check']]);
    expect(actorId(s)).toBe('a');
    const legal = getLegalActions(s, 'a')!;
    expect(legal.bet).toEqual({ min: 10, max: 4990 });
    expect(legal.raise).toBeNull();
    expect(() => applyAction(s, 'a', { type: 'bet', amount: 9 })).toThrow(IllegalActionError);
    expect(() => applyAction(s, 'a', { type: 'bet', amount: 10.5 })).toThrow(IllegalActionError);
    expect(() => applyAction(s, 'a', { type: 'bet', amount: 5000 })).toThrow(IllegalActionError);
    s = play(s, [['a', 'bet', 25]]);
    expect(getLegalActions(s, 'b')!.raise!.min).toBe(50);
  });

  it('rejects out-of-turn actions', () => {
    const s = startHand(newGame(['A', 'B', 'C']), { firstSmallBlindSeat: 0 });
    expect(() => applyAction(s, 'a', { type: 'call' })).toThrow('Not your turn');
  });

  it('does not offer fold when checking is possible, or check when facing a bet', () => {
    const s = startHand(newGame(['A', 'B', 'C']), { firstSmallBlindSeat: 0 });
    expect(() => applyAction(s, 'c', { type: 'check' })).toThrow(IllegalActionError);
  });
});

describe('all-ins', () => {
  it('a short all-in raise does not reopen betting for a player who already acted', () => {
    // A SB, B BB, C UTG, D has only £150.
    let s = newGame(['A', 'B', 'C', 'D'], [5000, 5000, 5000, 150]);
    s = startHand(s, { firstSmallBlindSeat: 0 });
    s = play(s, [['c', 'raise', 100]]); // full raise, increment 90
    expect(s.minRaise).toBe(90);
    s = play(s, [['d', 'allin']]); // to 150: increment 50 < 90, short
    expect(s.currentBet).toBe(150);
    expect(s.minRaise).toBe(90);
    s = play(s, [['a', 'fold'], ['b', 'fold']]);
    expect(actorId(s)).toBe('c');
    const legal = getLegalActions(s, 'c')!;
    expect(legal.call).toBe(50);
    expect(legal.raise).toBeNull();
    expect(legal.allIn).toBeNull();
    expect(() => applyAction(s, 'c', { type: 'raise', amount: 300 })).toThrow(IllegalActionError);
  });

  it('players who have not acted may still raise over a short all-in', () => {
    let s = newGame(['A', 'B', 'C', 'D'], [5000, 5000, 5000, 150]);
    s = startHand(s, { firstSmallBlindSeat: 0 });
    s = play(s, [['c', 'raise', 100], ['d', 'allin']]);
    const legal = getLegalActions(s, 'a')!;
    expect(legal.raise!.min).toBe(240); // 150 + last full raise of 90
  });

  it('cumulative short all-ins that add up to a full raise reopen the betting', () => {
    let s = newGame(['A', 'B', 'C', 'D'], [220, 5000, 5000, 150]);
    s = startHand(s, { firstSmallBlindSeat: 0 });
    s = play(s, [['c', 'raise', 100], ['d', 'allin'], ['a', 'allin'], ['b', 'fold']]);
    expect(s.currentBet).toBe(220);
    expect(actorId(s)).toBe('c');
    const legal = getLegalActions(s, 'c')!;
    // 220 - 100 = 120 >= 90, so C may raise again.
    expect(legal.raise!.min).toBe(310);
  });

  it('returns an uncalled excess to the bettor', () => {
    let s = newGame(['A', 'B', 'C'], [5000, 5000, 300]);
    s = startHand(s, { firstSmallBlindSeat: 0 });
    s = play(s, [['c', 'allin'], ['a', 'raise', 1000], ['b', 'fold']]);
    // A's 1000 is called only to 300; 700 comes back. Board runs out to showdown.
    expect(s.phase).toBe('handComplete');
    expect(s.log.some((e) => e.kind === 'uncalled' && e.amount === 700)).toBe(true);
    expect(s.players[0].stack + s.players[2].stack).toBe(5000 + 300 + 10);
    assertChipConservation(s);
  });

  it('a player all-in for less than a call can still win only what they matched', () => {
    let s = newGame(['A', 'B', 'C'], [5000, 5000, 50]);
    const deck = stackedDeck([0, 1, 2], { 0: ['Kc', 'Kd'], 1: ['Qc', 'Qd'], 2: ['Ac', 'Ad'] }, ['2h', '7s', '9d', '3c', '4h']);
    s = startHand(s, { firstSmallBlindSeat: 0, deck });
    s = play(s, [['c', 'allin'], ['a', 'raise', 200], ['b', 'call']]);
    expect(s.street).toBe('flop');
    s = play(s, [['a', 'bet', 500], ['b', 'fold']]);
    expect(s.phase).toBe('handComplete');
    // C wins the main pot of 150 (50 x 3); A wins the side pot (150+150 from preflop) and gets 500 back uncalled.
    const c = s.lastResult!.winners.find((w) => w.playerId === 'c')!;
    expect(c.amount).toBe(150);
    expect(s.players[2].stack).toBe(150);
    expect(s.players[0].stack).toBe(5000 - 200 + 300);
    assertChipConservation(s);
  });

  it('runs out the board when no further betting is possible', () => {
    let s = startHand(newGame(['A', 'B']), { firstSmallBlindSeat: 0 });
    s = play(s, [['a', 'allin'], ['b', 'call']]);
    expect(s.board).toHaveLength(5);
    expect(['handComplete', 'gameOver']).toContain(s.phase);
    expect(s.lastResult!.showdown).toHaveLength(2);
  });
});

describe('side pots', () => {
  it('awards main and side pots only to eligible players', () => {
    let s = newGame(['A', 'B', 'C'], [1000, 3000, 5000]);
    const deck = stackedDeck([0, 1, 2], {
      0: ['Ac', 'Ad'], // best
      1: ['Kc', 'Kd'], // second
      2: ['Qc', 'Qd'], // worst
    }, ['2h', '7s', '9d', '3c', '4h']);
    s = startHand(s, { firstSmallBlindSeat: 0, deck });
    s = play(s, [['c', 'allin'], ['a', 'call'], ['b', 'call']]);
    expect(s.phase).toBe('handComplete');
    const r = s.lastResult!;
    expect(r.pots.map((p) => [p.label, p.amount, p.winners.map((w) => w.playerId)])).toEqual([
      ['Main pot', 3000, ['a']],
      ['Side pot', 4000, ['b']],
    ]);
    expect(s.players.map((p) => p.stack)).toEqual([3000, 4000, 2000]);
    expect(r.eliminated).toEqual([]);
  });

  it("keeps a folded player's chips in the pot but never lets them win it", () => {
    let s = newGame(['A', 'B', 'C', 'D'], [5000, 5000, 400, 5000]);
    const deck = stackedDeck([0, 1, 2, 3], {
      0: ['2c', '7d'], 1: ['Kc', 'Kd'], 2: ['Ac', 'Ad'], 3: ['As', 'Ah'],
    }, ['2h', '7s', '9d', '3c', '4h']);
    s = startHand(s, { firstSmallBlindSeat: 0, deck });
    // D would win, but folds after putting in £100.
    s = play(s, [['c', 'call'], ['d', 'raise', 100], ['a', 'fold'], ['b', 'call'], ['c', 'allin'], ['d', 'fold'], ['b', 'call']]);
    expect(s.phase).toBe('handComplete');
    const r = s.lastResult!;
    expect(r.showdown!.map((h) => h.playerId).sort()).toEqual(['b', 'c']);
    // C (AA) beats B (KK): pot = 5 (A) + 400 (B) + 400 (C) + 100 (D)
    expect(r.winners).toEqual([expect.objectContaining({ playerId: 'c', amount: 905 })]);
    assertChipConservation(s);
  });

  it('three-way all-in with three different stacks', () => {
    let s = newGame(['A', 'B', 'C', 'D'], [500, 1500, 3000, 5000]);
    const deck = stackedDeck([0, 1, 2, 3], {
      0: ['Ac', 'Ad'], 1: ['Kc', 'Kd'], 2: ['Qc', 'Qd'], 3: ['Jc', 'Jd'],
    }, ['2h', '7s', '9d', '3c', '4h']);
    s = startHand(s, { firstSmallBlindSeat: 0, deck });
    s = play(s, [['c', 'allin'], ['d', 'call'], ['a', 'call'], ['b', 'call']]);
    const r = s.lastResult!;
    expect(r.pots.map((p) => [p.amount, p.winners[0].playerId])).toEqual([
      [2000, 'a'], // 500 x 4
      [3000, 'b'], // 1000 x 3
      [3000, 'c'], // 1500 x 2
    ]);
    expect(s.players.map((p) => p.stack)).toEqual([2000, 3000, 3000, 2000]);
  });
});

describe('ties and playing the board', () => {
  it('splits the pot when everyone plays the board, odd chip clockwise from the SB', () => {
    let s = newGame(['A', 'B', 'C']);
    const deck = stackedDeck([0, 1, 2], { 0: ['2c', '3d'], 1: ['4c', '5d'], 2: ['6c', '7d'] }, ['Ah', 'Kh', 'Qh', 'Jh', 'Th']);
    s = startHand(s, { firstSmallBlindSeat: 0, deck });
    // C calls, SB folds (£5 dead), BB checks: pot £25.
    s = play(s, [['c', 'call'], ['a', 'fold'], ['b', 'check']]);
    expect(actorId(s)).toBe('b');
    s = play(s, [['b', 'check'], ['c', 'check'], ['b', 'check'], ['c', 'check'], ['b', 'check'], ['c', 'check']]);
    const r = s.lastResult!;
    expect(r.pots[0].amount).toBe(25);
    expect(r.pots[0].handDescription).toBe('Royal Flush');
    // Clockwise from the SB seat (0): seat 1 (B) is first among the tied winners.
    expect(r.pots[0].winners).toEqual([
      { playerId: 'b', name: 'B', amount: 13 },
      { playerId: 'c', name: 'C', amount: 12 },
    ]);
    expect(s.players.map((p) => p.stack)).toEqual([4995, 5003, 5002]);
  });

  it('splits between players with the same kicker but not different kickers', () => {
    let s = newGame(['A', 'B', 'C']);
    // Board pairs aces; A and B both have a K kicker, C has Q.
    const deck = stackedDeck([0, 1, 2], { 0: ['Kc', '2d'], 1: ['Kd', '3c'], 2: ['Qc', '4d'] }, ['As', 'Ah', '9c', '8d', '6s']);
    s = startHand(s, { firstSmallBlindSeat: 0, deck });
    s = play(s, [['c', 'call'], ['a', 'call'], ['b', 'check']]);
    for (let i = 0; i < 3; i++) s = play(s, [['a', 'check'], ['b', 'check'], ['c', 'check']]);
    const pot = s.lastResult!.pots[0];
    expect(pot.amount).toBe(30);
    expect(pot.winners.map((w) => [w.playerId, w.amount])).toEqual([['a', 15], ['b', 15]]);
  });
});

describe('chip conservation and bots', () => {
  function randomAction(s: GameState, rng: () => number) {
    const id = s.players[s.toAct!].id;
    const legal = getLegalActions(s, id)!;
    const options: { type: string; amount?: number }[] = [];
    if (legal.canFold) options.push({ type: 'fold' });
    if (legal.canCheck) options.push({ type: 'check' });
    if (legal.call !== null) options.push({ type: 'call' }, { type: 'call' });
    const range = legal.bet ?? legal.raise;
    if (range) options.push({ type: legal.bet ? 'bet' : 'raise', amount: range.min + Math.floor(rng() * (range.max - range.min + 1)) });
    if (legal.allIn !== null) options.push({ type: 'allin' });
    const pick = options[Math.floor(rng() * options.length)];
    return { id, action: pick as never };
  }

  it('stacks plus committed chips always total £25,000 through full random games', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = seededRng(seed);
      let s = createGame(['A', 'B', 'C', 'D', 'E'].map((n) => ({ id: n, name: n })));
      expect(s.totalChips).toBe(25000);
      let hands = 0;
      while (s.phase !== 'gameOver' && hands < 400) {
        s = startHand(s, { rng });
        hands++;
        expect(chipsAccountedFor(s)).toBe(25000);
        while (s.phase === 'betting') {
          const { id, action } = randomAction(s, rng);
          s = applyAction(s, id, action);
          expect(chipsAccountedFor(s)).toBe(25000);
        }
        expect(s.players.every((p) => p.committed === 0)).toBe(true);
      }
      if (s.phase === 'gameOver') {
        const winner = s.players.find((p) => p.id === s.winnerId)!;
        expect(winner.stack).toBe(25000);
        expect(s.players.filter((p) => !p.eliminated)).toHaveLength(1);
      }
    }
  });

  it('bots always choose legal actions using only their own view', () => {
    const profiles = Object.values(BOT_PROFILES);
    const rng = seededRng(99);
    let s = createGame(['A', 'B', 'C', 'D', 'E'].map((n) => ({ id: n, name: n })));
    for (let h = 0; h < 25 && s.phase !== 'gameOver'; h++) {
      s = startHand(s, { rng });
      while (s.phase === 'betting') {
        const id = s.players[s.toAct!].id;
        const view = getPlayerView(s, id);
        // The bot's view contains no other player's cards and no deck.
        expect('deck' in view).toBe(false);
        for (const p of view.players) if (p.id !== id) expect(p.holeCards).toBeNull();
        const action = decideBotAction(view, profiles[s.toAct! % profiles.length], rng);
        s = applyAction(s, id, action); // throws if illegal
        assertChipConservation(s);
      }
    }
  });
});
