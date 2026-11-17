# Texas Hold'em: Solo and Online

A No-Limit Texas Hold'em game in React and TypeScript. It has two modes:

- **Play Solo**: you against four computer opponents, running entirely in your browser.
- **Online rooms**: 3–7 real people play in real time. A Node.js + Socket.IO server holds the only copy of each room's game.

Everything is play money in pounds. Each player starts with £5,000 and the blinds are fixed at £5/£10.

## Requirements

- Node.js 20 or newer (`node -v`)
- npm 10 or newer

## Local setup

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` starts two processes:

| Process | URL | What it is |
|---|---|---|
| Vite dev server | http://localhost:5173 | The React app with hot reload. Open this one. |
| Game server | http://localhost:3001 | Socket.IO and the API. Vite proxies `/socket.io` to it. |

To test online play on one computer, open http://localhost:5173 and create a room. Then open the invite link in more tabs or in a private window. Each tab can join as a different player. A refreshed tab rejoins its own seat.

To test from phones on your Wi-Fi, run `npx vite --host` instead of `npm run dev:client`. Keep `npm run dev:server` running, and open `http://<your-computer's-LAN-IP>:5173` on each phone.

## Tests

```bash
npm test
```

There are 50 tests (Vitest), split across two files.

**`tests/engine.test.ts`** covers the rules engine:
- the hand evaluator: kickers, ace-low straights, choosing between two sets of trips, playing the board
- blind rotation, including after eliminations, when the previous BB busts, and for short blinds
- turn order for 3+ players, heads-up, and when eliminations leave two players
- the big blind's option
- minimum bets and raises
- all-ins: a short all-in does not reopen betting, cumulative short all-ins do, and uncalled excess is returned
- side pots, with folded chips staying in the pot
- tied boards and odd-chip placement
- chip conservation: 30 full random games, checked after every action
- bots acting only from their own redacted view

**`tests/server.test.ts`** starts a real server and connects real Socket.IO clients. It covers:
- room creation and capacity
- "Room full" for an eighth player
- 3- and 7-player matches, with £15,000 and £35,000 conserved
- out-of-turn, illegal and duplicate actions
- the 30-second timeout
- reconnect by token
- a room-code-only takeover being refused
- host transfer
- two rooms running at once
- **network-level privacy**: every message each browser receives is scanned for card codes. A browser never sees another player's hole cards before showdown, and never sees the deck or burn cards.

## Production build and start

```bash
npm run build
```

```bash
npm start
```

`npm start` runs `node dist/server/index.js`. One Node process serves the built React app and Socket.IO on the same port. It reads `PORT` (default 3001), and links like `/room/482913` load the app even on a fresh browser or a refresh.

To use a local `.env` file (copy `.env.example`):

```bash
npm run start:env
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Port to listen on. Hosts usually set this for you. |
| `PUBLIC_URL` | (browser's address) | Base address used for invite links, e.g. `https://poker.example.com`. |
| `TURN_SECONDS` | `30` | Turn timer. On timeout the player checks if legal, otherwise folds. |
| `NEXT_HAND_SECONDS` | `6` | Pause showing the result before the next hand is dealt. |
| `CORS_ORIGINS` | (none) | Only needed if you host the client on a different domain. |

### Docker

```bash
docker build -t holdem-poker .
```

```bash
docker run -p 3001:3001 -e PUBLIC_URL=http://localhost:3001 holdem-poker
```

Deployment, linking from your website and a full smoke test are in [DEPLOY.md](DEPLOY.md).

## Project layout

```
src/
  engine/     Pure TypeScript poker engine. No React, no networking.
    cards.ts      deck, shuffling (crypto RNG), seeded RNG for tests
    evaluator.ts  best 5 of 7 cards, kickers, wheel, descriptions
    pots.ts       main/side pot construction
    game.ts       state machine: blinds, dealing, betting, all-ins, showdown, eliminations
    view.ts       per-player redacted view (hides others' cards, never includes the deck)
    bots.ts       computer opponents (Monte Carlo equity + 4 personalities)
  shared/protocol.ts   Socket.IO event and payload types shared by client and server
  server/
    app.ts        Express + Socket.IO server factory (also used by tests)
    rooms.ts      rooms, seats, tokens, timers, validation, per-player broadcasts
    index.ts      production entry point (reads env vars)
  client/         React UI (Home, SoloGame, OnlineRoom, table components)
tests/            Vitest suites
```

The engine is a set of pure functions: `createGame`, `startHand`, `getLegalActions`, `applyAction` and `getPlayerView`. Each returns a new state, and every transition asserts that stacks plus chips committed to the hand equal the starting total. The solo client and the server both use the same engine.

## Rules implemented

- The first small blind is chosen at random. Each hand, the BB moves to the next surviving player clockwise, and the surviving player just before it posts the SB. There is no dealer button, only SB and BB labels.
- Preflop action starts left of the BB. Postflop action starts at the SB seat and skips folded and all-in players. Heads-up, the SB acts first preflop and the BB acts first postflop.
- A player with less than the blind posts their whole stack as an all-in. The nominal BB stays at £10.
- The minimum opening bet is £10. A raise must increase the bet by at least the last full bet or raise. The BB gets the option to check or raise.
- A short all-in does not reopen betting for players who have already acted. It does reopen once the total increase since their last action reaches a full raise.
- Uncalled excess is returned. Side pots are built from actual contributions, and folded chips stay in the pot.
- When everyone else folds, the pot is awarded at once and the winner's cards stay hidden. When no more betting is possible, the remaining cards are dealt and the hand goes to showdown.
- Split pots are divided evenly. Odd £1 chips go clockwise from the SB seat.
- Players with £0 are eliminated after the hand is settled. The game ends when one player holds every chip.
- There is a fresh crypto-shuffled 52-card deck every hand, and a card is burned before the flop, turn and river.

### Computer opponents (solo)

| Name | Style |
|---|---|
| Rosa | Tight-passive |
| Theo | Loose-passive (calls a lot) |
| Priya | Tight-aggressive |
| Jack | Loose-aggressive |

Each bot receives only `getPlayerView(state, botId)`: its own cards, the board, the pot, stacks and the action log. From that it estimates equity by simulation against random hands. It also weighs pot odds and how many bets and raises have happened this street and hand.
