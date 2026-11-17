export interface Contribution {
  id: string;
  committed: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** Player ids who can win this pot (not folded, contributed at least this level). */
  eligible: string[];
}

/**
 * Build the main pot and side pots from each player's total contribution this hand.
 * Folded players' chips stay in the pots they reached, but they are never eligible.
 * Adjacent pots with the same eligible players are merged.
 */
export function computePots(contribs: Contribution[]): Pot[] {
  const live = contribs.filter((c) => !c.folded && c.committed > 0);
  const levels = [...new Set(live.map((c) => c.committed))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contribs) amount += Math.max(0, Math.min(c.committed, level) - prev);
    const eligible = live.filter((c) => c.committed >= level).map((c) => c.id);
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  // Chips from folded players above the highest live level (normally none once uncalled bets are returned).
  let leftover = 0;
  for (const c of contribs) leftover += Math.max(0, c.committed - prev);
  if (leftover > 0) {
    if (pots.length) pots[pots.length - 1].amount += leftover;
    else pots.push({ amount: leftover, eligible: live.map((c) => c.id) });
  }

  const merged: Pot[] = [];
  for (const p of pots) {
    const last = merged[merged.length - 1];
    if (last && sameSet(last.eligible, p.eligible)) last.amount += p.amount;
    else merged.push({ amount: p.amount, eligible: [...p.eligible] });
  }
  return merged;
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}
