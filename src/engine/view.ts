import { computePots } from './pots';
import { getLegalActions, potTotal } from './game';
import type { GameState, PlayerView, PublicPlayer } from './types';

/**
 * Build what one viewer is allowed to see. Other players' hole cards are only included
 * when they were shown at showdown. The deck (including burn cards) is never included.
 * Pass viewerId = null for a spectator.
 */
export function getPlayerView(s: GameState, viewerId: string | null, historyLimit = 50): PlayerView {
  const revealed = new Map<string, string[]>();
  if ((s.phase === 'handComplete' || s.phase === 'gameOver') && s.lastResult?.showdown) {
    for (const h of s.lastResult.showdown) revealed.set(h.playerId, h.holeCards);
  }

  const players: PublicPlayer[] = s.players.map((p) => {
    const { holeCards, ...rest } = p;
    let visible: string[] | null = null;
    if (p.id === viewerId && holeCards.length) visible = holeCards.slice();
    else if (revealed.has(p.id)) visible = revealed.get(p.id)!.slice();
    return { ...rest, holeCards: visible, hasCards: holeCards.length > 0 && p.inHand && !p.folded };
  });

  // Pots from chips already gathered (previous streets); current street bets are shown per seat.
  const gathered = s.players
    .filter((p) => p.inHand)
    .map((p) => ({ id: p.id, committed: p.committed - p.streetBet, folded: p.folded }));
  const pots = s.phase === 'betting' ? computePots(gathered) : [];

  return {
    viewerId,
    config: { ...s.config },
    players,
    totalChips: s.totalChips,
    handNumber: s.handNumber,
    phase: s.phase,
    street: s.street,
    board: s.board.slice(),
    sbSeat: s.sbSeat,
    bbSeat: s.bbSeat,
    playersInHand: s.playersInHand,
    currentBet: s.currentBet,
    minRaise: s.minRaise,
    toAct: s.toAct,
    toActId: s.toAct !== null ? s.players[s.toAct].id : null,
    actionSeq: s.actionSeq,
    log: s.log.map((e) => ({ ...e })),
    lastResult: s.lastResult ? structuredClone(s.lastResult) : null,
    history: structuredClone(s.history.slice(-historyLimit)),
    winnerId: s.winnerId,
    pots,
    potTotal: potTotal(s),
    legal: viewerId ? getLegalActions(s, viewerId) : null,
  };
}
