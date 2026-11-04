import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { aiEnabled, config } from './config.js';
import { closeDb, getDb } from './db.js';
import { DEMO_TOKENS } from './marketplace/seed.js';
import { ToolError } from './marketplace/types.js';
import { apiRouter } from './routes/api.js';
import { mcpCors, mcpRouter } from './routes/mcp.js';

const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

export function createApp(): express.Express {
  getDb(); // open, migrate and seed up front so configuration problems surface at startup

  const app = express();
  app.disable('x-powered-by');
  // Any localhost origin may call the API directly (the Vite dev server can land on 5174+ when 5173 is busy).
  app.use('/api', cors({ origin: (origin, cb) => cb(null, !origin || LOCAL_ORIGIN.test(origin)) }));
  app.use('/mcp', mcpCors);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', apiRouter());
  app.use(mcpRouter());

  if (config.serveWeb) {
    // Production: the built UI with an SPA fallback (never for /api or /mcp).
    app.use(express.static(config.webDist));
    app.use((req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || /^\/(?:api|mcp)(?:\/|$)/.test(req.path)) return next();
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.json({
        name: 'ai-marketplace',
        ui: config.webOrigin,
        health: '/api/health',
        mcp: '/mcp',
        hint: 'Run `npm run dev` from the repo root and open the UI; `npm start` serves web/dist here once it is built.',
      });
    });
  }

  app.use(errorHandler);
  return app;
}

function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const status =
    err instanceof ToolError ? 400 : typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 500;
  if (status >= 500) console.error(`[http] ${req.method} ${req.originalUrl} failed:`, err);
  if (res.headersSent) {
    res.end();
    return;
  }
  const parseFailed = (err as { type?: unknown })?.type === 'entity.parse.failed';
  if (req.path === '/mcp' || req.path.startsWith('/mcp/')) {
    res.status(status).json({
      jsonrpc: '2.0',
      error: parseFailed ? { code: -32700, message: 'Parse error' } : { code: -32603, message: 'Internal server error' },
      id: null,
    });
    return;
  }
  const message =
    parseFailed ? 'Request body is not valid JSON.' : status < 500 && err instanceof Error ? err.message : 'Internal server error';
  res.status(status).json({ error: message });
}

export function startServer(port: number = config.port) {
  const app = createApp();
  const server = app.listen(port, (err?: Error) => {
    if (err) {
      console.error(`[server] could not listen on port ${port}:`, err.message);
      process.exit(1);
    }
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const base = `http://localhost:${actualPort}`;
    console.log(`\nAI Marketplace server  ${base}`);
    console.log(
      aiEnabled()
        ? `  AI assistants  on (${config.model}, effort ${config.effort}${config.fallbacks ? ', server-side fallbacks' : ''})`
        : '  AI assistants  OFF: set ANTHROPIC_API_KEY in .env to enable them (offline keyword mode for now)',
    );
    console.log(`  MCP endpoint   ${base}/mcp  (tokens: buyer ${DEMO_TOKENS.buyer}, seller ${DEMO_TOKENS.seller})`);
    console.log(`  Claude Code    claude mcp add --transport http marketplace ${base}/mcp --header "Authorization: Bearer ${DEMO_TOKENS.buyer}"`);
    console.log(`  Database       ${config.dbPath}`);
    console.log(config.serveWeb ? `  UI             ${base} (web/dist)` : `  UI             ${config.webOrigin} (Vite dev server)`);
    console.log('');
  });

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal} received, shutting down…`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) startServer();
