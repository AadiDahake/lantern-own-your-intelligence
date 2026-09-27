import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GuideMachine, type GuideSnapshot } from '../src/guide/machine';
import { scanAffordances, type ScanResult } from '../src/scan/affordances';
import type { Step } from '../src/types';

const QUESTION = 'change my username';

const FIXTURE = `
  <main>
    <button id="account" aria-label="Open the account menu">A</button>
    <button id="update">Update profile</button>
  </main>
`;

function scan(): ScanResult {
  return scanAffordances({ question: QUESTION });
}

function idFor(result: ScanResult, name: string): string {
  const affordance = result.page.affordances.find((entry) => entry.name === name);
  if (!affordance) throw new Error(`no affordance named ${name}`);
  return affordance.id;
}

const tick = () => new Promise((done) => setTimeout(done, 0));

/** Enough turns of the event loop for a settle, a bind attempt, a recovery and a re-plan. */
async function flush(turns = 12): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await tick();
}

/** jsdom has no layout, so geometry-dependent behaviour needs rects supplied by hand. */
function boxes(spec: Record<string, [number, number, number, number]>): () => void {
  const undo: (() => void)[] = [];
  for (const [selector, [left, top, width, height]] of Object.entries(spec)) {
    const element = selector === ':root' ? document.documentElement : document.querySelector(selector);
    if (!element) continue;
    const rect = { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
    const original = element.getBoundingClientRect;
    Object.defineProperty(element, 'getBoundingClientRect', { value: () => rect, configurable: true });
    undo.push(() => Object.defineProperty(element, 'getBoundingClientRect', { value: original, configurable: true }));
  }
  return () => { for (const step of undo) step(); };
}

beforeEach(() => {
  document.body.innerHTML = FIXTURE;
});

function build(steps: Step[], overrides: Partial<Parameters<typeof buildDeps>[0]> = {}) {
  return buildDeps({ steps, ...overrides });
}

function buildDeps(options: {
  steps: Step[];
  replan?: () => Promise<(ScanResult & { steps: Step[] }) | null>;
}) {
  const snapshots: GuideSnapshot[] = [];
  const rescan = vi.fn(() => scan());
  const replan = vi.fn(options.replan ?? (async () => null));
  let notifyPageChanged = () => {};
  const machine = new GuideMachine({
    rescan,
    replan,
    onChange: (snapshot) => snapshots.push(snapshot),
    watch: (callback) => {
      notifyPageChanged = callback;
      return () => {};
    },
    settleMs: 0,
    // jsdom renders nothing, so there is nothing to wait for before the last look.
    bindTimeoutMs: 0,
  });
  return {
    machine,
    snapshots,
    rescan,
    replan,
    pageChanged: () => notifyPageChanged(),
    start: () => machine.start(scan(), options.steps),
  };
}

describe('GuideMachine', () => {
  it('spotlights the first step when guidance starts', () => {
    const initial = scan();
    const steps: Step[] = [
      { target: idFor(initial, 'Open the account menu'), caption: 'Open the account menu', advanceOn: 'click' },
    ];
    const harness = build(steps);
    harness.start();
    expect(harness.machine.snapshot.state).toBe('SPOTLIGHTING');
    expect(harness.machine.snapshot.target).toBe(document.getElementById('account'));
  });

  it('advances when the user clicks the spotlit control', async () => {
    const initial = scan();
    const steps: Step[] = [
      { target: idFor(initial, 'Open the account menu'), caption: 'Open the account menu', advanceOn: 'click' },
      { target: idFor(initial, 'Update profile'), caption: 'Save with Update profile', advanceOn: 'click' },
    ];
    const harness = build(steps);
    harness.start();

    document.getElementById('account')?.click();
    expect(harness.machine.snapshot.state).toBe('VERIFYING');
    await tick();

    expect(harness.machine.snapshot.stepIndex).toBe(1);
    expect(harness.machine.snapshot.state).toBe('SPOTLIGHTING');
    expect(harness.machine.snapshot.target).toBe(document.getElementById('update'));
    expect(harness.snapshots.map((snapshot) => snapshot.state)).toContain('SNAPSHOTTING');
  });

  it('ignores clicks that land somewhere else', async () => {
    const initial = scan();
    const steps: Step[] = [
      { target: idFor(initial, 'Open the account menu'), caption: 'Open the account menu', advanceOn: 'click' },
      { target: idFor(initial, 'Update profile'), caption: 'Save', advanceOn: 'click' },
    ];
    const harness = build(steps);
    harness.start();

    document.getElementById('update')?.click();
    await tick();
    expect(harness.machine.snapshot.stepIndex).toBe(0);
    expect(harness.machine.snapshot.state).toBe('SPOTLIGHTING');
  });

  it('re-scans and stays on the step when the target remounts without a click', async () => {
    const initial = scan();
    const steps: Step[] = [
      { target: idFor(initial, 'Open the account menu'), caption: 'Open the account menu', advanceOn: 'click' },
      { target: idFor(initial, 'Update profile'), caption: 'Save', advanceOn: 'click' },
    ];
    const harness = build(steps);
    harness.start();
    const before = harness.rescan.mock.calls.length;

    const account = document.getElementById('account') as HTMLElement;
    account.replaceWith(account.cloneNode(true));
    harness.pageChanged();
    await tick();

    expect(harness.rescan.mock.calls.length).toBeGreaterThan(before);
    expect(harness.machine.snapshot.stepIndex).toBe(0);
    expect(harness.machine.snapshot.state).toBe('SPOTLIGHTING');
    expect(harness.machine.snapshot.target).toBe(document.getElementById('account'));
    expect(harness.replan).not.toHaveBeenCalled();
  });

  it('re-plans through the agent when the target is really gone', async () => {
    const initial = scan();
    const steps: Step[] = [
      { target: idFor(initial, 'Open the account menu'), caption: 'Open the account menu', advanceOn: 'click' },
      { target: idFor(initial, 'Update profile'), caption: 'Save', advanceOn: 'click' },
    ];
    const harness = build(steps, {
      replan: async () => {
        const fresh = scan();
        return { ...fresh, steps: [{ target: idFor(fresh, 'Update profile'), caption: 'Save', advanceOn: 'click' }] };
      },
    });
    harness.start();

    document.getElementById('account')?.remove();
    harness.pageChanged();
    await flush();

    expect(harness.replan).toHaveBeenCalledWith(0);
    expect(harness.machine.snapshot.state).toBe('SPOTLIGHTING');
    expect(harness.machine.snapshot.target).toBe(document.getElementById('update'));
  });

  it('fails cleanly when the agent cannot re-plan', async () => {
    const initial = scan();
    const steps: Step[] = [
      { target: idFor(initial, 'Open the account menu'), caption: 'Open the account menu', advanceOn: 'click' },
    ];
    const harness = build(steps);
    harness.start();

    document.getElementById('account')?.remove();
    harness.pageChanged();
    await flush();

    expect(harness.machine.snapshot.state).toBe('FAILED');
  });

  it('finishes after the last step and stops listening', async () => {
    const initial = scan();
    const steps: Step[] = [
      { target: idFor(initial, 'Update profile'), caption: 'Save', advanceOn: 'click' },
    ];
    const harness = build(steps);
    harness.start();

    document.getElementById('update')?.click();
    await tick();
    expect(harness.machine.snapshot.state).toBe('DONE');

    document.getElementById('update')?.click();
    await tick();
    expect(harness.machine.snapshot.state).toBe('DONE');
  });

  it('counts a press whose control is removed before the click as success', async () => {
    // Menus dismiss on pointerdown, so the node the user pressed is gone before
    // the browser can deliver a click. The press is the only evidence there is.
    const initial = scan();
    const steps: Step[] = [
      { target: idFor(initial, 'Open the account menu'), caption: 'Open the account menu', advanceOn: 'click' },
      { target: idFor(initial, 'Update profile'), caption: 'Save', advanceOn: 'click' },
    ];
    const harness = build(steps);
    harness.start();

    const account = document.getElementById('account') as HTMLElement;
    account.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    account.remove();
    await flush();

    expect(harness.machine.snapshot.stepIndex).toBe(1);
    expect(harness.machine.snapshot.state).toBe('SPOTLIGHTING');
    expect(harness.machine.snapshot.target).toBe(document.getElementById('update'));
    expect(harness.replan).not.toHaveBeenCalled();
  });

  it('re-plans instead of binding to a candidate with an empty rect', async () => {
    // A detached or collapsed node still answers with a zero rect, and pointing
    // a caption at one puts it in the top-left corner of the screen.
    const restore = boxes({ ':root': [0, 0, 1024, 768], '#account': [10, 100, 200, 40], '#update': [0, 0, 0, 0] });
    try {
      const initial = scan();
      const steps: Step[] = [
        { target: idFor(initial, 'Open the account menu'), caption: 'Open the account menu', advanceOn: 'click' },
        { target: idFor(initial, 'Update profile'), caption: 'Save', advanceOn: 'click' },
      ];
      const harness = build(steps);
      harness.start();
      expect(harness.machine.snapshot.target).toBe(document.getElementById('account'));

      document.getElementById('account')?.click();
      await flush();

      expect(harness.replan).toHaveBeenCalledWith(1);
      expect(harness.machine.snapshot.target).not.toBe(document.getElementById('update'));
      expect(harness.machine.snapshot.state).toBe('FAILED');
    } finally {
      restore();
    }
  });

  it('advances on Next for a manual step', async () => {
    const initial = scan();
    const steps: Step[] = [
      { target: idFor(initial, 'Open the account menu'), caption: 'Look here', advanceOn: 'manual' },
      { target: idFor(initial, 'Update profile'), caption: 'Save', advanceOn: 'click' },
    ];
    const harness = build(steps);
    harness.start();

    document.getElementById('account')?.click();
    await tick();
    expect(harness.machine.snapshot.stepIndex).toBe(0);

    harness.machine.next();
    await tick();
    expect(harness.machine.snapshot.stepIndex).toBe(1);
  });
});
