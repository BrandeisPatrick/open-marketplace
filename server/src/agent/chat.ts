// The in-app assistants: a streaming manual tool-use loop over the shared tool registry.
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { aiEnabled, config, type Effort } from '../config.js';
import { demoActor, getOrCreateConversation, saveConversation } from '../marketplace/store.js';
import { anthropicToolDefs, executeTool } from '../marketplace/tools.js';
import { ToolError, type Actor, type ChatEvent, type Role } from '../marketplace/types.js';
import { runOfflineTurn } from './offline.js';
import { systemPrompt } from './prompts.js';

export const MAX_ITERATIONS = 12;
export const MAX_TOKENS = 8192;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface ChatTurnOptions {
  role: Role;
  message: string;
  emit: (event: ChatEvent) => void;
  /** Aborts the in-flight model request (e.g. the browser went away). */
  signal?: AbortSignal;
}

/** Test seams. Passing `client` forces the Claude path even without ANTHROPIC_API_KEY. */
export interface ChatTurnDeps {
  client?: Anthropic;
  model?: string;
  effort?: Effort;
  fallbacks?: boolean;
}

const activeTurns = new Set<Role>();

export function isTurnActive(role: Role): boolean {
  return activeTurns.has(role);
}

let sharedClient: Anthropic | undefined;
function defaultClient(): Anthropic {
  sharedClient ??= new Anthropic({ apiKey: config.anthropicApiKey });
  return sharedClient;
}

/**
 * Runs one assistant turn for the demo actor of `role`: appends the user message to that actor's conversation,
 * streams ChatEvents through `emit`, persists the conversation, and always finishes with exactly one `done` or
 * `error` (unless aborted). One turn per role at a time.
 */
export async function runChatTurn(opts: ChatTurnOptions, deps: ChatTurnDeps = {}): Promise<void> {
  if (activeTurns.has(opts.role)) {
    opts.emit({ type: 'error', message: 'The assistant is still answering the previous message. Wait for it to finish, then try again.' });
    return;
  }
  activeTurns.add(opts.role);
  try {
    const actor = demoActor(opts.role);
    if (deps.client || aiEnabled()) await runClaudeTurn(actor, opts, deps);
    else await runOfflineTurn({ actor, message: opts.message, emit: opts.emit });
  } finally {
    activeTurns.delete(opts.role);
  }
}

// ─── history hygiene ───────────────────────────────────────────────────────

/** Hash of everything a thinking block's signature is bound to besides the messages themselves. */
export function promptFingerprint(model: string, system: string, tools: Anthropic.Tool[]): string {
  return createHash('sha256').update(JSON.stringify({ model, system, tools })).digest('hex').slice(0, 32);
}

/**
 * Removes thinking blocks from earlier turns. Used once when the model, system prompt or tools changed since the
 * stored blocks were produced: replaying them would be rejected as bound to a different conversation prefix.
 */
export function stripThinking(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant' || typeof m.content === 'string') {
      out.push(m);
      continue;
    }
    const content = m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
    if (content.length > 0) out.push({ ...m, content });
  }
  return out;
}

