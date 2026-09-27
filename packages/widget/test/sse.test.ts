import { describe, expect, it } from 'vitest';
import { SseDecoder, toChatEvent } from '../src/api/sse';

describe('SseDecoder', () => {
  it('returns one payload per completed frame', () => {
    const decoder = new SseDecoder();
    expect(decoder.push('event: probe\ndata: {"a":1}\n\nevent: probe\ndata: {"a":2}\n\n')).toEqual([
      '{"a":1}',
      '{"a":2}',
    ]);
  });

  it('waits for the blank line before emitting a split frame', () => {
    const decoder = new SseDecoder();
    expect(decoder.push('data: {"ty')).toEqual([]);
    expect(decoder.push('pe":"error"}\n\n')).toEqual(['{"type":"error"}']);
  });

  it('joins multi-line data and skips comments', () => {
    const decoder = new SseDecoder();
    expect(decoder.push(': ping\n\ndata: one\ndata: two\n\n')).toEqual(['one\ntwo']);
  });

  it('handles CRLF and flushes an unterminated tail', () => {
    const decoder = new SseDecoder();
    expect(decoder.push('data: {"x":1}\r\n\r\ndata: {"x":2}')).toEqual(['{"x":1}']);
    expect(decoder.flush()).toEqual(['{"x":2}']);
  });
});

describe('toChatEvent', () => {
  it('rejects anything that is not a known event', () => {
    expect(toChatEvent('not json')).toBeNull();
    expect(toChatEvent('{"type":"nope"}')).toBeNull();
    expect(toChatEvent('{"type":"conversation"}')).toBeNull();
  });

  it('coerces a probe result and defaults its missing fields', () => {
    const event = toChatEvent('{"type":"probe","probe":"docs","status":"done","result":{"hit":true}}');
    expect(event).toEqual({
      type: 'probe',
      probe: 'docs',
      status: 'done',
      result: { probe: 'docs', hit: true, score: null, summary: '', evidence: null, latencyMs: 0 },
    });
  });

  it('keeps only well-formed steps and drops the plan when there are none', () => {
    const event = toChatEvent(
      '{"type":"answer","text":"ok","steps":[{"target":"a1","caption":"Open it","advanceOn":"click"},{"caption":"broken"}],"escalation":{"offered":false}}',
    );
    expect(event).toMatchObject({
      type: 'answer',
      steps: [{ target: 'a1', caption: 'Open it', advanceOn: 'click' }],
    });
    expect(toChatEvent('{"type":"answer","text":"ok","steps":[],"escalation":{"offered":false}}')).toMatchObject({
      steps: null,
    });
  });

  it('drops an escalation offer that has no request', () => {
    expect(toChatEvent('{"type":"answer","text":"ok","steps":null,"escalation":{"offered":true}}')).toMatchObject({
      escalation: { offered: false },
    });
  });
});

describe('toChatEvent with a route plan', () => {
  const control = { role: 'link', name: 'Change seats', landmark: 'main', href: '/trips/:id/seats', route: '/trips/:id' };

  it('keeps a later-page step that has no live id yet but names its control', () => {
    const event = toChatEvent(
      JSON.stringify({
        type: 'answer',
        text: 'ok',
        steps: [
          { target: 'a4', caption: 'Open My Booking', advanceOn: 'navigation' },
          { target: null, caption: 'Open Change seats', advanceOn: 'navigation', control },
          { target: null, caption: 'no identity', advanceOn: 'click' },
        ],
        escalation: { offered: false },
      }),
    );
    expect(event).toMatchObject({
      steps: [
        { target: 'a4', caption: 'Open My Booking' },
        { target: null, caption: 'Open Change seats', control },
      ],
    });
    expect((event as { steps: unknown[] }).steps).toHaveLength(2);
  });

  it('drops the plan when the first step has no live id, because there is nothing to draw', () => {
    const event = toChatEvent(
      JSON.stringify({
        type: 'answer',
        text: 'ok',
        steps: [{ target: null, caption: 'Open Change seats', advanceOn: 'navigation', control }],
        escalation: { offered: false },
      }),
    );
    expect(event).toMatchObject({ steps: null });
  });

  it('reads the plan summary, the sources and the route change', () => {
    const event = toChatEvent(
      JSON.stringify({
        type: 'answer',
        text: 'ok',
        steps: [{ target: 'a1', caption: 'Open it', advanceOn: 'click' }],
        escalation: { offered: false },
        plan: { source: 'graph', total: 3, destination: { route: '/trips/:id', title: 'Manage Trip' } },
        sources: [{ title: 'How do I change my seat?', url: '/help/how-do-i-change-my-seat' }, { title: '' }],
        routeChanged: true,
      }),
    );
    expect(event).toMatchObject({
      plan: { source: 'graph', total: 3, destination: { route: '/trips/:id', title: 'Manage Trip' } },
      sources: [{ title: 'How do I change my seat?', url: '/help/how-do-i-change-my-seat' }],
      routeChanged: true,
    });
    const plain = toChatEvent(
      '{"type":"answer","text":"ok","steps":null,"escalation":{"offered":false},"plan":{"source":"odd","total":"3"}}',
    );
    expect(plain).not.toHaveProperty('plan');
    expect(plain).not.toHaveProperty('routeChanged');
  });
});
