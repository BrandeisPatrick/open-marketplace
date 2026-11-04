import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promptFingerprint, runChatTurn, stripThinking, type ChatTurnDeps } from '../src/agent/chat.js';
import { OFFLINE_NOTICE, parseSearch } from '../src/agent/offline.js';
import { systemPrompt } from '../src/agent/prompts.js';
import { toTranscript } from '../src/agent/transcript.js';
import * as store from '../src/marketplace/store.js';
import { anthropicToolDefs } from '../src/marketplace/tools.js';
import type { ChatEvent } from '../src/marketplace/types.js';
import { buyer, captureEvents, freshDb, P, seller } from './helpers.js';
import { startMockAnthropic, type MockReply } from './mock-anthropic.js';

async function turn(role: 'buyer' | 'seller', message: string, deps?: ChatTurnDeps): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  await runChatTurn({ role, message, emit: (e) => out.push(e) }, deps);
  return out;
}

const types = (events: ChatEvent[]) => events.map((e) => e.type);

describe('offline agent', () => {
  beforeEach(freshDb);

  it('searches, then adds "the first one", streaming the same event types as the Claude loop', async () => {
    const first = await turn('buyer', 'find a mechanical keyboard');
    expect(types(first)).toEqual(['text_delta', 'text_delta', 'tool_call', 'tool_result', 'text_delta', 'done']);
    expect(first[0]).toEqual({ type: 'text_delta', text: OFFLINE_NOTICE });
    expect(first[2]).toMatchObject({ type: 'tool_call', name: 'search_products', input: { query: 'mechanical keyboard' } });
    const result = first[3] as Extract<ChatEvent, { type: 'tool_result' }>;
    expect(result.ok).toBe(true);
    expect((result.result as { products: unknown[] }).products.length).toBe(3);

    const second = await turn('buyer', 'add the first one to my cart');
    expect(types(second)).toEqual(['tool_call', 'tool_result', 'text_delta', 'done']); // notice only once
    expect(second[0]).toMatchObject({ name: 'add_to_cart', input: { product_id: P.tklKeyboard, quantity: 1 } });
    expect(store.getCart('usr_ada').item_count).toBe(1);

    const third = await turn('buyer', 'checkout');
    expect(second.concat(third).some((e) => e.type === 'tool_call' && e.name === 'checkout')).toBe(true);
    expect(store.getCart('usr_ada').item_count).toBe(0);
  });

  it('never checks out on a question about checkout', async () => {
    await turn('buyer', 'add 2 ' + P.candle);
    expect(store.getCart('usr_ada').item_count).toBe(2);
    const events = await turn('buyer', 'how does checkout work?');
    expect(events.some((e) => e.type === 'tool_call' && e.name === 'checkout')).toBe(false);
    expect(store.getCart('usr_ada').item_count).toBe(2);
  });

  it('handles seller intents', async () => {
    const stats = await turn('seller', 'how are sales?');
    expect(stats.find((e) => e.type === 'tool_call')).toMatchObject({ name: 'seller_stats' });
    const ship = await turn('seller', 'orders to ship');
    expect(ship.find((e) => e.type === 'tool_call')).toMatchObject({ name: 'get_seller_orders', input: { status: 'placed' } });
    const low = await turn('seller', "what's low on stock?");
    expect(low.find((e) => e.type === 'tool_call')).toMatchObject({ name: 'seller_stats' });
    const restock = await turn('seller', `set stock of ${P.chefKnife} to 20`);
    expect(restock.find((e) => e.type === 'tool_call')).toMatchObject({ name: 'update_listing', input: { product_id: P.chefKnife, stock: 20 } });
    expect(store.getProduct(P.chefKnife).stock).toBe(20);
    expect(types(restock).at(-1)).toBe('done');
  });

  it('parses prices, sorting and categories out of a request', () => {
    expect(parseSearch('cheap gifts under $50')).toEqual({ query: 'gifts', max_price: 50, sort: 'price_asc' });
    expect(parseSearch("I'm looking for kitchen stuff between $20 and $40")).toEqual({ category: 'kitchen', min_price: 20, max_price: 40 });
    expect(parseSearch('show me the best rated headphones in stock')).toEqual({ query: 'headphones', sort: 'rating', in_stock_only: true });
  });

  it('persists the turn so the transcript replays', async () => {
    await turn('buyer', 'find coffee');
    const items = toTranscript(store.getOrCreateConversation(buyer()).messages);
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant_text', 'tool_call', 'tool_result', 'assistant_text']);
    expect(items[0]).toEqual({ kind: 'user', text: 'find coffee' });
    expect(items[3]).toMatchObject({ kind: 'tool_result', name: 'search_products', ok: true });
  });
});

