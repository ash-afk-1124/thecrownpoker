import type { Card } from './cards';
import type { Pot } from './pots';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type Phase = 'notStarted' | 'betting' | 'handComplete' | 'gameOver';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

/**
 * A player action. For `bet` and `raise`, `amount` is the TOTAL the player will have
 * committed on this street after acting ("raise to"). `allin` commits the whole stack.
 */
export interface Action {
  type: ActionType;
  amount?: number;
}

export interface GameConfig {
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
}

export interface Player {
  id: string;
  name: string;
  seat: number;
  stack: number;
  holeCards: Card[];
  /** Chips put in on the current street. */
  streetBet: number;
  /** Chips put in this hand, including the current street. */
  committed: number;
  folded: boolean;
  allIn: boolean;
  /** Dealt into the current hand. */
  inHand: boolean;
  eliminated: boolean;
  /** The bet level this player last responded to on this street; null = not yet acted. */
  actedLevel: number | null;
}

export interface LegalActions {
  playerId: string;
  toCall: number;
  canFold: boolean;
  canCheck: boolean;
  /** Amount needed to call (capped at stack), or null if calling is not an option. */
  call: number | null;
  callIsAllIn: boolean;
  /** Opening bet range, totals for this street. */
  bet: { min: number; max: number } | null;
  /** Raise-to range, totals for this street. */
  raise: { min: number; max: number } | null;
  /** Street total if the player moves all-in, or null if that isn't a legal action. */
  allIn: number | null;
  /** Current pot including all bets, for sizing helpers. */
  pot: number;
  currentBet: number;
  streetBet: number;
  stack: number;
}

export type LogKind =
  | 'hand-start' | 'post' | 'deal' | 'street' | 'fold' | 'check' | 'call' | 'bet' | 'raise'
  | 'uncalled' | 'showdown' | 'win' | 'eliminated' | 'timeout' | 'game-over';

export interface LogEntry {
  kind: LogKind;
  text: string;
  playerId?: string;
  amount?: number;
  street?: Street;
}

export interface ShowdownHand {
  playerId: string;
  name: string;
  holeCards: Card[];
  description: string;
  bestFive: Card[];
}

export interface PotResult {
  label: string;
  amount: number;
  eligible: string[];
  winners: { playerId: string; name: string; amount: number }[];
  /** Winning hand description; null if won uncontested. */
  handDescription: string | null;
}

export interface HandResult {
  handNumber: number;
  board: Card[];
  uncontested: boolean;
  pots: PotResult[];
  /** Total won per player this hand. */
  winners: { playerId: string; name: string; amount: number; handDescription: string | null }[];
  /** Hands shown at showdown (null if the hand was won uncontested). */
  showdown: ShowdownHand[] | null;
  eliminated: { playerId: string; name: string }[];
  summary: string;
}

export interface GameState {
  config: GameConfig;
  players: Player[];
  totalChips: number;
  handNumber: number;
  phase: Phase;
  street: Street;
  board: Card[];
  /** Server/engine-only. Never sent to clients. */
  deck: Card[];
  sbSeat: number | null;
  bbSeat: number | null;
  /** Number of players dealt into this hand (2 = heads-up rules). */
  playersInHand: number;
  currentBet: number;
  /** Size of the last full bet or raise on this street (minimum raise increment). */
  minRaise: number;
  toAct: number | null;
  /** Increments on every accepted action; used to reject duplicate submissions. */
  actionSeq: number;
  log: LogEntry[];
  lastResult: HandResult | null;
  history: HandResult[];
  winnerId: string | null;
}

export interface PublicPlayer extends Omit<Player, 'holeCards'> {
  /** null = hidden from this viewer. */
  holeCards: Card[] | null;
  hasCards: boolean;
}

export interface PlayerView {
  viewerId: string | null;
  config: GameConfig;
  players: PublicPlayer[];
  totalChips: number;
  handNumber: number;
  phase: Phase;
  street: Street;
  board: Card[];
  sbSeat: number | null;
  bbSeat: number | null;
  playersInHand: number;
  currentBet: number;
  minRaise: number;
  toAct: number | null;
  toActId: string | null;
  actionSeq: number;
  log: LogEntry[];
  lastResult: HandResult | null;
  history: HandResult[];
  winnerId: string | null;
  /** Pots built from completed streets (current street bets shown separately). */
  pots: Pot[];
  potTotal: number;
  legal: LegalActions | null;
}

export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalActionError';
  }
}
