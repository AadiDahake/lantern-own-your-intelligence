import { SseDecoder, toChatEvent } from './sse';
import { visitorId } from './visitor';
import type {
  ChatEvent,
  ChatRequest,
  EscalationView,
  FeedbackRating,
  FeedbackRequest,
  PageContext,
  ReportBlock,
} from '../types';

/** A move the user made on their own: the control they pressed and the page it came from. */
export type ObservedTransition = {
  fromUrl: string;
  fromTitle: string;
  control: { role: string; name: string; landmark?: string; href?: string };
};

export type ObserveInput = {
  page: PageContext;
  transition?: ObservedTransition;
};

/** Reporting either starts, or is refused for a reason the widget can explain. */
export type EscalateResult =
  | { ok: true; escalationId: string; status: string }
  | { ok: false; reason: ReportBlock };

export type ClientConfig = { apiBase: string; key: string };

export type AskOptions = {
  question: string;
  page: PageContext;
  conversationId?: string;
  continueFrom?: number;
  signal?: AbortSignal;
  onEvent: (event: ChatEvent) => void;
};

export class ApiClient {
  constructor(private readonly config: ClientConfig) {}

  private url(path: string): string {
    return `${this.config.apiBase.replace(/\/$/, '')}${path}`;
  }

  /** Streams /api/chat, handing every well-formed ChatEvent to `onEvent`. */
  async ask({ question, page, conversationId, continueFrom, signal, onEvent }: AskOptions): Promise<void> {
    const body: ChatRequest = { key: this.config.key, question, page, visitorId: visitorId() };
    if (conversationId) body.conversationId = conversationId;
    if (typeof continueFrom === 'number') body.continueFrom = continueFrom;

    const response = await fetch(this.url('/api/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Chat request failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const sse = new SseDecoder();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const payload of sse.push(decoder.decode(value, { stream: true }))) {
        const event = toChatEvent(payload);
        if (event) onEvent(event);
      }
    }
    for (const payload of sse.flush()) {
      const event = toChatEvent(payload);
      if (event) onEvent(event);
    }
  }

  async escalate(conversationId: string, messageId: string): Promise<EscalateResult> {
    const response = await fetch(this.url('/api/escalate'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: this.config.key, conversationId, messageId, visitorId: visitorId() }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      escalationId?: string;
      status?: string;
      reason?: string;
    };
    if (!response.ok || !body.escalationId) {
      return { ok: false, reason: body.reason === 'no_repository' ? 'no_repository' : 'failed' };
    }
    return { ok: true, escalationId: body.escalationId, status: body.status ?? 'queued' };
  }

  async escalation(id: string): Promise<EscalationView> {
    const response = await fetch(this.url(`/api/escalations/${encodeURIComponent(id)}?key=${encodeURIComponent(this.config.key)}`));
    if (!response.ok) throw new Error(`Could not read the report status (${response.status})`);
    return (await response.json()) as EscalationView;
  }

  /** Records whether one answer helped. Best effort: a failed rating never interrupts the chat. */
  async feedback(messageId: string, rating: FeedbackRating, note?: string): Promise<boolean> {
    const body: FeedbackRequest = { key: this.config.key, messageId, rating };
    if (note) body.note = note;
    try {
      const response = await fetch(this.url('/api/feedback'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Tells the site graph what this page looks like and, when there is one, the move that led
   * here. Best effort and fire-and-forget: the page may be unloading, and the graph is a
   * convenience the widget must never stall on.
   */
  async observe(input: ObserveInput): Promise<void> {
    try {
      await fetch(this.url('/api/site/observe'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: this.config.key, ...input }),
        keepalive: true,
      });
    } catch {
      // Nothing to do: the graph simply does not learn from this page.
    }
  }

  async transcribe(audio: Blob): Promise<string> {
    const form = new FormData();
    form.append('key', this.config.key);
    form.append('file', audio, 'speech.webm');
    const response = await fetch(this.url('/api/transcribe'), { method: 'POST', body: form });
    if (!response.ok) throw new Error(`Could not transcribe that (${response.status})`);
    const data = (await response.json()) as { text?: unknown };
    return typeof data.text === 'string' ? data.text : '';
  }

  /** Returns the raw mp3 response so the player can stream it as it arrives. */
  async speak(text: string, signal?: AbortSignal): Promise<Response> {
    const response = await fetch(this.url('/api/speak'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: this.config.key, text }),
      signal,
    });
    if (!response.ok) throw new Error(`Could not read that out (${response.status})`);
    return response;
  }
}
