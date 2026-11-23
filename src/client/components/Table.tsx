import { useEffect, useState, type CSSProperties } from 'react';
import { formatGBP, type PlayerView, type PublicPlayer } from '../../engine';
import { EmptyCardSlot, PlayingCard } from './Card';
import { ChipStack } from './Chips';

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

// ---------------------------------------------------------------------------
// Seat layout
//
// Name tags sit on the rail of a racetrack-shaped table. Each seat has a fixed
// slot (x, y in % of the felt) and a direction pointing into the felt. The
// player's cards sit a fixed distance in that direction, with their bank chips
// on one side of the cards and their current bet on the other.
// ---------------------------------------------------------------------------

type Dir = 'up' | 'down' | 'left' | 'right';
interface Slot { x: number; y: number; dir: Dir }

const s = (x: number, y: number, dir: Dir): Slot => ({ x, y, dir });

/** Slots in clockwise order, starting with the viewer at the bottom centre. */
const WIDE: Record<number, Slot[]> = {
  2: [s(50, 100, 'up'), s(50, 0, 'down')],
  3: [s(50, 100, 'up'), s(27, 0, 'down'), s(73, 0, 'down')],
  4: [s(50, 100, 'up'), s(0, 50, 'right'), s(50, 0, 'down'), s(100, 50, 'left')],
  5: [s(50, 100, 'up'), s(0, 64, 'right'), s(27, 0, 'down'), s(73, 0, 'down'), s(100, 64, 'left')],
  6: [s(50, 100, 'up'), s(0, 74, 'right'), s(0, 30, 'right'), s(50, 0, 'down'), s(100, 30, 'left'), s(100, 74, 'left')],
  7: [s(50, 100, 'up'), s(0, 74, 'right'), s(0, 30, 'right'), s(34, 0, 'down'), s(66, 0, 'down'), s(100, 30, 'left'), s(100, 74, 'left')],
};

/** Phones: a tall table, players down both long sides. */
const TALL: Record<number, Slot[]> = {
  2: [s(50, 100, 'up'), s(50, 0, 'down')],
  3: [s(50, 100, 'up'), s(0, 36, 'right'), s(100, 36, 'left')],
  4: [s(50, 100, 'up'), s(0, 50, 'right'), s(50, 0, 'down'), s(100, 50, 'left')],
  5: [s(50, 100, 'up'), s(0, 70, 'right'), s(0, 28, 'right'), s(100, 28, 'left'), s(100, 70, 'left')],
  6: [s(50, 100, 'up'), s(0, 72, 'right'), s(0, 30, 'right'), s(50, 0, 'down'), s(100, 30, 'left'), s(100, 72, 'left')],
  7: [s(50, 100, 'up'), s(0, 72, 'right'), s(0, 30, 'right'), s(29, 0, 'down'), s(71, 0, 'down'), s(100, 30, 'left'), s(100, 72, 'left')],
};

/** How far (in % of the felt) cards, bank and bet sit from the tag. */
const SPACING = {
  // card*: tag → cards. bank*/bet*: cards → chip piles (bets need room for their label).
  wide: { cardV: 24, cardH: 14, bankH: 8, betH: 11.5, bankV: 15, betV: 15, betInH: 0, betInV: 0 },
  // Phones: small opponent cards just inside the rail, bets further in towards the middle.
  tall: { cardV: 11, cardH: 27, bankH: 0, betH: 25, bankV: 0, betV: 0, betInH: 43, betInV: 21 },
};

const VECTORS: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

interface SeatGeometry {
  tag: CSSProperties;
  cards: CSSProperties;
  bank: CSSProperties;
  bet: CSSProperties;
  dir: Dir;
}

