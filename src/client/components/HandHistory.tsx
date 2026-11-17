import { useState } from 'react';
import { formatGBP, type HandResult, type LogEntry } from '../../engine';
import { PlayingCard } from './Card';

export function HandHistory({ history, log }: { history: HandResult[]; log: LogEntry[] }) {
  const [tab, setTab] = useState<'hands' | 'log'>('hands');
  const hands = [...history].reverse();
  return (
    <aside className="history">
      <div className="history-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'hands'} className={tab === 'hands' ? 'active' : ''} onClick={() => setTab('hands')}>
          Hand history
        </button>
        <button role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>
          This hand
        </button>
      </div>
      {tab === 'hands' ? (
        <ol className="history-list">
          {hands.length === 0 && <li className="muted">No completed hands yet.</li>}
          {hands.map((h) => (
            <li key={h.handNumber}>
              <div className="history-head">
                <strong>#{h.handNumber}</strong>
                <span className="history-board">
                  {h.board.length ? h.board.map((c) => <PlayingCard key={c} card={c} size="sm" />) : <em className="muted">no flop</em>}
                </span>
              </div>
              {h.pots.map((p, i) => (
                <div key={i} className="history-pot">
                  {p.label} {formatGBP(p.amount)}: {p.winners.map((w) => `${w.name} ${formatGBP(w.amount)}`).join(', ')}
                  {p.handDescription ? <span className="muted"> — {p.handDescription}</span> : <span className="muted"> — uncontested</span>}
                </div>
              ))}
              {h.showdown && (
                <div className="history-shows">
                  {h.showdown.map((s) => (
                    <span key={s.playerId} className="history-show">
                      {s.name}: {s.holeCards.map((c) => <PlayingCard key={c} card={c} size="sm" />)}
                    </span>
                  ))}
                </div>
              )}
              {h.eliminated.length > 0 && (
                <div className="history-out">Out: {h.eliminated.map((e) => e.name).join(', ')}</div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <ol className="history-log">
          {log.map((e, i) => (
            <li key={i} className={`log-${e.kind}`}>{e.text}</li>
          ))}
        </ol>
      )}
    </aside>
  );
}
