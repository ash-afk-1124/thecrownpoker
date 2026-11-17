import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { RoomManager, type PokerServer, type PokerSocket, type RoomOptions } from './rooms';

export interface PokerServerConfig extends Partial<RoomOptions> {
  /** Public base URL used in invite links, e.g. https://poker.example.com. */
  publicUrl?: string;
  /** Directory holding the built React app (index.html). Static serving is skipped if missing. */
  clientDir?: string;
  /** Extra origins allowed to open Socket.IO connections (only needed if the client is hosted elsewhere). */
  corsOrigins?: string[];
}

export interface RunningPokerServer {
  app: express.Express;
  httpServer: HttpServer;
  io: PokerServer;
  rooms: RoomManager;
  close: () => Promise<void>;
}

export function createPokerServer(config: PokerServerConfig = {}): RunningPokerServer {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  const httpServer = createServer(app);
  const io: PokerServer = new Server(httpServer, {
    cors: config.corsOrigins?.length ? { origin: config.corsOrigins } : undefined,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  const configuredUrl = config.publicUrl?.replace(/\/+$/, '');
  const publicUrl = (socket: PokerSocket) => {
    if (configuredUrl) return configuredUrl;
    const h = socket.handshake.headers;
    const proto = (h['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? 'http';
    const host = (h['x-forwarded-host'] as string | undefined) ?? h.host ?? 'localhost';
    return `${proto}://${host}`;
  };

  const rooms = new RoomManager(io, {
    turnMs: config.turnMs ?? 30_000,
    nextHandMs: config.nextHandMs ?? 6_000,
    lobbyGraceMs: config.lobbyGraceMs ?? 90_000,
    idleRoomMs: config.idleRoomMs ?? 30 * 60_000,
  }, publicUrl);

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, rooms: rooms.rooms.size });
  });
  app.get('/api/config', (req, res) => {
    res.json({ publicUrl: configuredUrl ?? `${req.protocol}://${req.get('host')}` });
  });

  const clientDir = config.clientDir;
  if (clientDir && existsSync(path.join(clientDir, 'index.html'))) {
    app.use('/assets', express.static(path.join(clientDir, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    // Single-page app: /, /solo and /room/123456 all load index.html (works on refresh too).
    app.get(/^\/(?!socket\.io|api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  return {
    app, httpServer, io, rooms,
    close: () => new Promise<void>((resolve) => {
      rooms.close();
      io.close(() => resolve());
    }),
  };
}
