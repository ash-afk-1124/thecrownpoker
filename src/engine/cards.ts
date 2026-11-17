/**
 * Cards are two-character strings: rank then suit, e.g. "As", "Td", "7c".
 * Ranks: 2-9, T, J, Q, K, A. Suits: c, d, h, s.
 */
export type Card = string;

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';

/** A random number generator returning a float in [0, 1). */
export type Rng = () => number;

export function rankOf(card: Card): number {
  return RANKS.indexOf(card[0]) + 2;
}

export function suitOf(card: Card): string {
  return card[1];
}

export function isCard(value: unknown): value is Card {
  return typeof value === 'string' && /^[2-9TJQKA][cdhs]$/.test(value);
}

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

/** Cryptographically strong RNG (works in browsers and Node 20+). */
export const secureRandom: Rng = () => {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
};

/** Fisher-Yates shuffle. Returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng = secureRandom): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Deterministic seeded RNG (mulberry32), useful for tests and replays. */
export function seededRng(seed: number): Rng {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const RANK_NAMES: Record<number, string> = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
  9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};

export function rankName(rank: number): string {
  return RANK_NAMES[rank === 1 ? 14 : rank];
}

export function rankPlural(rank: number): string {
  const n = rankName(rank);
  return n === 'Six' ? 'Sixes' : n + 's';
}
