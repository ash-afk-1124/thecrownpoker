import type { ReactNode } from 'react';
import { formatGBP, type PlayerView } from '../../engine';
import { nameFor, verb, type Viewer } from '../text';

/** Who won, how much, and with what hand. Children are the buttons (Next Hand / New Game). */
export function ResultPanel({ view, me, children, footer }: {
  view: PlayerView;
  me: Viewer | null;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const r = view.lastResult;
  if (!r || view.phase === 'betting') return null;
  const gameOver = view.phase === 'gameOver';
  const champion = gameOver ? view.players.find((p) => p.id === view.winnerId) : null;
  const names = (ws: { playerId: string; name: string }[]) => ws.map((w) => nameFor(w.playerId, w.name, me)).join(' & ');
  return (
    <div className={`result-panel${gameOver ? ' result-gameover' : ''}`} role="status" aria-live="polite">
      {champion && (
        <div className="result-champion">
          🏆 {nameFor(champion.id, champion.name, me)} {verb(champion.id, me, 'wins', 'win')} the game with {formatGBP(champion.stack)}!
        </div>
      )}
      <div className="result-title">Hand #{r.handNumber}</div>
      <ul className="result-lines">
        {r.pots.map((p, i) => (
          <li key={i}>
            <strong>{names(p.winners)}</strong>{' '}
            {p.winners.length > 1 ? 'split' : 'won'} the {p.label.toLowerCase()} of {formatGBP(p.amount)}
            {p.winners.length > 1 && ` (${p.winners.map((w) => formatGBP(w.amount)).join(' / ')})`}
            {p.handDescription ? ` with ${p.handDescription}` : ' — everyone else folded'}
          </li>
        ))}
        {r.eliminated.map((e) => (
          <li key={e.playerId} className="result-out">
            {nameFor(e.playerId, e.name, me)} {verb(e.playerId, me, 'is', 'are')} eliminated
          </li>
        ))}
      </ul>
      <div className="result-actions">{children}</div>
      {footer}
    </div>
  );
}
