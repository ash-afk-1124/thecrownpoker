import { type Card, rankOf, suitOf, rankName, rankPlural } from './cards';

export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAMES: Record<HandCategory, string> = {
  [HandCategory.HighCard]: 'High Card',
  [HandCategory.Pair]: 'Pair',
  [HandCategory.TwoPair]: 'Two Pair',
  [HandCategory.ThreeOfAKind]: 'Three of a Kind',
  [HandCategory.Straight]: 'Straight',
  [HandCategory.Flush]: 'Flush',
  [HandCategory.FullHouse]: 'Full House',
  [HandCategory.FourOfAKind]: 'Four of a Kind',
  [HandCategory.StraightFlush]: 'Straight Flush',
};

export interface HandValue {
  category: HandCategory;
  /** Tie-break ranks, most significant first (ace-low straight uses 5 as its high card). */
  ranks: number[];
  /** Single comparable number: higher is better, equal means a tie. */
  score: number;
  /** The best five cards. */
  cards: Card[];
  description: string;
}

function makeScore(category: HandCategory, ranks: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 15 + (ranks[i] ?? 0);
  return score;
}

const byRankDesc = (a: Card, b: Card) => rankOf(b) - rankOf(a);

/** Returns the best straight inside `cards` (any suits), or null. */
function findStraight(cards: Card[]): { high: number; cards: Card[] } | null {
  const byRank = new Map<number, Card>();
  for (const c of cards) if (!byRank.has(rankOf(c))) byRank.set(rankOf(c), c);
  for (let high = 14; high >= 5; high--) {
    const run: Card[] = [];
    for (let r = high; r > high - 5; r--) {
      const card = byRank.get(r === 1 ? 14 : r);
      if (!card) break;
      run.push(card);
    }
    if (run.length === 5) return { high, cards: run };
  }
  return null;
}

/** Evaluate the best five-card hand from 5 to 7 cards. */
export function evaluateHand(cards: Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) throw new Error('evaluateHand needs 5-7 cards');
  const sorted = cards.slice().sort(byRankDesc);

  const suitGroups = new Map<string, Card[]>();
  for (const c of sorted) {
    const g = suitGroups.get(suitOf(c)) ?? [];
    g.push(c);
    suitGroups.set(suitOf(c), g);
  }
  const flushCards = [...suitGroups.values()].find((g) => g.length >= 5) ?? null;

  if (flushCards) {
    const sf = findStraight(flushCards);
    if (sf) return finish(HandCategory.StraightFlush, [sf.high], sf.cards);
  }

  const rankGroups = new Map<number, Card[]>();
  for (const c of sorted) {
    const g = rankGroups.get(rankOf(c)) ?? [];
    g.push(c);
    rankGroups.set(rankOf(c), g);
  }
  // Sort groups by size then rank, descending.
  const groups = [...rankGroups.entries()]
    .map(([rank, cs]) => ({ rank, cards: cs }))
    .sort((a, b) => b.cards.length - a.cards.length || b.rank - a.rank);

  const kickers = (exclude: Card[], n: number) =>
    sorted.filter((c) => !exclude.includes(c)).slice(0, n);

  if (groups[0].cards.length === 4) {
    const quad = groups[0].cards;
    const k = kickers(quad, 1);
    return finish(HandCategory.FourOfAKind, [groups[0].rank, rankOf(k[0])], [...quad, ...k]);
  }

  const trips = groups.filter((g) => g.cards.length === 3);
  const pairs = groups.filter((g) => g.cards.length === 2);
  if (trips.length >= 1 && trips.length + pairs.length >= 2) {
    const t = trips[0];
    const pairCandidates = [...trips.slice(1), ...pairs].sort((a, b) => b.rank - a.rank);
    const p = pairCandidates[0];
    return finish(HandCategory.FullHouse, [t.rank, p.rank], [...t.cards, ...p.cards.slice(0, 2)]);
  }

  if (flushCards) {
    const five = flushCards.slice(0, 5);
    return finish(HandCategory.Flush, five.map(rankOf), five);
  }

  const straight = findStraight(sorted);
  if (straight) return finish(HandCategory.Straight, [straight.high], straight.cards);

  if (trips.length === 1) {
    const t = trips[0];
    const k = kickers(t.cards, 2);
    return finish(HandCategory.ThreeOfAKind, [t.rank, ...k.map(rankOf)], [...t.cards, ...k]);
  }

  if (pairs.length >= 2) {
    const [p1, p2] = pairs;
    const used = [...p1.cards, ...p2.cards];
    const k = kickers(used, 1);
    return finish(HandCategory.TwoPair, [p1.rank, p2.rank, rankOf(k[0])], [...used, ...k]);
  }

  if (pairs.length === 1) {
    const p = pairs[0];
    const k = kickers(p.cards, 3);
    return finish(HandCategory.Pair, [p.rank, ...k.map(rankOf)], [...p.cards, ...k]);
  }

  const five = sorted.slice(0, 5);
  return finish(HandCategory.HighCard, five.map(rankOf), five);
}

function finish(category: HandCategory, ranks: number[], cards: Card[]): HandValue {
  return { category, ranks, score: makeScore(category, ranks), cards, description: describe(category, ranks) };
}

function describe(category: HandCategory, r: number[]): string {
  switch (category) {
    case HandCategory.StraightFlush:
      return r[0] === 14 ? 'Royal Flush' : `Straight Flush, ${rankName(r[0])} high`;
    case HandCategory.FourOfAKind:
      return `Four of a Kind, ${rankPlural(r[0])}`;
    case HandCategory.FullHouse:
      return `Full House, ${rankPlural(r[0])} full of ${rankPlural(r[1])}`;
    case HandCategory.Flush:
      return `Flush, ${rankName(r[0])} high`;
    case HandCategory.Straight:
      return `Straight, ${rankName(r[0])} high`;
    case HandCategory.ThreeOfAKind:
      return `Three of a Kind, ${rankPlural(r[0])}`;
    case HandCategory.TwoPair:
      return `Two Pair, ${rankPlural(r[0])} and ${rankPlural(r[1])}`;
    case HandCategory.Pair:
      return `Pair of ${rankPlural(r[0])}`;
    default:
      return `High Card, ${rankName(r[0])}`;
  }
}

export function compareHands(a: HandValue, b: HandValue): number {
  return a.score - b.score;
}
