import { type Card, type Rng, freshDeck } from './cards';
import { evaluateHand } from './evaluator';
import type { Action, PlayerView } from './types';

/**
 * Computer opponents. A bot only ever receives a PlayerView built for its own seat,
 * so it sees its own hole cards, the board, stacks, bets and the action log — never
 * another player's hidden cards or the deck.
 */
export interface BotProfile {
  style: string;
  /** 0..1: how often and how big it bets and raises. */
  aggression: number;
  /** Added to equity when deciding to continue (positive = looser). */
  looseness: number;
  /** Probability of betting/raising without a strong hand. */
  bluff: number;
}

export const BOT_PROFILES: Record<string, BotProfile> = {
  rock: { style: 'Tight-passive', aggression: 0.2, looseness: -0.06, bluff: 0.02 },
  station: { style: 'Loose-passive', aggression: 0.3, looseness: 0.12, bluff: 0.04 },
  shark: { style: 'Tight-aggressive', aggression: 0.65, looseness: 0.0, bluff: 0.1 },
  maniac: { style: 'Loose-aggressive', aggression: 0.95, looseness: 0.08, bluff: 0.25 },
};

/** Monte Carlo equity of `hole` against `opponents` random hands, given the known board. */
export function estimateEquity(hole: Card[], board: Card[], opponents: number, iterations: number, rng: Rng): number {
  if (opponents <= 0) return 1;
  const known = new Set([...hole, ...board]);
  const unknown = freshDeck().filter((c) => !known.has(c));
  let score = 0;
  const need = opponents * 2 + (5 - board.length);
  for (let it = 0; it < iterations; it++) {
    // Partial Fisher-Yates for just the cards we need.
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (unknown.length - i));
      [unknown[i], unknown[j]] = [unknown[j], unknown[i]];
    }
    const runout = board.concat(unknown.slice(opponents * 2, need));
    const mine = evaluateHand([...hole, ...runout]).score;
    let ties = 0;
    let lost = false;
    for (let o = 0; o < opponents; o++) {
      const theirs = evaluateHand([unknown[o * 2], unknown[o * 2 + 1], ...runout]).score;
      if (theirs > mine) { lost = true; break; }
      if (theirs === mine) ties++;
    }
    if (!lost) score += 1 / (ties + 1);
  }
  return score / iterations;
}

export function decideBotAction(view: PlayerView, profile: BotProfile, rng: Rng = Math.random): Action {
  const legal = view.legal;
  const me = view.players.find((p) => p.id === view.viewerId);
  if (!legal || !me || !me.holeCards) throw new Error('Bot asked to act when it cannot');

  const opponents = view.players.filter((p) => p.id !== me.id && p.inHand && !p.folded).length;
  const equity = estimateEquity(me.holeCards, view.board, opponents, view.board.length ? 300 : 200, rng);
  const pot = legal.pot;
  const potOdds = legal.toCall > 0 ? legal.toCall / (pot + legal.toCall) : 0;

  // Betting history: how much aggression has there been this street and this hand?
  const streetEntries = view.log.filter((e) => e.street === view.street);
  const raisesThisStreet = streetEntries.filter((e) => e.kind === 'bet' || e.kind === 'raise').length;
  const raisesThisHand = view.log.filter((e) => e.kind === 'bet' || e.kind === 'raise').length;

  // Equity relative to a fair share of the pot (1.0 = average hand among live players).
  const relative = equity * (opponents + 1);
  const pressure = 0.18 * raisesThisStreet + 0.05 * raisesThisHand;
  const valueThreshold = 1.75 - 0.6 * profile.aggression + pressure;
  const strong = relative > valueThreshold;
  const monster = relative > valueThreshold + 0.6 || equity > 0.85;

  const wantsAggression = strong || (rng() < profile.bluff && raisesThisStreet < 2);
  const sizeTo = (base: number, min: number, max: number) => {
    const frac = 0.45 + profile.aggression * 0.55 * rng() + (monster ? 0.3 : 0);
    const target = Math.round(base + Math.max(min - base, pot * frac));
    return Math.max(min, Math.min(max, target));
  };

  if (wantsAggression) {
    if (legal.bet) {
      if (monster && profile.aggression > 0.8 && rng() < 0.25) return { type: 'allin' };
      return { type: 'bet', amount: sizeTo(0, legal.bet.min, legal.bet.max) };
    }
    if (legal.raise && (strong || legal.toCall <= pot * 0.25)) {
      if (monster && rng() < 0.15 + profile.aggression * 0.2) return { type: 'allin' };
      const amt = sizeTo(legal.currentBet, legal.raise.min, legal.raise.max);
      // Do not shove a marginal stack in on a bluff.
      if (!strong && amt > legal.stack * 0.4 + legal.streetBet) {
        return legal.canCheck ? { type: 'check' } : continueOrFold();
      }
      return { type: 'raise', amount: amt };
    }
  }

  if (legal.canCheck) return { type: 'check' };
  return continueOrFold();

  function continueOrFold(): Action {
    if (legal!.call === null) return { type: 'fold' };
    // Bigger calls relative to stack demand more equity.
    const commitment = legal!.call / Math.max(1, legal!.stack + legal!.streetBet);
    const needed = potOdds + 0.08 * commitment + 0.04 * raisesThisStreet - profile.looseness;
    if (equity >= needed || (legal!.call <= view.config.bigBlind && equity > 0.12 + -profile.looseness)) {
      return { type: 'call' };
    }
    return { type: 'fold' };
  }
}