function geometry(slot: Slot, tall: boolean): SeatGeometry {
  const sp = tall ? SPACING.tall : SPACING.wide;
  const [dx, dy] = VECTORS[slot.dir];
  const vertical = dx === 0; // seat on the top or bottom rail
  // The viewer's own cards are drawn larger, so they sit a little closer to the rail.
  const cardV = slot.dir === 'up' && !tall ? sp.cardV * 0.86 : sp.cardV;
  const cx = slot.x + dx * sp.cardH;
  const cy = slot.y + dy * cardV;
  // Bank chips go to one side of the cards, the bet to the other.
  const wider = slot.dir === 'up' ? 1.2 : 1; // room for the viewer's larger cards
  // Mirror the right half of the table so bets always sit on the inner side.
  const flip = vertical && slot.x > 50 ? -1 : 1;
  const bank: [number, number] = vertical ? [sp.bankH * wider * flip, 0] : [0, sp.bankV];
  const bet: [number, number] = vertical ? [sp.betH * wider * flip, 0] : [0, sp.betV];
  // Tags sit centred on the rail itself, so push edge slots out by half the rail.
  const railX = slot.x === 0 ? -1 : slot.x === 100 ? 1 : 0;
  const railY = slot.y === 0 ? -1 : slot.y === 100 ? 1 : 0;
  const at = (x: number, y: number): CSSProperties => ({ left: `${x}%`, top: `${y}%` });
  // On phones the bet goes further in along the seat's direction (the viewer's goes beside their cards).
  const betPos = tall && slot.dir !== 'up'
    ? at(slot.x + dx * sp.betInH, slot.y + dy * sp.betInV)
    : at(cx + bet[0], cy + bet[1]);
  return {
    tag: {
      left: `calc(${slot.x}% + ${railX} * var(--rail-half))`,
      top: `calc(${slot.y}% + ${railY} * var(--rail-half))`,
    },
    cards: at(cx, cy),
    bank: at(cx - bank[0], cy - bank[1]),
    bet: betPos,
    dir: slot.dir,
  };
}