/** Drops anything a crash could have left that the API would reject (a trailing unanswered tool_use, empty turns). */
function repairHistory(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out = messages.filter((m) => typeof m.content === 'string' || m.content.length > 0);
  const last = out.at(-1);
  if (last?.role === 'assistant' && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_use')) out.pop();
  return out;
}

/**
 * After a mid-output server-side fallback, blocks the declining model produced before the last `fallback` marker
 * must not be echoed back except text; the marker itself is an audit block we drop so history stays plain.
 */
function echoableFallbackContent(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaContentBlock[] {
  const boundary = content.map((b) => b.type).lastIndexOf('fallback');
  if (boundary === -1) return content;
  return content.filter((b, i) => b.type !== 'fallback' && (i > boundary || b.type === 'text'));
}

// ─── one model call ────────────────────────────────────────────────────────

interface StepRequest {
  client: Anthropic;
  model: string;
  effort: Effort;
  fallbacks: boolean;
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  signal?: AbortSignal;
  onText: (delta: string) => void;
  onTextBlockStart: () => void;
}

interface StepResult {
  stopReason: string | null;
  content: Anthropic.ContentBlockParam[];
  inputTokens: number;
  outputTokens: number;
}

function usageTotals(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
  };
}

async function streamStep(req: StepRequest): Promise<StepResult> {
  // Stable system prompt with an explicit breakpoint (caches tools + system), plus top-level automatic caching
  // for the growing conversation tail. `thinking` is omitted: adaptive is the default and the only option on Opus 5.5.
  const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }];
  const messages = [...req.messages];

  if (req.fallbacks) {
    const stream = req.client.beta.messages.stream(
      {
        model: req.model,
        max_tokens: MAX_TOKENS,
        system,
        tools: req.tools,
        messages,
        output_config: { effort: req.effort },
        cache_control: { type: 'ephemeral' },
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      },
      { signal: req.signal },
    );
    stream.on('streamEvent', (event) => {
      if (event.type === 'content_block_start' && event.content_block.type === 'text') req.onTextBlockStart();
    });
    stream.on('text', req.onText);
    const message = await stream.finalMessage();
    return {
      stopReason: message.stop_reason,
      // Narrowed back to the non-beta param type we persist (same JSON; fallback markers removed above).
      content: echoableFallbackContent(message.content) as unknown as Anthropic.ContentBlockParam[],
      ...usageTotals(message.usage),
    };
  }

  const stream = req.client.messages.stream(
    {
      model: req.model,
      max_tokens: MAX_TOKENS,
      system,
      tools: req.tools,
      messages,
      output_config: { effort: req.effort },
      cache_control: { type: 'ephemeral' },
    },
    { signal: req.signal },
  );
  stream.on('streamEvent', (event) => {
    if (event.type === 'content_block_start' && event.content_block.type === 'text') req.onTextBlockStart();
  });
  stream.on('text', req.onText);
  const message = await stream.finalMessage();
  return { stopReason: message.stop_reason, content: message.content, ...usageTotals(message.usage) };
}

// ─── the loop ──────────────────────────────────────────────────────────────

const REFUSAL_MESSAGE =
  "Claude declined to continue with this request. Try rephrasing it; if it keeps happening, clear the conversation.";

