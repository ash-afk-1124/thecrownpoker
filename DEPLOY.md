# Deploying, linking and smoke-testing

The game is a single Node.js service. It serves the React app and the Socket.IO connection from the same address, so you deploy one thing.

## What the host must support

- **A persistent Node.js process.** Rooms, seats and turn timers live in that process's memory. Serverless and functions platforms (Vercel functions, Netlify functions, Cloudflare Workers, AWS Lambda) will **not** work.
- **WebSockets over HTTPS** (wss://).
- **Exactly one instance.** If you scale to two or more, players in the same room could land on different instances. Keep the instance count at 1. One small instance comfortably runs many rooms.
- **Always-on (recommended).** Free tiers that sleep when idle will drop rooms and in-progress matches when they sleep.

Render, Railway and Fly.io all meet these requirements. Render is described step by step below, and the others follow the same pattern.

## Deploy to Render (Docker)

1. Push this folder to a GitHub repository. The project root must be the repository root, or set Render's "Root Directory" to this folder.
2. In Render, choose **New → Web Service** and connect the repository. Render detects the `Dockerfile`.
   - Alternatively, choose **New → Blueprint** and Render reads `render.yaml`.
3. Settings:
   - **Runtime:** Docker
   - **Instance type:** any paid "Starter" or higher, so it stays always-on. The free type works for trying it out but sleeps.
   - **Health check path:** `/healthz`
   - **Instances:** 1
   - **Environment:** add `PUBLIC_URL`. For now, use the address Render gives you, e.g. `https://holdem-poker.onrender.com`. Do not set `PORT`; Render injects it.
4. Deploy. When the logs show `Poker server listening on http://0.0.0.0:<port>`, open the `onrender.com` address.

**Without Docker:** pick the Node runtime instead. Use build command `npm ci && npm run build` and start command `npm start`.

### Exact production commands (any host)

Build:
```bash
npm ci && npm run build
```

Start:
```bash
npm start
```

With Docker:
```bash
docker build -t holdem-poker .
```

```bash
docker run -d --restart unless-stopped -p 3001:3001 -e PUBLIC_URL=https://poker.example.com holdem-poker
```

### Other hosts

- **Railway:** create a project from the GitHub repo. It uses the Dockerfile. Set `PUBLIC_URL` under Variables, then generate a domain under Settings → Networking. Keep it at 1 replica.
- **Fly.io:** run `fly launch` (it detects the Dockerfile; choose internal port 3001). Then run `fly secrets set PUBLIC_URL=https://<app>.fly.dev` and `fly scale count 1`. Set `auto_stop_machines = "off"` in `fly.toml` so rooms are not dropped.
- **Your own VPS:** run the Docker command above behind Caddy or nginx with HTTPS. Caddy needs one line, `poker.example.com { reverse_proxy localhost:3001 }`, and handles both certificates and WebSockets.

## Use the host's URL or your own subdomain

### Option 1: host-provided URL

Set `PUBLIC_URL` to the address the host gave you (e.g. `https://holdem-poker.onrender.com`) and redeploy. Invite links will look like `https://holdem-poker.onrender.com/room/482913`.

### Option 2: your own subdomain, e.g. `poker.example.com`

1. In the host's dashboard, add the custom domain `poker.example.com` (Render: Settings → Custom Domains → Add). The host shows you a DNS target, for example `holdem-poker.onrender.com`.
2. At your DNS provider (where `example.com` is managed), add a record:

   | Type | Name | Value |
   |---|---|---|
   | CNAME | `poker` | `holdem-poker.onrender.com` (the target the host showed you) |

3. Wait for the host to verify the domain and issue the HTTPS certificate. This usually takes minutes, and up to an hour if DNS is slow.
4. Change the `PUBLIC_URL` environment variable to `https://poker.example.com` (no trailing slash) and redeploy.
5. Open `https://poker.example.com/healthz`. It should return `{"ok":true,...}`.

`PUBLIC_URL` controls the invite links. The game itself works on any address that reaches the server.

## Link it from your existing website

Open `play-poker-link.html`. Replace `https://poker.example.com` with your `PUBLIC_URL`, and paste one of the snippets into your site.

```html
<a href="https://poker.example.com/" target="_blank" rel="noopener">Play Poker</a>
```

Direct room links (`https://poker.example.com/room/482913`) work when pasted into a fresh browser, opened from a chat app, or refreshed. The server returns the app for every non-API path, and the app reads the room code from the address.

## Smoke test (end to end, on real devices)

You need three devices: for example, a laptop and two phones. Use different networks if you can (Wi-Fi plus mobile data) to prove it works over the internet.

**A. Reach the game from your website**

1. On the laptop, open your website and click **Play Poker**. The game's home page opens at your `PUBLIC_URL` with a padlock (HTTPS).
2. Optional quick check: click **Play Solo**, play one hand, click **Next Hand**, then click **← Home**.

**B. Create a room and invite friends**

3. Type a display name (e.g. "Host"), leave **Seats** at 7, and click **Create Room**.
4. The lobby shows a six-digit code and an invite link starting with your `PUBLIC_URL`, e.g. `https://poker.example.com/room/482913`. If it shows a different address, fix `PUBLIC_URL`.
5. Click **Copy Invite Link** and send it to the two phones by text or chat.
6. On phone 1, open the link. It goes straight to "Join room 482913". Enter "Phone1" and tap **Join Room**.
7. On phone 2, go to the home page instead, tap **Join Room**, type the six-digit code, enter "Phone2" and join.
8. All three devices list Host, Phone1 and Phone2 with green dots, and show "4 seats available".

**C. Play a hand**

9. On the laptop (host), click **Start Match (3 players)**. Every device shows the table, with each player at £5,000 (minus blinds) and "Table £15,000" in the header. Exactly one seat shows **SB** and one shows **BB**.
10. Each device shows its own two cards face-up and the other players' cards face-down.
11. The player to act sees **YOUR TURN**, a 30-second timer, and buttons with exact amounts, e.g. "Call £10" and "Raise to £20". Everyone else sees "Waiting for …".
12. Play a hand out with a mix of Call, Check and one **Raise to** using the ½ Pot or Pot button. Every device updates the bets, pot and community cards at the same moment.
13. At the end, all three devices show the same result panel: who won, how much, and the winning hand (or "everyone else folded"). Showdown hands appear face-up. The **Hand history** panel shows the same entry, and "Next hand in 6s…" counts down, after which hand #2 deals automatically.

**D. Reconnect and security**

14. On phone 1, pull down to refresh mid-hand. It comes back to the same seat with the same two cards. If it was phone 1's turn, the timer kept running.
15. On phone 1, turn on airplane mode for about 10 seconds, then turn it off. A "Connection lost — reconnecting…" banner appears and clears, and the seat is restored.
16. On a fourth browser (or a private window), open the room link and try to join as "Phone1". It is refused ("That name is already taken"). Joining under any other name only puts you in the lobby for the *next* match, with no seat and no hole cards.
17. Let the timer run out on someone's turn without acting. They auto-check if they can, otherwise they fold.

**E. Finish**

18. Optionally keep playing until one player has all £15,000. Every device shows the winner. The host gets **Back to Lobby for a New Match**, and new players can join for the next match.

## Operations notes

- **Health check:** `GET /healthz` returns `{"ok":true,"rooms":N}`.
- **Restarts:** restarting or redeploying the server clears all rooms. Deploy when nobody is playing.
- **Idle cleanup:** rooms with nobody connected for 30 minutes are removed automatically. Lobby spots of players who went away are freed after 90 seconds. Seats in a running match are kept until the match ends.
- **Logs:** look for `Socket handler error`.
