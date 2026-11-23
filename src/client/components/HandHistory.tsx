import { useEffect, useState } from 'react';
import { formatGBP, type HandResult, type LogEntry } from '../../engine';
import { logText, nameFor, type Viewer } from '../text';
import { PlayingCard } from './Card';

const STORAGE_KEY = 'poker:historyOpen';

/** Open/closed state for the history drawer, remembered per browser. */
export function useHistoryDrawer() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return { open, setOpen, toggle: () => setOpen((o) => !o) };
}

export function HistoryButton({ open, onClick, count }: { open: boolean; onClick: () => void; count: number }) {
  return (
    <button className={`btn btn-sm history-toggle${open ? ' active' : ''}`} onClick={onClick} aria-expanded={open} aria-controls="hand-history">
      {open ? 'Hide history' : 'Hand history'}
      {count > 0 && !open && <span className="history-count">{count}</span>}
    </button>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  history: HandResult[];
  log: LogEntry[];
  me: Viewer | null;
}

/** Slide-in drawer with past hands and the current hand's action log. */
export function HandHistory({ open, onClose, history, log, me }: Props) {
  const [tab, setTab] = useState<'hands' | 'log'>('hands');
  const hands = [...history].reverse();
  return (
    <>
      <div className={`drawer-backdrop${open ? ' open' : ''}`} onClick={onClose} aria-hidden />
      <aside id="hand-history" className={`history drawer${open ? ' open' : ''}`} aria-hidden={!open} aria-label="Hand history">
        <div className="drawer-head">
          <strong>History</strong>
          <button className="link-btn drawer-close" onClick={onClose} aria-label="Close history">✕</button>
        </div>
        <div className="history-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'hands'} className={tab === 'hands' ? 'active' : ''} onClick={() => setTab('hands')}>
            Past hands
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
                    {p.label} {formatGBP(p.amount)}: {p.winners.map((w) => `${nameFor(w.playerId, w.name, me)} ${formatGBP(w.amount)}`).join(', ')}
                    {p.handDescription ? <span className="muted"> — {p.handDescription}</span> : <span className="muted"> — uncontested</span>}
                  </div>
                ))}
                {h.showdown && (
                  <div className="history-shows">
                    {h.showdown.map((s) => (
                      <span key={s.playerId} className="history-show">
                        {nameFor(s.playerId, s.name, me)}: {s.holeCards.map((c) => <PlayingCard key={c} card={c} size="sm" />)}
                      </span>
                    ))}
                  </div>
                )}
                {h.eliminated.length > 0 && (
                  <div className="history-out">Out: {h.eliminated.map((e) => nameFor(e.playerId, e.name, me)).join(', ')}</div>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <ol className="history-log">
            {log.map((e, i) => (
              <li key={i} className={`log-${e.kind}`}>{logText(e, me)}</li>
            ))}
          </ol>
        )}
      </aside>
    </>
  );
}
