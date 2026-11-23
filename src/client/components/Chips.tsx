import { formatGBP } from '../../engine';

/** Chip denominations in pounds, largest first, with their casino colours. */
const DENOMINATIONS: { value: number; className: string }[] = [
  { value: 1000, className: 'chip-1000' },
  { value: 500, className: 'chip-500' },
  { value: 100, className: 'chip-100' },
  { value: 25, className: 'chip-25' },
  { value: 5, className: 'chip-5' },
  { value: 1, className: 'chip-1' },
];

/** Break an amount into chips, largest denominations first. */
export function breakIntoChips(amount: number): { value: number; className: string; count: number }[] {
  const out: { value: number; className: string; count: number }[] = [];
  let left = Math.max(0, Math.floor(amount));
  for (const d of DENOMINATIONS) {
    const count = Math.floor(left / d.value);
    if (count > 0) {
      out.push({ ...d, count });
      left -= count * d.value;
    }
  }
  return out;
}

interface Props {
  amount: number;
  size?: 'sm' | 'md' | 'lg';
  /** Maximum chips drawn per column (the label always shows the exact amount). */
  maxPerColumn?: number;
  maxColumns?: number;
  label?: boolean;
  className?: string;
}

/** A pile of poker chips: one column per denomination, labelled with the exact amount. */
export function ChipStack({ amount, size = 'md', maxPerColumn = 8, maxColumns = 4, label = true, className = '' }: Props) {
  if (amount <= 0) return null;
  const columns = breakIntoChips(amount).slice(0, maxColumns);
  return (
    <div className={`chip-stack chip-stack-${size} ${className}`} aria-label={formatGBP(amount)}>
      <div className="chip-columns" aria-hidden>
        {columns.map((col) => (
          <div key={col.value} className="chip-column" title={`${col.count} × £${col.value}`}>
            {Array.from({ length: Math.min(col.count, maxPerColumn) }, (_, i) => (
              <span key={i} className={`chip ${col.className}`} style={{ ['--i' as string]: i }} />
            ))}
          </div>
        ))}
      </div>
      {label && <span className="chip-label">{formatGBP(amount)}</span>}
    </div>
  );
}

/** A single decorative chip, e.g. next to a stack size. */
export function ChipIcon({ denomination = 100 }: { denomination?: number }) {
  const d = DENOMINATIONS.find((x) => x.value === denomination) ?? DENOMINATIONS[2];
  return <span className={`chip chip-icon-single ${d.className}`} aria-hidden />;
}
