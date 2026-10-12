import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/api/client';
import { toChatEvent } from '../src/api/sse';
import {
  NOTICE_COPY,
  NOTICE_ERROR,
  NOTICE_HINT,
  NOTICE_LABEL,
  NOTICE_PLACEHOLDER,
  noticeStands,
  readNotice,
} from '../src/ui/textNotice';

const REQUEST = { title: 'Seat a party together', description: 'd', area: 'seats', quote: 'q', rationale: 'r' };

describe('what the report sends about the text', () => {
  it('sends nothing when the box is not ticked, whatever is in the field', () => {
    expect(readNotice(false, '')).toEqual({ ok: true });
    expect(readNotice(false, '+1 415 555 0123')).toEqual({ ok: true });
    expect(readNotice(false, 'not a number')).toEqual({ ok: true });
  });

  it('sends the number as it is dialled when the box is ticked', () => {
    expect(readNotice(true, ' +1 (415) 555-0123 ')).toEqual({ ok: true, phone: '+14155550123' });
    expect(readNotice(true, '+44 (0)20 7946 0958')).toEqual({ ok: true, phone: '+442079460958' });
  });

  it.each(['', '   ', '415 555 0123', '+1 415 555 O123', '+1', 'call me'])(
    'is an error for %j with the box ticked, never a report with no text',
    (typed) => {
      expect(readNotice(true, typed)).toEqual({ ok: false });
    },
  );

  it('shows an example that the rule itself accepts', () => {
    expect(readNotice(true, NOTICE_PLACEHOLDER)).toEqual({ ok: true, phone: '+14155550123' });
    expect(NOTICE_ERROR).toContain(NOTICE_PLACEHOLDER);
  });
});

describe('the words of the offer', () => {
  const said = [NOTICE_LABEL, NOTICE_HINT, ...Object.values(NOTICE_COPY)].join(' ').toLowerCase();

  it('promise a text when a change is drafted, and never that the feature is live', () => {
    expect(NOTICE_LABEL.toLowerCase()).toContain('drafted');
    expect(NOTICE_COPY.subscribed.toLowerCase()).toContain('drafted');
    for (const claim of ['ships', 'shipped', 'is live', 'released', 'available', 'ready to use']) {
      expect(said).not.toContain(claim);
    }
  });

  it('say how many texts, that one may never come, and what becomes of the number', () => {
    const hint = NOTICE_HINT.toLowerCase();
    expect(hint).toContain('one text');
    expect(hint).toContain('only if');
    expect(hint).toContain('encrypted');
    expect(hint).toContain('deleted after that text');
  });

  it('say that this report saved no number in each case where it did not', () => {
    // The exact claim: an earlier report of the same person can still have a number stored.
    expect(NOTICE_COPY.not_needed).toContain('This report did not save your number');
    expect(NOTICE_COPY.unavailable).toContain('this report did not save your number');
    expect(NOTICE_COPY.subscribed).not.toContain('did not save');
    for (const line of Object.values(NOTICE_COPY)) expect(line.toLowerCase()).not.toContain('not kept');
  });

  it('keep the promise of a text only while the draft is still to come', () => {
    expect(noticeStands('subscribed', 'drafting')).toBe(true);
    expect(noticeStands('subscribed', 'pr_open')).toBe(false);
    expect(noticeStands('subscribed', 'failed')).toBe(false);
    expect(noticeStands('not_needed', 'shipped')).toBe(true);
    expect(noticeStands('unavailable', 'rejected')).toBe(true);
  });

  it('have no em dash', () => {
    expect([NOTICE_LABEL, NOTICE_HINT, NOTICE_ERROR, ...Object.values(NOTICE_COPY)].join(' ')).not.toContain(String.fromCharCode(0x2014));
  });
});

describe('the offer in the answer event', () => {
  const answer = (escalation: unknown) =>
    toChatEvent(JSON.stringify({ type: 'answer', text: 'ok', steps: null, escalation }));

  it('carries the text offer only when the server sent true', () => {
    expect(answer({ offered: true, request: REQUEST, textNotice: true })).toMatchObject({
      escalation: { offered: true, textNotice: true },
    });
  });

  it.each([undefined, false, 'true', 1, null, {}])('reads textNotice %j as no offer of a text', (textNotice) => {
    const event = answer({ offered: true, request: REQUEST, textNotice });
    expect(event).toMatchObject({ escalation: { offered: true } });
    expect((event as { escalation: object }).escalation).not.toHaveProperty('textNotice');
  });

  it('never offers the text with no report to carry it', () => {
    const event = answer({ offered: false, textNotice: true });
    expect((event as { escalation: object }).escalation).toEqual({ offered: false });
  });
});

describe('the report request', () => {
  const client = new ApiClient({ apiBase: 'https://lantern.test/', key: 'pk_test' });

  function serve(status: number, body: unknown): { sent: () => Record<string, unknown> } {
    const fetched = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', fetched);
    return {
      sent: () => JSON.parse(String((fetched.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>,
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has no notify field when no text was asked for, and the result has no notice', async () => {
    const server = serve(200, { escalationId: 'e1', status: 'queued' });
    expect(await client.escalate('c1', 'm1')).toEqual({ ok: true, escalationId: 'e1', status: 'queued' });
    expect(server.sent()).not.toHaveProperty('notify');
    expect(server.sent()).toMatchObject({ key: 'pk_test', conversationId: 'c1', messageId: 'm1' });
  });

  it('sends the number with consent, and gives back what the server said', async () => {
    const server = serve(200, { escalationId: 'e1', status: 'queued', notify: 'subscribed' });
    expect(await client.escalate('c1', 'm1', '+14155550123')).toEqual({
      ok: true,
      escalationId: 'e1',
      status: 'queued',
      notice: 'subscribed',
    });
    expect(server.sent().notify).toEqual({ phone: '+14155550123', consent: true });
  });

  it.each(['not_needed', 'unavailable'])('gives back %s', async (notify) => {
    serve(200, { escalationId: 'e1', status: 'queued', notify });
    expect(await client.escalate('c1', 'm1', '+14155550123')).toMatchObject({ ok: true, notice: notify });
  });

  it.each([undefined, 'sent', true, { state: 'subscribed' }])(
    'reads an answer of %j as a text that was not set up',
    async (notify) => {
      // A server from before this field takes the report and does not store the number.
      serve(200, { escalationId: 'e1', status: 'queued', notify });
      expect(await client.escalate('c1', 'm1', '+14155550123')).toMatchObject({ ok: true, notice: 'unavailable' });
    },
  );

  it('ignores a notice in the answer when no text was asked for', async () => {
    serve(200, { escalationId: 'e1', status: 'queued', notify: 'subscribed' });
    expect(await client.escalate('c1', 'm1')).toEqual({ ok: true, escalationId: 'e1', status: 'queued' });
  });

  it('is a failed report, with no notice, when the server refuses the number', async () => {
    serve(400, { error: 'notify.phone must be a phone number', reason: 'invalid_phone' });
    expect(await client.escalate('c1', 'm1', '+14155550123')).toEqual({ ok: false, reason: 'failed' });
  });
});
