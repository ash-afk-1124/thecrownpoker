import { useEffect, useMemo, useState } from 'react';
import { formatGBP, type Action, type LegalActions } from '../../engine';

interface Props {
  legal: LegalActions;
  onAction: (a: Action) => void;
  disabled?: boolean;
}

/** Only legal actions are shown; every button carries its exact amount. */
export function ActionBar({ legal, onAction, disabled }: Props) {
  const range = legal.bet ?? legal.raise;
  const isBet = !!legal.bet;
  const [amount, setAmount] = useState<string>(range ? String(range.min) : '');

  // Reset the input whenever a new decision is presented.
  const key = `${legal.currentBet}:${legal.streetBet}:${legal.stack}:${range?.min}`;
  useEffect(() => {
    setAmount(range ? String(range.min) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const presets = useMemo(() => {
    if (!range) return [];
    const clamp = (x: number) => Math.max(range.min, Math.min(range.max, Math.round(x)));
    // Pot-sized raise: call first, then raise by the pot after the call.
    const potAfterCall = legal.pot + legal.toCall;
    const sized = (frac: number) => clamp(isBet ? legal.pot * frac : legal.currentBet + potAfterCall * frac);
    return [
      { label: 'Min', value: range.min },
      { label: '½ Pot', value: sized(0.5) },
      { label: 'Pot', value: sized(1) },
      { label: 'All-in', value: range.max },
    ];
  }, [range, isBet, legal.pot, legal.toCall, legal.currentBet]);

  const parsed = Number(amount);
  const valid = range && /^\d+$/.test(amount) && parsed >= range.min && parsed <= range.max;
  const isAllInAmount = range && parsed === range.max;

  return (
    <div className="action-bar" role="group" aria-label="Your actions">
      <div className="action-buttons">
        {legal.canFold && (
          <button className="btn btn-fold" disabled={disabled} onClick={() => onAction({ type: 'fold' })}>
            Fold
          </button>
        )}
        {legal.canCheck && (
          <button className="btn btn-check" disabled={disabled} onClick={() => onAction({ type: 'check' })}>
            Check
          </button>
        )}
        {legal.call !== null && (
          <button className="btn btn-call" disabled={disabled} onClick={() => onAction({ type: 'call' })}>
            {legal.callIsAllIn ? `Call ${formatGBP(legal.call)} (all-in)` : `Call ${formatGBP(legal.call)}`}
          </button>
        )}
        {range && (
          <button
            className="btn btn-raise"
            disabled={disabled || !valid}
            onClick={() => onAction(isAllInAmount ? { type: 'allin' } : { type: isBet ? 'bet' : 'raise', amount: parsed })}
          >
            {valid
              ? `${isBet ? 'Bet' : 'Raise to'} ${formatGBP(parsed)}${isAllInAmount ? ' (all-in)' : ''}`
              : isBet ? 'Bet' : 'Raise'}
          </button>
        )}
      </div>

      {range && range.min < range.max && (
        <div className="sizing">
          <label className="sizing-input">
            <span>{isBet ? 'Bet' : 'Raise to'} £</span>
            <input
              type="number"
              inputMode="numeric"
              min={range.min}
              max={range.max}
              step={1}
              value={amount}
              disabled={disabled}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={() => {
                if (!amount) return setAmount(String(range.min));
                setAmount(String(Math.max(range.min, Math.min(range.max, Math.floor(Number(amount))))));
              }}
              aria-label={isBet ? 'Bet amount in pounds' : 'Raise to amount in pounds'}
            />
          </label>
          <div className="presets">
            {presets.map((p) => (
              <button key={p.label} className="btn btn-sm" disabled={disabled} onClick={() => setAmount(String(p.value))}>
                {p.label}
                <small>{formatGBP(p.value)}</small>
              </button>
            ))}
          </div>
          {!valid && amount !== '' && (
            <div className="sizing-hint">Enter {formatGBP(range.min)} – {formatGBP(range.max)}</div>
          )}
        </div>
      )}
      {range && range.min === range.max && (
        <div className="sizing-hint">You can only raise all-in ({formatGBP(range.max)}).</div>
      )}
    </div>
  );
}
