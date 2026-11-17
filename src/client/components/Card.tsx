const SUIT_SYMBOL: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_NAME: Record<string, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };

interface Props {
  card?: string | null;
  faceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
  highlight?: boolean;
  dim?: boolean;
}

export function PlayingCard({ card, faceDown, size = 'md', highlight, dim }: Props) {
  if (faceDown || !card) {
    return <span className={`card card-${size} card-back`} aria-label="Hidden card" />;
  }
  const rank = card[0] === 'T' ? '10' : card[0];
  const suit = card[1];
  const red = suit === 'h' || suit === 'd';
  return (
    <span
      className={`card card-${size} ${red ? 'card-red' : 'card-black'}${highlight ? ' card-hl' : ''}${dim ? ' card-dim' : ''}`}
      aria-label={`${rank} of ${SUIT_NAME[suit]}`}
    >
      <span className="card-rank">{rank}</span>
      <span className="card-suit">{SUIT_SYMBOL[suit]}</span>
    </span>
  );
}

export function EmptyCardSlot({ size = 'lg' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`card card-${size} card-empty`} aria-hidden />;
}