function useTallTable() {
  const query = '(max-width: 720px)';
  const [tall, setTall] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setTall(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return tall;
}

// ---------------------------------------------------------------------------

export function Table({ view, meId, extras = {}, turnEndsAt, turnSeconds = 30 }: Props) {
  const tall = useTallTable();
  const n = view.players.length;
  const slots = (tall ? TALL : WIDE)[Math.min(7, Math.max(2, n))];
  const mySeat = view.players.find((p) => p.id === meId)?.seat ?? 0;
  const showdown = view.phase !== 'betting' && view.lastResult?.showdown;
  const winners = new Set(view.phase !== 'betting' ? view.lastResult?.winners.map((w) => w.playerId) ?? [] : []);
  const bestFive = new Set(
    view.phase !== 'betting' && view.lastResult?.showdown
      ? view.lastResult.showdown.filter((h) => winners.has(h.playerId)).flatMap((h) => h.bestFive)
      : [],
  );

  return (
    <div className={`table-wrap${tall ? ' table-tall' : ''}`}>
      <div className="table-felt">
        <div className="table-line" aria-hidden />
        <div className="table-center">
          <div className="board" aria-label="Community cards">
            {Array.from({ length: 5 }, (_, i) =>
              view.board[i] ? (
                <PlayingCard
                  key={i}
                  card={view.board[i]}
                  size="lg"
                  highlight={bestFive.has(view.board[i])}
                  dim={!!showdown && bestFive.size > 0 && !bestFive.has(view.board[i])}
                />
              ) : (
                <EmptyCardSlot key={i} />
              ),
            )}
          </div>
          <PotDisplay view={view} />
        </div>

        {view.players.map((p) => {
          const idx = (p.seat - mySeat + n) % n;
          const g = geometry(slots[idx], tall);
          const isMe = p.id === meId;
          const showCards = p.holeCards && p.holeCards.length > 0;
          return (
            <div key={p.id} className="seat-group">
              <SeatTag
                player={p}
                view={view}
                isMe={isMe}
                isWinner={winners.has(p.id)}
                extra={extras[p.id]}
                style={g.tag}
                dir={g.dir}
                turnEndsAt={view.toActId === p.id ? turnEndsAt : null}
                turnSeconds={turnSeconds}
              />
              {(showCards || p.hasCards) && (
                <div className={`hole-cards${isMe ? ' hole-cards-me' : ''}${p.folded ? ' hole-cards-folded' : ''}`} style={g.cards}>
                  {showCards
                    ? p.holeCards!.map((c) => <PlayingCard key={c} card={c} size="md" highlight={bestFive.has(c)} />)
                    : [0, 1].map((i) => <PlayingCard key={i} faceDown size="md" />)}
                </div>
              )}
              {p.stack > 0 && !p.eliminated && (
                <div className="bank-pile" style={g.bank} title={`${p.name}'s stack: ${formatGBP(p.stack)}`}>
                  <ChipStack amount={p.stack} size="xs" label={false} maxPerColumn={5} maxColumns={3} />
                </div>
              )}
              {p.streetBet > 0 && view.phase === 'betting' && (
                <div className="bet-pile" style={g.bet} key={`${view.handNumber}-${view.street}-${p.streetBet}`}>
                  <ChipStack amount={p.streetBet} size="sm" maxPerColumn={4} maxColumns={2} />
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
  const gathered = view.pots.reduce((sum, p) => sum + p.amount, 0);
  return (
    <div className="pot-display">
      <div className="pot-row">
        {gathered > 0 && <ChipStack amount={gathered} size="md" label={false} maxPerColumn={5} maxColumns={5} className="pot-chips" />}
        <div className="pot-total">Pot {formatGBP(view.potTotal)}</div>
      </div>
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

/** Short pill text for a seat: its status, or its last action this street. */
function seatBadge(p: PublicPlayer, view: PlayerView, isWinner: boolean): { text: string; tone: string } | null {
  if (p.eliminated) return { text: 'Out', tone: 'muted' };
  if (view.phase !== 'betting') return isWinner ? { text: 'Winner', tone: 'win' } : null;
  if (p.folded) return { text: 'Folded', tone: 'muted' };
  if (p.allIn) return { text: 'All-in', tone: 'allin' };
  const last = [...view.log].reverse().find((e) => e.playerId === p.id && e.street === view.street
    && ['check', 'call', 'bet', 'raise'].includes(e.kind));
  if (!last) return null;
  const amt = last.amount !== undefined ? formatGBP(last.amount) : '';
  switch (last.kind) {
    case 'check': return { text: 'Check', tone: 'neutral' };
    case 'call': return { text: `Call ${amt}`, tone: 'neutral' };
    case 'bet': return { text: `Bet ${amt}`, tone: 'aggr' };
    case 'raise': return { text: `Raise to ${amt}`, tone: 'aggr' };
    default: return null;
  }
}

const AVATAR_COLOURS = ['#3b82f6', '#a855f7', '#f97316', '#14b8a6', '#ec4899', '#eab308', '#22c55e', '#ef4444'];
function avatarColour(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
}

interface SeatTagProps {
  player: PublicPlayer;
  view: PlayerView;
  isMe: boolean;
  isWinner: boolean;
  extra?: SeatExtra;
  style: CSSProperties;
  dir: Dir;
  turnEndsAt?: number | null;
  turnSeconds: number;
}

/** The name tag on the rail: avatar, name, stack, blind marker and a status pill. */
function SeatTag({ player: p, view, isMe, isWinner, extra, style, dir, turnEndsAt, turnSeconds }: SeatTagProps) {
  const isTurn = view.phase === 'betting' && view.toActId === p.id;
  const blind = p.seat === view.sbSeat && p.inHand ? 'SB' : p.seat === view.bbSeat && p.inHand ? 'BB' : null;
  const badge = isTurn ? null : seatBadge(p, view, isWinner);
  const name = isMe && p.name.toLowerCase() !== 'you' ? `${p.name} (you)` : p.name;
  // The status pill goes on the outside of the table, away from the cards.
  const badgeSide = dir === 'down' ? 'above' : 'below';

  return (
    <div
      className={`seat-tag${isTurn ? ' is-turn' : ''}${isMe ? ' is-me' : ''}${p.folded || p.eliminated ? ' is-out' : ''}${isWinner ? ' is-winner' : ''}`}
      style={style}
      title={extra?.subtitle ? `${p.name} · ${extra.subtitle}` : undefined}
      aria-current={isTurn ? 'true' : undefined}
    >
      <div className="seat-avatar" style={{ background: avatarColour(p.id) }} aria-hidden>
        {p.name.trim().charAt(0).toUpperCase()}
        {blind && <span className={`blind-tag blind-${blind.toLowerCase()}`}>{blind}</span>}
      </div>
      <div className="seat-info">
        <div className="seat-name">
          <span className="seat-name-text">{name}</span>
          {extra?.offline && <span className="offline-dot" title="Disconnected">●</span>}
        </div>
        <div className="seat-stack">{formatGBP(p.stack)}</div>
        {isTurn && turnEndsAt ? <TurnTimer endsAt={turnEndsAt} seconds={turnSeconds} /> : null}
      </div>
      {badge && <div className={`seat-badge badge-${badge.tone} badge-${badgeSide}`}>{badge.text}</div>}
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
    </div>
  );
}
