import { useCallback, useEffect, useRef, useState } from 'react';
import { type Action, formatGBP } from '../engine';
import { type JoinSuccess, type RoomSnapshot, MIN_ROOM_PLAYERS } from '../shared/protocol';
import { ActionBar } from './components/ActionBar';
import { HandHistory, HistoryButton, useHistoryDrawer } from './components/HandHistory';
import { ResultPanel } from './components/ResultPanel';
import { Table, type SeatExtra } from './components/Table';
import { navigate } from './router';
import { type StoredSeat, forgetSeat, getSocket, loadName, loadSeat, request, saveName, saveSeat } from './socket';

type Stage = 'connecting' | 'name' | 'joined';

export function OnlineRoom({ code }: { code: string }) {
  const socket = getSocket();
  const [stage, setStage] = useState<Stage>('connecting');
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState(loadName());
  const [savedSeat, setSavedSeat] = useState<StoredSeat | null>(null);
  const [pending, setPending] = useState(false);
  const seatRef = useRef<StoredSeat | null>(null);
  const drawer = useHistoryDrawer();

  const joinWith = useCallback(async (payload: { name?: string; token?: string }) => {
    setError(null);
    const r = await request<JoinSuccess>((cb) => socket.emit('room:join', { code, ...payload }, cb));
    if (!r.ok) {
      if (payload.token) {
        // Token no longer valid (room restarted or spot freed): ask for a name instead.
        forgetSeat(code);
        seatRef.current = null;
        setSavedSeat(null);
      }
      setError(r.error);
      setStage('name');
      return false;
    }
    const seat = { playerId: r.playerId, token: r.token, name: payload.name ?? seatRef.current?.name ?? '' };
    seatRef.current = seat;
    saveSeat(code, seat);
    setStage('joined');
    return true;
  }, [code, socket]);

  // Connect, and (re)claim our seat on every (re)connection.
  useEffect(() => {
    const stored = loadSeat(code);
    if (stored?.thisTab) seatRef.current = stored.seat;
    else if (stored) setSavedSeat(stored.seat);

    const onConnect = () => {
      setConnected(true);
      if (seatRef.current) joinWith({ token: seatRef.current.token });
      else setStage((s) => (s === 'connecting' ? 'name' : s));
    };
    const onDisconnect = () => setConnected(false);
    const onState = (s: RoomSnapshot) => {
      setSnap(s);
      setClockOffset(s.serverNow - Date.now());
      if (seatRef.current && seatRef.current.name !== s.you.name) {
        seatRef.current = { ...seatRef.current, name: s.you.name };
        saveSeat(code, seatRef.current);
      }
    };
    const onNotice = (n: { message: string }) => setNotice(n.message);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onState);
    socket.on('room:notice', onNotice);
    if (socket.connected) onConnect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onState);
      socket.off('room:notice', onNotice);
    };
  }, [code, socket, joinWith]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const submitName = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('Enter a display name.');
    saveName(n);
    joinWith({ name: n });
  };

  const leave = async () => {
    await request((cb) => socket.emit('room:leave', cb));
    forgetSeat(code);
    navigate('/');
  };

  const act = async (action: Action) => {
    if (!snap?.game || pending) return;
    setPending(true);
    setError(null);
    const r = await request((cb) => socket.emit('game:action', { seq: snap.game!.actionSeq, action }, cb));
    setPending(false);
    if (!r.ok) setError(r.error);
  };

  const simple = async (event: 'room:start' | 'room:backToLobby') => {
    setError(null);
    const r = await request((cb) => socket.emit(event, cb));
    if (!r.ok) setError(r.error);
  };

  // ------------------------------------------------------------------ render

  if (stage === 'connecting' || (stage === 'joined' && !snap)) {
    return <CenteredMessage title={`Room ${code}`} text={connected ? 'Joining…' : 'Connecting to the server…'} />;
  }

  if (stage === 'name' || !snap) {
    return (
      <div className="home">
        <div className="home-hero">
          <h1>Join room {code}</h1>
          <p className="muted">Enter the name the other players will see.</p>
        </div>
        {savedSeat && (
          <div className="panel rejoin">
            <p>You were seated here as <strong>{savedSeat.name || 'a player'}</strong>.</p>
            <button
              className="btn btn-primary"
              onClick={() => {
                seatRef.current = savedSeat;
                joinWith({ token: savedSeat.token });
              }}
            >
              Rejoin as {savedSeat.name || 'that player'}
            </button>
          </div>
        )}
        <form className="panel name-form" onSubmit={submitName}>
          <label className="field">
            <span>Display name</span>
            <input value={name} maxLength={20} autoFocus onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
          </label>
          <button className="btn btn-primary" type="submit" disabled={!connected}>
            {connected ? 'Join Room' : 'Connecting…'}
          </button>
        </form>
        {error && <div className="error">{error}</div>}
        <button className="link-btn" onClick={() => navigate('/')}>← Back to home</button>
      </div>
    );
  }

  const offline = !connected;
  return (
    <div className="game-page">
      <header className="topbar">
        <button className="link-btn" onClick={leave}>← Leave</button>
        <div className="topbar-title">
          Room {snap.code}
          {snap.game && snap.phase !== 'lobby' && ` · Hand #${snap.game.handNumber}`}
        </div>
        <div className="topbar-right">
          {snap.game && <span className="muted small">Blinds £5/£10 · Table {formatGBP(snap.game.totalChips)}</span>}
          {snap.game && snap.phase !== 'lobby' && (
            <HistoryButton open={drawer.open} onClick={drawer.toggle} count={snap.game.history.length} />
          )}
          <InviteButton url={snap.inviteUrl} compact />
        </div>
      </header>
      {offline && <div className="banner banner-warn">Connection lost — reconnecting… Your seat is kept, but your turn timer keeps running.</div>}
      {notice && <div className="banner">{notice}</div>}

      {snap.phase === 'lobby' ? (
        <Lobby snap={snap} onStart={() => simple('room:start')} onLeave={leave} error={error} />
      ) : (
        <OnlineTable
          snap={snap}
          clockOffset={clockOffset}
          onAction={act}
          pending={pending}
          error={error}
          onBackToLobby={() => simple('room:backToLobby')}
          historyOpen={drawer.open}
          onCloseHistory={() => drawer.setOpen(false)}
        />
      )}
    </div>
  );
}

