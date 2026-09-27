import { describe, expect, it } from 'vitest';
import {
  CALL_OFF,
  callLabel,
  callReducer,
  shouldListen,
  shouldSpeak,
  type CallAction,
  type CallState,
} from '../src/ui/call';

function run(actions: CallAction[], from: CallState = CALL_OFF): CallState {
  return actions.reduce(callReducer, from);
}

describe('the call state machine', () => {
  it('starts off, and stays silent until a call begins', () => {
    expect(CALL_OFF.active).toBe(false);
    expect(shouldSpeak(CALL_OFF)).toBe(false);
    expect(shouldListen(CALL_OFF)).toBe(false);
    expect(callLabel(CALL_OFF)).toBe('');
  });

  it('listens as soon as the call starts', () => {
    const state = run([{ type: 'start' }]);
    expect(state).toEqual({ active: true, muted: false, phase: 'listening' });
    expect(shouldListen(state)).toBe(true);
    expect(shouldSpeak(state)).toBe(true);
    expect(callLabel(state)).toBe('Listening');
  });

  it('walks listening to thinking to speaking and back', () => {
    const heard = run([{ type: 'start' }, { type: 'heard' }]);
    expect(callLabel(heard)).toBe('Thinking');
    expect(shouldListen(heard)).toBe(false);

    const answering = callReducer(heard, { type: 'answered' });
    expect(callLabel(answering)).toBe('Speaking');
    expect(shouldListen(answering)).toBe(false);

    const back = callReducer(answering, { type: 'spoke' });
    expect(callLabel(back)).toBe('Listening');
    expect(shouldListen(back)).toBe(true);
  });

  it('goes back to listening when nothing was said', () => {
    const state = run([{ type: 'start' }, { type: 'heard' }, { type: 'unheard' }]);
    expect(state.phase).toBe('listening');
    expect(shouldListen(state)).toBe(true);
  });

  it('mutes the microphone without leaving the call', () => {
    const muted = run([{ type: 'start' }, { type: 'toggleMute' }]);
    expect(muted.active).toBe(true);
    expect(shouldListen(muted)).toBe(false);
    expect(shouldSpeak(muted)).toBe(true);
    expect(callLabel(muted)).toBe('Muted');

    const back = callReducer(muted, { type: 'toggleMute' });
    expect(shouldListen(back)).toBe(true);
    expect(callLabel(back)).toBe('Listening');
  });

  it('says what it is doing even while muted', () => {
    const muted = run([{ type: 'start' }, { type: 'toggleMute' }, { type: 'heard' }]);
    expect(callLabel(muted)).toBe('Thinking');
  });

  it('ends back at silence from any phase', () => {
    for (const phase of [[], [{ type: 'heard' } as const], [{ type: 'heard' } as const, { type: 'answered' } as const]]) {
      const state = run([{ type: 'start' }, ...phase, { type: 'end' }]);
      expect(state).toEqual(CALL_OFF);
      expect(shouldSpeak(state)).toBe(false);
    }
  });

  it('ignores everything but start while the call is off', () => {
    for (const action of ['end', 'toggleMute', 'heard', 'answered', 'spoke', 'unheard'] as const) {
      expect(callReducer(CALL_OFF, { type: action })).toEqual(CALL_OFF);
    }
  });

  it('does not restart a call that is already under way', () => {
    const speaking = run([{ type: 'start' }, { type: 'heard' }, { type: 'answered' }]);
    expect(callReducer(speaking, { type: 'start' })).toBe(speaking);
  });

  it('ignores phase moves that are out of order', () => {
    const listening = run([{ type: 'start' }]);
    expect(callReducer(listening, { type: 'spoke' })).toBe(listening);

    const thinking = callReducer(listening, { type: 'heard' });
    expect(callReducer(thinking, { type: 'heard' })).toBe(thinking);
    expect(callReducer(thinking, { type: 'spoke' })).toBe(thinking);
  });

  it('speaks an answer that arrives without a listening turn behind it', () => {
    // The host page can ask a question itself while a call is open.
    const listening = run([{ type: 'start' }]);
    const speaking = callReducer(listening, { type: 'answered' });
    expect(callLabel(speaking)).toBe('Speaking');
    expect(callReducer(speaking, { type: 'answered' })).toBe(speaking);
  });
});
