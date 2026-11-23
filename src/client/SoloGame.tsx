import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type Action, type GameState, applyAction, BOT_PROFILES, createGame, decideBotAction, formatGBP,
  getPlayerView, IllegalActionError, startHand,
} from '../engine';
import { ActionBar } from './components/ActionBar';
import { HandHistory, HistoryButton, useHistoryDrawer } from './components/HandHistory';
import { ResultPanel } from './components/ResultPanel';
import { Table, type SeatExtra } from './components/Table';
import { navigate } from './router';

const HUMAN_ID = 'you';
const BOTS = [
  { id: 'bot-rosa', name: 'Rosa', profile: BOT_PROFILES.rock },
  { id: 'bot-theo', name: 'Theo', profile: BOT_PROFILES.station },
  { id: 'bot-esther', name: 'Esther', profile: BOT_PROFILES.shark },
  { id: 'bot-jack', name: 'Jack', profile: BOT_PROFILES.maniac },
];

function newSoloGame(humanName: string): GameState {
  const g = createGame([{ id: HUMAN_ID, name: humanName }, ...BOTS.map((b) => ({ id: b.id, name: b.name }))]);
  return startHand(g);
}

export function SoloGame() {
  const humanName = useMemo(() => {
    try {
      return localStorage.getItem('poker:name') || 'You';
    } catch {
      return 'You';
    }
  }, []);
  const [game, setGame] = useState<GameState>(() => newSoloGame(humanName));
  const [error, setError] = useState<string | null>(null);
  const [fast, setFast] = useState(false);
  const drawer = useHistoryDrawer();
  const me = { id: HUMAN_ID, name: game.players[0].name };

  const view = useMemo(() => getPlayerView(game, HUMAN_ID, 100), [game]);
  const toAct = game.phase === 'betting' && game.toAct !== null ? game.players[game.toAct] : null;
  const humanOut = game.players[0].eliminated;

  // Computer opponents act after a short "thinking" pause, using only their own view.
  useEffect(() => {
    if (!toAct || toAct.id === HUMAN_ID) return;
    const bot = BOTS.find((b) => b.id === toAct.id)!;
    const delay = fast || humanOut ? 150 : 650 + Math.random() * 700;
    const t = setTimeout(() => {
      setGame((g) => {
        if (g.toAct === null || g.players[g.toAct].id !== bot.id) return g;
        const action = decideBotAction(getPlayerView(g, bot.id), bot.profile);
        return applyAction(g, bot.id, action);
      });
    }, delay);
    return () => clearTimeout(t);
  }, [toAct, fast, humanOut]);

  const act = useCallback((action: Action) => {
    setError(null);
    try {
      setGame(applyAction(game, HUMAN_ID, action));
    } catch (e) {
      setError(e instanceof IllegalActionError ? e.message : String(e));
    }
  }, [game]);

  const nextHand = () => setGame((g) => startHand(g));
  const newGame = () => {
    setError(null);
    setGame(newSoloGame(humanName));
  };

  const extras: Record<string, SeatExtra> = Object.fromEntries(BOTS.map((b) => [b.id, { subtitle: b.profile.style }]));
  const total = game.players.reduce((s, p) => s + p.stack + p.committed, 0);

  return (
    <div className="game-page">
      <header className="topbar">
        <button className="link-btn" onClick={() => navigate('/')}>← Home</button>
        <div className="topbar-title">Play Solo · Hand #{game.handNumber}</div>
        <div className="topbar-right">
          <span className="muted small">Blinds £5/£10 · Table {formatGBP(total)}</span>
          <label className="small toggle">
            <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} /> Fast bots
          </label>
          <HistoryButton open={drawer.open} onClick={drawer.toggle} count={game.history.length} />
          <button className="btn btn-sm" onClick={newGame}>New Game</button>
        </div>
      </header>

      <div className="game-layout">
        <main className="game-main">
          <Table view={view} meId={HUMAN_ID} extras={extras} />

          <div className="controls">
            {view.legal ? (
              <ActionBar legal={view.legal} onAction={act} />
            ) : game.phase === 'betting' ? (
              <div className="waiting">
                {humanOut ? 'You are out — watching the computer players.' : `Waiting for ${toAct?.name ?? '…'}`}
              </div>
            ) : null}
            {error && <div className="error">{error}</div>}

            <ResultPanel view={view} me={me}>
              {game.phase === 'gameOver' ? (
                <button className="btn btn-primary" onClick={newGame}>New Game</button>
              ) : (
                <button className="btn btn-primary" onClick={nextHand} autoFocus>Next Hand</button>
              )}
            </ResultPanel>
          </div>
        </main>
        <HandHistory open={drawer.open} onClose={() => drawer.setOpen(false)} history={view.history} log={view.log} me={me} />
      </div>
    </div>
  );
}