async function runClaudeTurn(actor: Actor, opts: ChatTurnOptions, deps: ChatTurnDeps): Promise<void> {
  const { emit, signal } = opts;
  const client = deps.client ?? defaultClient();
  const model = deps.model ?? config.model;
  const effort = deps.effort ?? config.effort;
  const fallbacks = deps.fallbacks ?? config.fallbacks;
  const system = systemPrompt(actor);
  const tools = anthropicToolDefs(actor);
  const fingerprint = promptFingerprint(model, system, tools);

  const conversation = getOrCreateConversation(actor, 'claude');
  let messages = repairHistory(conversation.messages);
  if (conversation.fingerprint !== fingerprint) messages = stripThinking(messages);
  messages.push({ role: 'user', content: opts.message });
  const userIndex = messages.length - 1;
  const persist = () => saveConversation(conversation.id, messages, fingerprint);
  // If a turn fails before the assistant produced anything we keep, drop the user message too, so the stored
  // history only holds completed exchanges (and a refused message isn't re-sent with every later request).
  const rollbackIfUnanswered = () => {
    if (messages.length - 1 === userIndex) {
      messages.splice(userIndex, 1);
      persist();
    }
  };
  persist();

  const usage = { input_tokens: 0, output_tokens: 0 };
  // The client renders text_deltas into one bubble until the next tool_result; separate consecutive text blocks.
  let lastEmitted: 'text' | 'tool' | null = null;
  let pendingSeparator = false;
  const onText = (delta: string) => {
    if (!delta) return;
    emit({ type: 'text_delta', text: pendingSeparator && lastEmitted === 'text' ? `\n\n${delta}` : delta });
    pendingSeparator = false;
    lastEmitted = 'text';
  };
  const onTextBlockStart = () => {
    pendingSeparator = true;
  };

  try {
    for (let step = 0; step < MAX_ITERATIONS; step++) {
      if (signal?.aborted) {
        rollbackIfUnanswered();
        return;
      }
      emit({ type: 'status', text: 'thinking' });
      const result = await streamStep({
        client, model, effort, fallbacks, system, tools, messages, signal, onText, onTextBlockStart,
      });
      usage.input_tokens += result.inputTokens;
      usage.output_tokens += result.outputTokens;

      // A refusal can cut a tool_use off mid-input: never run that turn's tools, and don't keep the partial.
      if (result.stopReason === 'refusal') {
        rollbackIfUnanswered();
        emit({ type: 'error', message: REFUSAL_MESSAGE });
        return;
      }
      const toolUses = result.content.filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use');
      // A tool input cut off by the token limit can still parse as a (wrong) partial object: don't run it.
      if ((result.stopReason === 'max_tokens' || result.stopReason === 'model_context_window_exceeded') && toolUses.length > 0) {
        rollbackIfUnanswered();
        emit({ type: 'error', message: 'The reply was cut off in the middle of a tool call. Please try again with a smaller request.' });
        return;
      }

      if (result.content.length > 0) messages.push({ role: 'assistant', content: result.content });

      if (result.stopReason === 'pause_turn') {
        persist();
        continue;
      }
      if (result.stopReason === 'end_turn' || toolUses.length === 0) {
        persist();
        emit({ type: 'done', usage });
        return;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of toolUses) {
        emit({ type: 'tool_call', id: call.id, name: call.name, input: call.input });
        try {
          const output = executeTool(actor, call.name, call.input, 'chat');
          results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(output) });
          emit({ type: 'tool_result', id: call.id, name: call.name, ok: true, result: output });
        } catch (err) {
          const message = err instanceof ToolError ? err.message : 'Internal error while running the tool.';
          results.push({ type: 'tool_result', tool_use_id: call.id, content: message, is_error: true });
          emit({ type: 'tool_result', id: call.id, name: call.name, ok: false, result: message });
        }
        lastEmitted = 'tool';
      }
      messages.push({ role: 'user', content: results });
      persist();
    }
    emit({ type: 'error', message: `Stopped after ${MAX_ITERATIONS} steps without finishing. Try a more specific request.` });
  } catch (err) {
    rollbackIfUnanswered();
    if (err instanceof Anthropic.APIUserAbortError || signal?.aborted) return;
    emit({ type: 'error', message: friendlyError(err, model) });
  }
}

function apiMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  return typeof body?.error?.message === 'string' ? body.error.message : err.message;
}

/** SDK errors -> short, actionable text for the chat UI. Most specific classes first. */
export function friendlyError(err: unknown, model: string): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env and restart the server.';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return `This API key does not have access to ${model}. Set MARKETPLACE_MODEL in .env to a model your key can use.`;
  }
  if (err instanceof Anthropic.NotFoundError) {
    return `Model "${model}" was not found. Check MARKETPLACE_MODEL in .env.`;
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Claude is rate-limited right now. Wait a few seconds and try again.';
  }
  if (err instanceof Anthropic.BadRequestError) {
    console.error('[chat] request rejected:', err.message);
    return `Claude rejected the request: ${apiMessage(err)} If this keeps happening, clear the conversation.`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the Anthropic API. Check your network connection and try again.';
  }
  if (err instanceof Anthropic.InternalServerError) {
    return 'Claude is temporarily unavailable (server error or overloaded). Try again in a moment.';
  }
  if (err instanceof Anthropic.APIError) {
    console.error('[chat] API error:', err.status, err.message);
    return `Claude API error${err.status ? ` (${err.status})` : ''}: ${apiMessage(err)}`;
  }
  console.error('[chat] unexpected error:', err);
  return 'Something went wrong while talking to Claude. Please try again.';
}
