import type { ReactNode } from 'react';
import { formatGBP, type PlayerView } from '../../engine';

/** Who won, how much, and with what hand. Children are the buttons (Next Hand / New Game). */
export function ResultPanel({ view, children, footer }: { view: PlayerView; children?: ReactNode; footer?: ReactNode }) {
  const r = view.lastResult;
  if (!r || view.phase === 'betting') return null;
  const gameOver = view.phase === 'gameOver';
  const champion = gameOver ? view.players.find((p) => p.id === view.winnerId) : null;
  return (
    <div className={`result-panel${gameOver ? ' result-gameover' : ''}`} role="status" aria-live="polite">
      {champion && (
        <div className="result-champion">
          🏆 {champion.name} wins the game with {formatGBP(champion.stack)}!
        </div>
      )}
      <div className="result-title">Hand #{r.handNumber}</div>
      <ul className="result-lines">
        {r.pots.map((p, i) => (
          <li key={i}>
            <strong>{p.winners.map((w) => w.name).join(' & ')}</strong>{' '}
            {p.winners.length > 1 ? 'split' : 'won'} the {p.label.toLowerCase()} of {formatGBP(p.amount)}
            {p.winners.length > 1 && ` (${p.winners.map((w) => formatGBP(w.amount)).join(' / ')})`}
            {p.handDescription ? ` with ${p.handDescription}` : ' — everyone else folded'}
          </li>
        ))}
        {r.eliminated.map((e) => (
          <li key={e.playerId} className="result-out">{e.name} is eliminated</li>
        ))}
      </ul>
      <div className="result-actions">{children}</div>
      {footer}
    </div>
  );
}
