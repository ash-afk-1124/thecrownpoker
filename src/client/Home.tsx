import { useState } from 'react';
import { DEFAULT_ROOM_CAPACITY, MAX_ROOM_PLAYERS, MIN_ROOM_PLAYERS, type JoinSuccess } from '../shared/protocol';
import { navigate } from './router';
import { getSocket, loadName, request, saveName, saveSeat } from './socket';

export function Home() {
  const [name, setName] = useState(loadName());
  const [capacity, setCapacity] = useState(DEFAULT_ROOM_CAPACITY);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createRoom = async () => {
    const n = name.trim();
    if (!n) return setError('Enter a display name first.');
    setBusy(true);
    setError(null);
    saveName(n);
    const r = await request<JoinSuccess>((cb) => getSocket().emit('room:create', { name: n, capacity }, cb));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    saveSeat(r.code, { playerId: r.playerId, token: r.token, name: n });
    navigate(`/room/${r.code}`);
  };

  const joinRoom = () => {
    const c = code.replace(/\D/g, '');
    if (c.length !== 6) return setError('Room codes are six digits.');
    if (name.trim()) saveName(name.trim());
    navigate(`/room/${c}`);
  };

  return (
    <div className="home">
      <div className="home-hero">
        <div className="home-suits" aria-hidden>♠ ♥ ♦ ♣</div>
        <h1>Texas Hold'em</h1>
        <p className="muted">No-Limit · £5/£10 blinds · £5,000 play-money stacks</p>
      </div>

      <label className="field home-name">
        <span>Your display name</span>
        <input
          value={name}
          maxLength={20}
          placeholder="e.g. Sam"
          onChange={(e) => setName(e.target.value)}
          autoComplete="nickname"
        />
      </label>

      <div className="home-cards">
        <section className="panel">
          <h2>Play Solo</h2>
          <p className="muted">You against four computer opponents with different styles.</p>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (name.trim()) saveName(name.trim());
              navigate('/solo');
            }}
          >
            Play Solo
          </button>
        </section>

        <section className="panel">
          <h2>Create Room</h2>
          <p className="muted">Host an online table and invite friends with a link.</p>
          <label className="field">
            <span>Seats</span>
            <select value={capacity} onChange={(e) => setCapacity(Number(e.target.value))}>
              {Array.from({ length: MAX_ROOM_PLAYERS - MIN_ROOM_PLAYERS + 1 }, (_, i) => MIN_ROOM_PLAYERS + i).map((n) => (
                <option key={n} value={n}>{n} players</option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" disabled={busy} onClick={createRoom}>
            {busy ? 'Creating…' : 'Create Room'}
          </button>
        </section>

        <section className="panel">
          <h2>Join Room</h2>
          <p className="muted">Got a six-digit code from a friend?</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              joinRoom();
            }}
          >
            <label className="field">
              <span>Room code</span>
              <input
                value={code}
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                placeholder="482913"
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <button className="btn btn-primary" type="submit">Join Room</button>
          </form>
        </section>
      </div>
      {error && <div className="error">{error}</div>}
      <p className="muted small home-foot">Play money only. No real money is involved.</p>
    </div>
  );
}
