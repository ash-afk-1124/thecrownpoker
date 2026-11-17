import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPokerServer } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
const num = (v: string | undefined, fallback: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : fallback);

const port = num(process.env.PORT, 3001);
const host = process.env.HOST ?? '0.0.0.0';

const server = createPokerServer({
  publicUrl: process.env.PUBLIC_URL || undefined,
  // Built bundle lives at dist/server/index.js, the React build at dist/client.
  clientDir: process.env.CLIENT_DIR ?? path.resolve(here, '../client'),
  corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()) : undefined,
  turnMs: num(process.env.TURN_SECONDS, 30) * 1000,
  nextHandMs: num(process.env.NEXT_HAND_SECONDS, 6) * 1000,
});

server.httpServer.listen(port, host, () => {
  console.log(`Poker server listening on http://${host}:${port}`);
  if (process.env.PUBLIC_URL) console.log(`Invite links will use ${process.env.PUBLIC_URL}`);
});

const shutdown = () => {
  console.log('Shutting down…');
  server.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
