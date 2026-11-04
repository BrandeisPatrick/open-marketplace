import type Anthropic from '@anthropic-ai/sdk';
import type { TranscriptItem } from '../marketplace/types.js';

/** tool_result content is JSON text for our tools; fall back to the raw string for anything else. */
export function parseToolResultContent(content: Anthropic.ToolResultBlockParam['content']): unknown {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((b) => (b.type === 'text' ? b.text : '')).join('')
        : '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Stored Anthropic MessageParam[] -> replayable transcript. Thinking blocks are skipped; consecutive assistant
 * text (which the live stream renders as one bubble until the next tool result) is merged.
 */
export function toTranscript(messages: Anthropic.MessageParam[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const toolNames = new Map<string, string>();
  const pushAssistantText = (text: string) => {
    if (!text) return;
    const last = items.at(-1);
    if (last?.kind === 'assistant_text') last.text = `${last.text}\n\n${text}`;
    else items.push({ kind: 'assistant_text', text });
  };

  for (const message of messages) {
    if (typeof message.content === 'string') {
      if (message.role === 'user') items.push({ kind: 'user', text: message.content });
      else pushAssistantText(message.content);
      continue;
    }
    for (const block of message.content) {
      switch (block.type) {
        case 'text':
          if (message.role === 'user') items.push({ kind: 'user', text: block.text });
          else pushAssistantText(block.text);
          break;
        case 'tool_use':
          toolNames.set(block.id, block.name);
          items.push({ kind: 'tool_call', id: block.id, name: block.name, input: block.input });
          break;
        case 'tool_result':
          items.push({
            kind: 'tool_result',
            id: block.tool_use_id,
            name: toolNames.get(block.tool_use_id) ?? 'unknown',
            ok: !block.is_error,
            result: parseToolResultContent(block.content),
          });
          break;
        default:
          // thinking / redacted_thinking and other model-internal blocks are not part of the visible transcript
          break;
      }
    }
  }
  return items;
}

/** The most recent successful result of one of `names` in a conversation (used by the offline agent for "add the first one"). */
export function latestToolResult(messages: Anthropic.MessageParam[], names: string[]): { name: string; result: unknown } | undefined {
  const items = toTranscript(messages);
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === 'tool_result' && item.ok && names.includes(item.name)) return { name: item.name, result: item.result };
  }
  return undefined;
}