describe('transcript replay', () => {
  it('maps stored MessageParams to transcript items', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'find a mug' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: 'Looking.' },
          { type: 'tool_use', id: 'toolu_1', name: 'search_products', input: { query: 'mug' } },
          { type: 'tool_use', id: 'toolu_2', name: 'view_cart', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: JSON.stringify({ products: [], total: 0, query: 'mug' }) },
          { type: 'tool_result', tool_use_id: 'toolu_2', content: 'Cart unavailable', is_error: true },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'Nothing found.' }, { type: 'text', text: 'Try "cup".' }] },
      { role: 'user', content: [{ type: 'text', text: 'ok' }] },
      { role: 'assistant', content: 'Bye!' },
    ];
    expect(toTranscript(messages)).toEqual([
      { kind: 'user', text: 'find a mug' },
      { kind: 'assistant_text', text: 'Looking.' },
      { kind: 'tool_call', id: 'toolu_1', name: 'search_products', input: { query: 'mug' } },
      { kind: 'tool_call', id: 'toolu_2', name: 'view_cart', input: {} },
      { kind: 'tool_result', id: 'toolu_1', name: 'search_products', ok: true, result: { products: [], total: 0, query: 'mug' } },
      { kind: 'tool_result', id: 'toolu_2', name: 'view_cart', ok: false, result: 'Cart unavailable' },
      { kind: 'assistant_text', text: 'Nothing found.\n\nTry "cup".' },
      { kind: 'user', text: 'ok' },
      { kind: 'assistant_text', text: 'Bye!' },
    ]);
  });

  it('strips thinking blocks without leaving empty assistant turns', () => {
    const stripped = stripThinking([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's' }] },
      { role: 'assistant', content: [{ type: 'redacted_thinking', data: 'x' }, { type: 'text', text: 'Hello' }] },
    ]);
    expect(stripped).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
    ]);
  });
});

