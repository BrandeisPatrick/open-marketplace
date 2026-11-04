import cors from 'cors';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../mcp/server.js';
import { actorForToken, demoActor } from '../marketplace/store.js';
import type { Actor } from '../marketplace/types.js';

const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

/** `Authorization: Bearer <token>` or `X-Marketplace-Token: <token>`; no or unknown token -> the demo buyer. */
export function actorFromRequest(req: Request): Actor {
  const auth = req.get('authorization');
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
  return actorForToken(bearer ?? req.get('x-marketplace-token')) ?? demoActor('buyer');
}

function rpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

/**
 * Browser-based MCP clients (e.g. the MCP Inspector) may call from any localhost origin. Requests from other web
 * origins are refused, which also blocks DNS-rebinding attacks against this local server. Non-browser clients
 * (Claude Code, mcp-remote, curl) send no Origin header and are unaffected.
 */
function originGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get('origin');
  if (origin && !LOCAL_ORIGIN.test(origin)) {
    rpcError(res, 403, -32000, `Origin ${origin} is not allowed.`);
    return;
  }
  next();
}

export const mcpCors = cors({
  origin: (origin, cb) => cb(null, !origin || LOCAL_ORIGIN.test(origin)),
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'Mcp-Session-Id', 'Mcp-Protocol-Version', 'Last-Event-ID', 'X-Marketplace-Token'],
  exposedHeaders: ['Mcp-Session-Id'],
  maxAge: 600,
});

export function mcpRouter(): Router {
  const router = Router();
  router.use('/mcp', originGuard);

  // Stateless Streamable HTTP: a fresh server + transport per request, JSON responses (no SSE needed).
  router.post('/mcp', async (req: Request, res: Response) => {
    const actor = actorFromRequest(req);
    const server = createMcpServer(actor);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] request failed:', err);
      if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error');
    }
  });

  const notAllowed = (_req: Request, res: Response) => {
    res.setHeader('Allow', 'POST');
    rpcError(res, 405, -32000, 'Method not allowed.');
  };
  router.get('/mcp', notAllowed);
  router.delete('/mcp', notAllowed);

  return router;
}
