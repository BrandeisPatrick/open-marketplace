// A tiny stand-in for the Anthropic Messages API that streams scripted SSE responses, so the real SDK code path
// (client.messages.stream -> on('text') -> finalMessage()) can be exercised without a key or network.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type MockBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; signature: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'fallback'; from: string; to: string };

export type MockReply =
  | { kind: 'stream'; blocks: MockBlock[]; stop_reason: string; delayMs?: number }
  | { kind: 'error'; status: number; type: string; message: string };

export interface RecordedRequest {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

function frame(type: string, data: object): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

function streamBody(reply: Extract<MockReply, { kind: 'stream' }>, n: number): string {
  let out = frame('message_start', {
    message: {
      id: `msg_mock_${n}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 5 },
    },
  });
  reply.blocks.forEach((block, index) => {
    switch (block.type) {
      case 'text': {
        out += frame('content_block_start', { index, content_block: { type: 'text', text: '' } });
        const mid = Math.ceil(block.text.length / 2);
        for (const part of [block.text.slice(0, mid), block.text.slice(mid)]) {
          if (part) out += frame('content_block_delta', { index, delta: { type: 'text_delta', text: part } });
        }
        break;
      }
      case 'thinking':
        out += frame('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
        out += frame('content_block_delta', { index, delta: { type: 'signature_delta', signature: block.signature } });
        break;
      case 'tool_use':
        out += frame('content_block_start', { index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
        out += frame('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
        break;
      case 'fallback':
        out += frame('content_block_start', { index, content_block: { type: 'fallback', from: { model: block.from }, to: { model: block.to } } });
        break;
    }
    out += frame('content_block_stop', { index });
  });
  out += frame('message_delta', { delta: { stop_reason: reply.stop_reason, stop_sequence: null }, usage: { output_tokens: 20 } });
  out += frame('message_stop', {});
  return out;
}

export async function startMockAnthropic(replies: MockReply[]) {
  const requests: RecordedRequest[] = [];
  let served = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      requests.push({ url: req.url ?? '', headers: req.headers, body: JSON.parse(raw || '{}') });
      const reply = replies[served++];
      if (!reply) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'mock: no scripted reply left' } }));
        return;
      }
      if (reply.kind === 'error') {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: reply.type, message: reply.message } }));
        return;
      }
      if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.end(streamBody(reply, served));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
