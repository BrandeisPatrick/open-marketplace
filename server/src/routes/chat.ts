import { Router } from 'express';
import { z } from 'zod';
import { isTurnActive, runChatTurn } from '../agent/chat.js';
import { toTranscript } from '../agent/transcript.js';
import * as store from '../marketplace/store.js';
import type { ChatEvent, Role } from '../marketplace/types.js';

const RoleParam = z.enum(['buyer', 'seller']);
const ChatBody = z.object({
  role: RoleParam,
  message: z.string().trim().min(1, 'message must not be empty').max(8000),
});

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

function parseRole(raw: unknown): Role | undefined {
  const parsed = RoleParam.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function chatRoutes(): Router {
  const r = Router();

  r.get('/conversations/:role', (req, res) => {
    const role = parseRole(req.params.role);
    if (!role) {
      res.status(400).json({ error: 'role must be "buyer" or "seller"' });
      return;
    }
    const actor = store.demoActor(role);
    const conversation = store.getOrCreateConversation(actor);
    res.json({ id: conversation.id, role, actor, items: toTranscript(conversation.messages) });
  });

  r.delete('/conversations/:role', (req, res) => {
    const role = parseRole(req.params.role);
    if (!role) {
      res.status(400).json({ error: 'role must be "buyer" or "seller"' });
      return;
    }
    if (isTurnActive(role)) {
      res.status(409).json({ error: 'The assistant is still answering. Try again when it finishes.' });
      return;
    }
    store.deleteConversation(store.demoActor(role));
    res.json({ ok: true });
  });

  // One assistant turn, streamed as `data: <ChatEvent JSON>\n\n` lines; always ends after `done` or `error`.
  r.post('/chat', async (req, res) => {
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ') });
      return;
    }
    res.writeHead(200, SSE_HEADERS);
    res.flushHeaders();

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    let finished = false;
    const emit = (event: ChatEvent) => {
      if (finished || res.writableEnded || res.destroyed) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'done' || event.type === 'error') finished = true;
    };

    try {
      await runChatTurn({ role: parsed.data.role, message: parsed.data.message, emit, signal: controller.signal });
    } catch (err) {
      console.error('[chat] turn failed:', err);
      emit({ type: 'error', message: 'The assistant hit an unexpected error. Please try again.' });
    }
    if (!finished && !controller.signal.aborted) emit({ type: 'error', message: 'The assistant stopped without finishing.' });
    if (!res.writableEnded) res.end();
  });

  return r;
}
