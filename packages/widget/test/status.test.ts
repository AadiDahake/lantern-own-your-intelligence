import { describe, expect, it } from 'vitest';
import { advanceTowards, FIRST_STAGE, nextStage, workLine, type WorkStage } from '../src/ui/status';
import type { ChatEvent, ProbeName, ProbeResult } from '../src/types';

function probeDone(probe: ProbeName): ChatEvent {
  const result: ProbeResult = {
    probe,
    hit: false,
    score: 0.2,
    summary: 'nothing',
    evidence: null,
    latencyMs: 12,
  };
  return { type: 'probe', probe, status: 'done', result };
}

/** The events one real turn emits, in the order the API sends them. */
const TURN: ChatEvent[] = [
  { type: 'conversation', conversationId: 'c1', messageId: 'm1' },
  { type: 'understanding', feature: 'dark mode', intent: 'product', memory: [] },
  { type: 'probe', probe: 'docs', status: 'running' },
  { type: 'probe', probe: 'interface', status: 'running' },
  { type: 'probe', probe: 'repository', status: 'running' },
  probeDone('docs'),
  probeDone('interface'),
  probeDone('repository'),
  { type: 'verdict', verdict: { outcome: 'absent', confidence: 0.9, reasoning: '', feature: 'dark mode' } },
];

function replay(events: ChatEvent[]): WorkStage[] {
  const seen: WorkStage[] = [];
  let stage = FIRST_STAGE;
  for (const event of events) {
    stage = nextStage(stage, event);
    seen.push(stage);
  }
  return seen;
}

describe('the working status', () => {
  it('walks the six stages in order across one real turn', () => {
    const seen = replay(TURN);
    expect(seen).toEqual([
      'reading',
      'docs',
      'docs',
      'docs',
      'docs',
      'page',
      'code',
      'deciding',
      'writing',
    ]);
  });

  it('goes straight to writing when the message runs no check', () => {
    for (const intent of ['chat', 'page'] as const) {
      const seen = replay([
        { type: 'conversation', conversationId: 'c1', messageId: 'm1' },
        { type: 'understanding', feature: '', intent, memory: [] },
      ]);
      expect(seen, intent).toEqual(['reading', 'writing']);
    }
  });

  it('starts by saying it is reading the question', () => {
    expect(FIRST_STAGE).toBe('reading');
    expect(workLine(FIRST_STAGE, 0)).toBe('Reading your question');
  });

  it('never moves backwards when the checks finish out of order', () => {
    const shuffled: ChatEvent[] = [
      probeDone('repository'),
      probeDone('docs'),
      probeDone('interface'),
    ];
    expect(replay(shuffled)).toEqual(['deciding', 'deciding', 'deciding']);
  });

  it('ignores events that say nothing about progress', () => {
    const answer: ChatEvent = { type: 'answer', text: 'hi', steps: null, escalation: { offered: false } };
    expect(nextStage('code', answer)).toBe('code');
    expect(nextStage('code', { type: 'error', message: 'no' })).toBe('code');
  });

  it('admits it is slow only after eight seconds', () => {
    expect(workLine('deciding', 7999)).toBe('Deciding');
    expect(workLine('deciding', 8000)).toBe('Deciding. Still working');
  });

  it('walks one readable step at a time towards a burst of events', () => {
    // All three checks land together, so the target jumps; the line must not.
    const target = replay(TURN).pop() as WorkStage;
    expect(target).toBe('writing');

    const walked: WorkStage[] = [];
    let shown = FIRST_STAGE;
    for (let tick = 0; tick < 8; tick += 1) {
      shown = advanceTowards(shown, target);
      walked.push(shown);
    }
    expect(walked).toEqual([
      'docs',
      'page',
      'code',
      'deciding',
      'writing',
      'writing',
      'writing',
      'writing',
    ]);
  });

  it('never shows a score', () => {
    for (const stage of replay(TURN)) {
      expect(workLine(stage, 9000)).not.toMatch(/\d/);
    }
  });
});