function CenteredMessage({ title, text }: { title: string; text: string }) {
  return (
    <div className="home">
      <div className="home-hero">
        <h1>{title}</h1>
        <p className="muted">{text}</p>
      </div>
    </div>
  );
}

function InviteButton({ url, compact }: { url: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Copy this invite link:', url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className={`btn ${compact ? 'btn-sm' : 'btn-primary'}`} onClick={copy}>
      {copied ? 'Copied!' : 'Copy Invite Link'}
    </button>
  );
}

function Lobby({ snap, onStart, onLeave, error }: { snap: RoomSnapshot; onStart: () => void; onLeave: () => void; error: string | null }) {
  const connectedCount = snap.members.filter((m) => m.connected).length;
  const open = snap.capacity - snap.members.length;
  return (
    <div className="lobby">
      <section className="panel lobby-code">
        <div className="muted small">Room code</div>
        <div className="room-code">{snap.code}</div>
        <div className="invite-url">{snap.inviteUrl}</div>
        <InviteButton url={snap.inviteUrl} />
      </section>

      <section className="panel">
        <h2>Players ({snap.members.length}/{snap.capacity})</h2>
        <ul className="member-list">
          {snap.members.map((m) => (
            <li key={m.id} className={m.connected ? '' : 'member-offline'}>
              <span className={`status-dot ${m.connected ? 'on' : 'off'}`} aria-hidden />
              {m.name}
              {m.id === snap.you.playerId && <span className="tag">you</span>}
              {m.isHost && <span className="tag tag-host">host</span>}
              {!m.connected && <span className="muted small"> (disconnected)</span>}
            </li>
          ))}
          {Array.from({ length: open }, (_, i) => (
            <li key={`open-${i}`} className="member-open">Open seat</li>
          ))}
        </ul>
        <p className="muted small">
          {open > 0 ? `${open} seat${open === 1 ? '' : 's'} available.` : 'Room is full.'} Every player starts with £5,000.
        </p>
        {snap.you.isHost ? (
          <>
            <button className="btn btn-primary" disabled={connectedCount < MIN_ROOM_PLAYERS} onClick={onStart}>
              Start Match ({connectedCount} players)
            </button>
            {connectedCount < MIN_ROOM_PLAYERS && (
              <p className="muted small">Waiting for at least {MIN_ROOM_PLAYERS} connected players.</p>
            )}
          </>
        ) : (
          <p className="muted">Waiting for the host to start the match…</p>
        )}
        {error && <div className="error">{error}</div>}
        <button className="link-btn" onClick={onLeave}>Leave room</button>
      </section>
    </div>
  );
}

function OnlineTable({ snap, clockOffset, onAction, pending, error, onBackToLobby, historyOpen, onCloseHistory }: {
  snap: RoomSnapshot;
  clockOffset: number;
  onAction: (a: Action) => void;
  pending: boolean;
  error: string | null;
  onBackToLobby: () => void;
  historyOpen: boolean;
  onCloseHistory: () => void;
}) {
  const view = snap.game!;
  const meId = snap.you.seated ? snap.you.playerId : null;
  const extras: Record<string, SeatExtra> = Object.fromEntries(
    snap.members.map((m) => [m.id, { offline: !m.connected }]),
  );
  const turnEndsAt = snap.turnEndsAt ? snap.turnEndsAt - clockOffset : null;
  const toActName = view.players.find((p) => p.id === view.toActId)?.name;
  const me = snap.you.seated ? { id: snap.you.playerId, name: snap.you.name } : null;

  return (
    <div className="game-layout">
      <main className="game-main">
        {!snap.you.seated && (
          <div className="banner">You are watching. You will be dealt in when the host starts the next match.</div>
        )}
        <Table view={view} meId={meId} extras={extras} turnEndsAt={turnEndsAt} turnSeconds={snap.turnSeconds} />
        <div className="controls">
          {view.legal ? (
            <>
              <div className="your-turn">Your turn</div>
              <ActionBar legal={view.legal} onAction={onAction} disabled={pending} />
            </>
          ) : view.phase === 'betting' ? (
            <div className="waiting">Waiting for {toActName ?? '…'}</div>
          ) : null}
          {error && <div className="error">{error}</div>}
          <ResultPanel view={view} me={me} footer={<NextHandCountdown at={snap.nextHandAt ? snap.nextHandAt - clockOffset : null} />}>
            {snap.phase === 'finished' && (
              snap.you.isHost
                ? <button className="btn btn-primary" onClick={onBackToLobby}>Back to Lobby for a New Match</button>
                : <span className="muted">Waiting for the host to set up the next match.</span>
            )}
          </ResultPanel>
        </div>
      </main>
      <HandHistory open={historyOpen} onClose={onCloseHistory} history={view.history} log={view.log} me={me} />
    </div>
  );
}

function NextHandCountdown({ at }: { at: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!at) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [at]);
  if (!at) return null;
  return <div className="muted small">Next hand in {Math.max(0, Math.ceil((at - now) / 1000))}s…</div>;
}
