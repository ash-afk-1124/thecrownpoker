import { useEffect, useState } from 'react';
import { formatGBP, type PlayerView, type PublicPlayer } from '../../engine';
import { EmptyCardSlot, PlayingCard } from './Card';

export interface SeatExtra {
  subtitle?: string;
  offline?: boolean;
}

interface Props {
  view: PlayerView;
  meId: string | null;
  extras?: Record<string, SeatExtra>;
  /** Local-clock epoch ms when the current turn ends (online only). */
  turnEndsAt?: number | null;
  turnSeconds?: number;
}

function seatPosition(index: number, count: number) {
  // index 0 is the viewer at the bottom; others go clockwise around the oval.
  const angle = Math.PI / 2 + (index * 2 * Math.PI) / count;
  return {
    seat: { left: `${50 + 47 * Math.cos(angle)}%`, top: `${50 + 50 * Math.sin(angle)}%` },
    bet: { left: `${50 + 30 * Math.cos(angle)}%`, top: `${50 + 27 * Math.sin(angle)}%` },
  };
}

export function Table({ view, meId, extras = {}, turnEndsAt, turnSeconds = 30 }: Props) {
  const n = view.players.length;
  const mySeat = view.players.find((p) => p.id === meId)?.seat ?? 0;
  const showdown = view.phase !== 'betting' && view.lastResult?.showdown;
  const winners = new Set(view.phase !== 'betting' ? view.lastResult?.winners.map((w) => w.playerId) ?? [] : []);
  const bestFive = new Set(
    view.phase !== 'betting' && view.lastResult?.showdown
      ? view.lastResult.showdown.filter((h) => winners.has(h.playerId)).flatMap((h) => h.bestFive)
      : [],
  );

  return (
    <div className="table-wrap">
      <div className="table-felt">
        <div className="table-center">
          <div className="board" aria-label="Community cards">
            {Array.from({ length: 5 }, (_, i) =>
              view.board[i] ? (
                <PlayingCard key={i} card={view.board[i]} size="lg" highlight={bestFive.has(view.board[i])} dim={!!showdown && bestFive.size > 0 && !bestFive.has(view.board[i])} />
              ) : (
                <EmptyCardSlot key={i} />
              ),
            )}
          </div>
          <PotDisplay view={view} />
        </div>

        {view.players.map((p) => {
          const idx = (p.seat - mySeat + n) % n;
          const pos = seatPosition(idx, n);
          return (
            <div key={p.id}>
              <Seat
                player={p}
                view={view}
                isMe={p.id === meId}
                isWinner={winners.has(p.id)}
                highlightCards={bestFive}
                extra={extras[p.id]}
                style={pos.seat}
                turnEndsAt={view.toActId === p.id ? turnEndsAt : null}
                turnSeconds={turnSeconds}
              />
              {p.streetBet > 0 && view.phase === 'betting' && (
                <div className="bet-chip" style={pos.bet}>
                  <span className="chip-icon" aria-hidden />
                  {formatGBP(p.streetBet)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PotDisplay({ view }: { view: PlayerView }) {
  if (view.phase !== 'betting') {
    const r = view.lastResult;
    if (!r) return null;
    return (
      <div className="pot-display">
        {r.pots.map((p, i) => (
          <div key={i} className="pot-line">
            {p.label} {formatGBP(p.amount)} → {p.winners.map((w) => w.name).join(' & ')}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="pot-display">
      <div className="pot-total">Pot {formatGBP(view.potTotal)}</div>
      {view.pots.length > 1 && (
        <div className="pot-breakdown">
          {view.pots.map((p, i) => (
            <span key={i}>{i === 0 ? 'Main' : `Side ${i}`} {formatGBP(p.amount)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

interface SeatProps {
  player: PublicPlayer;
  view: PlayerView;
  isMe: boolean;
  isWinner: boolean;
  highlightCards: Set<string>;
  extra?: SeatExtra;
  style: React.CSSProperties;
  turnEndsAt?: number | null;
  turnSeconds: number;
}

function Seat({ player: p, view, isMe, isWinner, highlightCards, extra, style, turnEndsAt, turnSeconds }: SeatProps) {
  const isTurn = view.phase === 'betting' && view.toActId === p.id;
  const label = p.seat === view.sbSeat && p.inHand ? 'SB' : p.seat === view.bbSeat && p.inHand ? 'BB' : null;
  let status: string | null = null;
  if (p.eliminated) status = 'Out';
  else if (p.folded) status = 'Folded';
  else if (p.allIn && view.phase === 'betting') status = 'All-in';

  const showCards = p.holeCards && p.holeCards.length > 0;
  const lastAction = [...view.log].reverse().find((e) => e.playerId === p.id && e.street === view.street && ['check', 'call', 'bet', 'raise', 'fold'].includes(e.kind));

  return (
    <div
      className={`seat${isTurn ? ' seat-turn' : ''}${isMe ? ' seat-me' : ''}${p.folded || p.eliminated ? ' seat-out' : ''}${isWinner ? ' seat-winner' : ''}`}
      style={style}
      aria-current={isTurn ? 'true' : undefined}
    >
      <div className="seat-cards">
        {showCards
          ? p.holeCards!.map((c) => <PlayingCard key={c} card={c} size="md" highlight={highlightCards.has(c)} />)
          : p.hasCards
            ? [0, 1].map((i) => <PlayingCard key={i} faceDown size="md" />)
            : null}
      </div>
      <div className="seat-plate">
        <div className="seat-name">
          {label && <span className={`blind-tag blind-${label.toLowerCase()}`}>{label}</span>}
          <span className="seat-name-text">{p.name}{isMe && p.name.toLowerCase() !== 'you' ? ' (you)' : ''}</span>
          {extra?.offline && <span className="offline-dot" title="Disconnected">●</span>}
        </div>
        <div className="seat-stack">{formatGBP(p.stack)}</div>
        {extra?.subtitle && <div className="seat-sub">{extra.subtitle}</div>}
        {status ? (
          <div className="seat-status">{status}</div>
        ) : isTurn ? (
          <div className="seat-status seat-status-turn">Thinking…</div>
        ) : lastAction && view.phase === 'betting' ? (
          <div className="seat-status seat-status-action">{lastAction.text.replace(p.name + ' ', '')}</div>
        ) : null}
        {isTurn && turnEndsAt ? <TurnTimer endsAt={turnEndsAt} seconds={turnSeconds} /> : null}
      </div>
    </div>
  );
}

function TurnTimer({ endsAt, seconds }: { endsAt: number; seconds: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const remaining = Math.max(0, endsAt - now);
  const pct = Math.min(100, (remaining / (seconds * 1000)) * 100);
  return (
    <div className="turn-timer" aria-label={`${Math.ceil(remaining / 1000)} seconds left`}>
      <div className={`turn-timer-bar${remaining < 8000 ? ' urgent' : ''}`} style={{ width: `${pct}%` }} />
      <span className="turn-timer-text">{Math.ceil(remaining / 1000)}s</span>
    </div>
  );
}
