import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteConversation, getConversation, streamChat } from '../api';
import { errorText } from '../lib/format';
import type { ChatEvent, ChatItem, Role } from '../types';

/** Folds one stream event into the transcript (pure; used with functional updates). */
export function applyEvent(items: ChatItem[], event: ChatEvent): ChatItem[] {
  switch (event.type) {
    case 'text_delta': {
      if (!event.text) return items;
      const last = items[items.length - 1];
      // The last item is only an assistant_text while that text is still open: a tool
      // call/result (or the user's message) always lands after it and closes it.
      if (last?.kind === 'assistant_text') {
        const next = items.slice();
        next[next.length - 1] = { kind: 'assistant_text', text: last.text + event.text };
        return next;
      }
      return [...items, { kind: 'assistant_text', text: event.text }];
    }
    case 'tool_call':
      return [...items, { kind: 'tool_call', id: event.id, name: event.name, input: event.input }];
    case 'tool_result':
      return [...items, { kind: 'tool_result', id: event.id, name: event.name, ok: event.ok, result: event.result }];
    case 'error':
      return [...items, { kind: 'error', message: event.message || 'The assistant hit an error.' }];
    default:
      return items;
  }
}

export type ChatState = {
  items: ChatItem[];
  /** True from send() until the stream ends (done / error / disconnect). */
  streaming: boolean;
  /** Latest `status` event text during a turn (e.g. "thinking"), cleared on content. */
  status: string | null;
  /** Last load/stream error message, if any. */
  error: string | null;
  /** History has been fetched (or failed to). */
  loaded: boolean;
  /** Number of completed turns; panels refetch when it changes. */
  turns: number;
  send: (text: string) => Promise<void>;
  reset: () => Promise<void>;
};

export function useChat(role: Role): ChatState {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [turns, setTurns] = useState(0);

  const busy = useRef(false);
  const active = useRef<AbortController | null>(null);
  // Set once the user sends/resets, so a slow history load can't clobber the live transcript.
  const touched = useRef(false);

  useEffect(() => {
    const ctrl = new AbortController();
    getConversation(role, ctrl.signal)
      .then((conv) => {
        if (!touched.current) setItems(Array.isArray(conv.items) ? conv.items : []);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setError(errorText(err));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoaded(true);
      });
    return () => {
      ctrl.abort();
      active.current?.abort();
    };
  }, [role]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy.current) return;
      busy.current = true;
      touched.current = true;

      const ctrl = new AbortController();
      active.current = ctrl;
      setStreaming(true);
      setStatus(null);
      setError(null);
      setItems((prev) => [...prev, { kind: 'user', text }]);

      const turn = { ended: false };
      const onEvent = (event: ChatEvent) => {
        if (ctrl.signal.aborted) return;
        switch (event.type) {
          case 'status':
            setStatus(event.text || null);
            return;
          case 'done':
            turn.ended = true;
            return;
          case 'error':
            turn.ended = true;
            setError(event.message);
            break;
          case 'text_delta':
          case 'tool_call':
            setStatus(null);
            break;
          default:
            break;
        }
        setItems((prev) => applyEvent(prev, event));
      };

      try {
        await streamChat(role, text, onEvent, ctrl.signal);
        if (!turn.ended && !ctrl.signal.aborted) {
          onEvent({ type: 'error', message: 'The reply was cut off — the connection closed before it finished.' });
        }
      } catch (err) {
        if (!ctrl.signal.aborted) onEvent({ type: 'error', message: errorText(err) });
      } finally {
        if (active.current === ctrl) {
          active.current = null;
          busy.current = false;
          setStreaming(false);
          setStatus(null);
          setTurns((n) => n + 1);
        }
      }
    },
    [role],
  );

  const reset = useCallback(async () => {
    touched.current = true;
    active.current?.abort();
    active.current = null;
    busy.current = false;
    setStreaming(false);
    setStatus(null);
    setError(null);
    setItems([]);
    try {
      await deleteConversation(role);
    } catch (err) {
      setError(errorText(err));
    }
  }, [role]);

  return { items, streaming, status, error, loaded, turns, send, reset };
}