describe('Claude tool-use loop (mock Messages API)', () => {
  let mock: Awaited<ReturnType<typeof startMockAnthropic>> | undefined;
  beforeEach(freshDb);
  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  async function withMock(replies: MockReply[], extra: Partial<ChatTurnDeps> = {}): Promise<ChatTurnDeps> {
    mock = await startMockAnthropic(replies);
    return { client: new Anthropic({ apiKey: 'sk-test', baseURL: mock.baseURL, maxRetries: 0 }), ...extra };
  }

  it('streams text, runs every tool_use, feeds results back and persists the full history', async () => {
    const deps = await withMock([
      {
        kind: 'stream',
        stop_reason: 'tool_use',
        blocks: [
          { type: 'thinking', signature: 'sig-1' },
          { type: 'text', text: 'Let me look.' },
          { type: 'tool_use', id: 'toolu_a', name: 'search_products', input: { query: 'keyboard', max_price: 100 } },
          { type: 'tool_use', id: 'toolu_b', name: 'seller_stats', input: {} },
        ],
      },
      { kind: 'stream', stop_reason: 'end_turn', blocks: [{ type: 'text', text: 'The TKL board is the pick.' }] },
    ]);
    const domain = captureEvents();
    const events = await turn('buyer', 'find me a keyboard', deps);
    domain.stop();

    expect(types(events)).toEqual([
      'status', 'text_delta', 'text_delta', 'tool_call', 'tool_result', 'tool_call', 'tool_result', 'status', 'text_delta', 'text_delta', 'done',
    ]);
    expect(events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text).join('')).toBe(
      'Let me look.The TKL board is the pick.',
    );
    expect(events[3]).toEqual({ type: 'tool_call', id: 'toolu_a', name: 'search_products', input: { query: 'keyboard', max_price: 100 } });
    expect(events[4]).toMatchObject({ type: 'tool_result', id: 'toolu_a', name: 'search_products', ok: true });
    expect(events[6]).toMatchObject({ type: 'tool_result', id: 'toolu_b', ok: false, result: expect.stringMatching(/only available to sellers/) });
    expect(events.at(-1)).toEqual({ type: 'done', usage: { input_tokens: 230, output_tokens: 40 } });
    expect(domain.list.filter((e) => e.type === 'agent.tool_call').map((e) => e.source)).toEqual(['chat', 'chat']);

    // Request shape.
    const [first, second] = mock!.requests;
    expect(first!.url).toBe('/v1/messages');
    expect(first!.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 8192,
      stream: true,
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      system: [{ type: 'text', text: systemPrompt(buyer()), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'find me a keyboard' }],
    });
    expect(first!.body).not.toHaveProperty('thinking');
    expect(first!.body).not.toHaveProperty('tool_choice');
    expect((first!.body.tools as { name: string }[]).map((t) => t.name)).toEqual(anthropicToolDefs(buyer()).map((t) => t.name));
    const msgs = second!.body.messages as Anthropic.MessageParam[];
    expect(msgs).toHaveLength(3);
    expect(msgs[1]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'thinking', signature: 'sig-1' },
        { type: 'text', text: 'Let me look.' },
        { type: 'tool_use', id: 'toolu_a', name: 'search_products', input: { query: 'keyboard', max_price: 100 } },
        { type: 'tool_use', id: 'toolu_b', name: 'seller_stats', input: {} },
      ],
    });
    const results = msgs[2]!.content as Anthropic.ToolResultBlockParam[];
    expect(results.map((r) => [r.tool_use_id, r.is_error ?? false])).toEqual([
      ['toolu_a', false],
      ['toolu_b', true],
    ]);
    expect(JSON.parse(results[0]!.content as string).products.length).toBeGreaterThan(0);

    // Persisted history + fingerprint, and replay.
    const conv = store.getOrCreateConversation(buyer());
    expect(conv.messages).toHaveLength(4);
    expect(conv.fingerprint).toBe(promptFingerprint('claude-opus-5-5', systemPrompt(buyer()), anthropicToolDefs(buyer())));
    expect(toTranscript(conv.messages).map((i) => i.kind)).toEqual([
      'user', 'assistant_text', 'tool_call', 'tool_call', 'tool_result', 'tool_result', 'assistant_text',
    ]);
  });

  it('separates consecutive text blocks and keeps thinking blocks on the next turn', async () => {
    const deps = await withMock([
      { kind: 'stream', stop_reason: 'end_turn', blocks: [{ type: 'thinking', signature: 'sig-x' }, { type: 'text', text: 'One.' }, { type: 'text', text: 'Two.' }] },
      { kind: 'stream', stop_reason: 'end_turn', blocks: [{ type: 'text', text: 'Again.' }] },
    ]);
    const events = await turn('buyer', 'hello', deps);
    expect(events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text).join('')).toBe('One.\n\nTwo.');
    await turn('buyer', 'hello again', deps);
    const replayed = mock!.requests[1]!.body.messages as Anthropic.MessageParam[];
    expect(replayed.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect((replayed[1]!.content as { type: string }[])[0]).toMatchObject({ type: 'thinking', signature: 'sig-x' });
  });

  it('strips stored thinking blocks when the prompt fingerprint changed', async () => {
    const conv = store.getOrCreateConversation(buyer());
    store.saveConversation(
      conv.id,
      [
        { role: 'user', content: 'earlier' },
        { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'old' }, { type: 'text', text: 'Earlier reply' }] },
      ],
      'stale-fingerprint',
    );
    const deps = await withMock([{ kind: 'stream', stop_reason: 'end_turn', blocks: [{ type: 'text', text: 'Hi' }] }]);
    await turn('buyer', 'new question', deps);
    const sent = mock!.requests[0]!.body.messages as Anthropic.MessageParam[];
    expect(sent[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Earlier reply' }] });
  });

  it('stops on refusal without running tools or keeping the partial reply', async () => {
    const deps = await withMock([
      {
        kind: 'stream',
        stop_reason: 'refusal',
        blocks: [{ type: 'text', text: 'Sure, ' }, { type: 'tool_use', id: 'toolu_r', name: 'checkout', input: {} }],
      },
    ]);
    executeAdd();
    const events = await turn('buyer', 'buy everything', deps);
    expect(events.some((e) => e.type === 'tool_call')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/declined/) });
    expect(store.getCart('usr_ada').item_count).toBe(1); // checkout never ran
    expect(store.getOrCreateConversation(buyer()).messages).toEqual([]); // unanswered message rolled back
  });

  it('does not run a tool_use cut off by max_tokens', async () => {
    const deps = await withMock([
      { kind: 'stream', stop_reason: 'max_tokens', blocks: [{ type: 'tool_use', id: 'toolu_m', name: 'add_to_cart', input: { product_id: P.candle } }] },
    ]);
    const events = await turn('buyer', 'add a candle', deps);
    expect(events.some((e) => e.type === 'tool_call')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'error' });
    expect(store.getCart('usr_ada').item_count).toBe(0);
  });

  it('continues after pause_turn', async () => {
    const deps = await withMock([
      { kind: 'stream', stop_reason: 'pause_turn', blocks: [{ type: 'text', text: 'Working…' }] },
      { kind: 'stream', stop_reason: 'end_turn', blocks: [{ type: 'text', text: 'Done.' }] },
    ]);
    const events = await turn('seller', 'status?', deps);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect((mock!.requests[1]!.body.messages as Anthropic.MessageParam[]).map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('maps API errors to friendly messages', async () => {
    let deps = await withMock([{ kind: 'error', status: 401, type: 'authentication_error', message: 'invalid x-api-key' }]);
    let events = await turn('buyer', 'hi', deps);
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/ANTHROPIC_API_KEY/) });
    expect(store.getOrCreateConversation(buyer()).messages).toEqual([]);
    await mock!.close();

    deps = await withMock([{ kind: 'error', status: 429, type: 'rate_limit_error', message: 'slow down' }]);
    events = await turn('buyer', 'hi', deps);
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/rate-limited/) });
    await mock!.close();

    deps = await withMock([{ kind: 'error', status: 400, type: 'invalid_request_error', message: 'messages.1: bad block' }]);
    events = await turn('buyer', 'hi', deps);
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/messages\.1: bad block/) });
  });

  it('allows one turn per role at a time', async () => {
    const deps = await withMock([{ kind: 'stream', stop_reason: 'end_turn', blocks: [{ type: 'text', text: 'slow' }], delayMs: 300 }]);
    const a: ChatEvent[] = [];
    const b: ChatEvent[] = [];
    const first = runChatTurn({ role: 'seller', message: 'one', emit: (e) => a.push(e) }, deps);
    await runChatTurn({ role: 'seller', message: 'two', emit: (e) => b.push(e) }, deps);
    await first;
    expect(b).toEqual([{ type: 'error', message: expect.stringMatching(/still answering/) }]);
    expect(a.at(-1)).toMatchObject({ type: 'done' });
  });

  it('uses the beta endpoint with server-side fallbacks and drops the declined partial', async () => {
    const deps = await withMock(
      [
        {
          kind: 'stream',
          stop_reason: 'end_turn',
          blocks: [
            { type: 'text', text: 'Partial ' },
            { type: 'tool_use', id: 'toolu_x', name: 'view_cart', input: {} },
            { type: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-4-8' },
            { type: 'text', text: 'Rescued answer.' },
          ],
        },
      ],
      { fallbacks: true },
    );
    const events = await turn('seller', 'hello', deps);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    const req = mock!.requests[0]!;
    expect(req.url).toMatch(/^\/v1\/messages(\?beta=true)?$/);
    expect(req.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(req.body).toMatchObject({ fallbacks: 'default', output_config: { effort: 'medium' } });
    expect(req.body).not.toHaveProperty('betas');
    expect(store.getOrCreateConversation(seller()).messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Partial ' },
        { type: 'text', text: 'Rescued answer.' },
      ],
    });
  });
});

function executeAdd(): void {
  store.addToCart('usr_ada', P.candle, 1);
}
