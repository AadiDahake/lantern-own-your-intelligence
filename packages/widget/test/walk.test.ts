import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GuideMachine, type GuideSnapshot, type Replanned } from '../src/guide/machine';
import { scanAffordances, type ScanResult } from '../src/scan/affordances';
import type { Step } from '../src/types';

/**
 * Three pages of NovaAir, as the site graph knows them. The walk goes Home -> My Booking ->
 * Manage Trip, and the plan for it is three steps, announced once and never changed.
 */
const PAGES: Record<string, string> = {
  '/': `
    <header><nav aria-label="Main"><a href="/my-booking">My Booking</a></nav></header>
    <main><a id="hero" href="/my-booking">My Booking</a><a href="/flights">Find a flight</a></main>`,
  '/my-booking': `
    <header><nav aria-label="Main"><a href="/my-booking">My Booking</a></nav></header>
    <main><form><label for="code">Confirmation code</label><input id="code" />
      <button id="find" type="submit">Find my booking</button></form></main>`,
  '/trips/NVA7K2': `
    <nav aria-label="Breadcrumb"><a href="/trips/NVA7K2">Manage Trip</a></nav>
    <main><button role="tab" aria-selected="true">Seats</button>
      <a id="change" href="/trips/NVA7K2/seats">Change seats</a></main>`,
};

function showPage(path: string): void {
  history.replaceState(null, '', path);
  document.body.innerHTML = PAGES[path] as string;
}

const tick = () => new Promise((done) => setTimeout(done, 0));
async function flush(turns = 12): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await tick();
}

/** The plan the server computes from the graph: the first step bound, the rest by identity. */
function novaairPlan(scan: ScanResult): Step[] {
  const hero = scan.page.affordances.find((a) => a.name === 'My Booking' && a.landmark === 'main');
  if (!hero) throw new Error('no hero link');
  return [
    {
      target: hero.id,
      caption: 'Open My Booking',
      advanceOn: 'navigation',
      control: { role: 'link', name: 'My Booking', landmark: 'main', href: '/my-booking', route: '/' },
    },
    {
      target: null,
      caption: 'Fill in the form, then select Find my booking',
      advanceOn: 'navigation',
      control: { role: 'button', name: 'Find my booking', landmark: 'form', route: '/my-booking' },
    },
    {
      target: null,
      caption: 'Open Change seats',
      advanceOn: 'navigation',
      control: { role: 'link', name: 'Change seats', landmark: 'main', href: '/trips/:id/seats', route: '/trips/:id' },
    },
  ];
}

function harness(replan?: (continueFrom: number) => Promise<Replanned | null>, bindTimeoutMs = 0) {
  const snapshots: GuideSnapshot[] = [];
  const rescan = vi.fn(() => scanAffordances({ question: 'change my seat' }));
  const replanSpy = vi.fn(replan ?? (async () => null));
  let pageChanged = () => {};
  const machine = new GuideMachine({
    rescan,
    replan: replanSpy,
    onChange: (snapshot) => snapshots.push(snapshot),
    watch: (callback) => {
      pageChanged = callback;
      return () => {};
    },
    settleMs: 0,
    bindTimeoutMs,
  });
  return { machine, snapshots, rescan, replan: replanSpy, pageChanged: () => pageChanged() };
}

function press(element: Element | null): void {
  if (!element) throw new Error('nothing to press');
  element.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
}

beforeEach(() => {
  showPage('/');
});

describe('a multi-page walk', () => {
  it('announces three steps once and keeps that total to the end without asking the server', async () => {
    const h = harness();
    const scan = scanAffordances({ question: 'change my seat' });
    h.machine.start(scan, novaairPlan(scan));

    expect(h.machine.snapshot.state).toBe('SPOTLIGHTING');
    expect(h.machine.snapshot.total).toBe(3);
    expect(h.machine.snapshot.target).toBe(document.getElementById('hero'));

    // Step 1: the press navigates. The new page renders after the press.
    press(h.machine.snapshot.target);
    await flush(3);
    showPage('/my-booking');
    h.pageChanged();
    await flush();
    expect(h.machine.snapshot.state).toBe('SPOTLIGHTING');
    expect(h.machine.snapshot.stepIndex).toBe(1);
    expect(h.machine.snapshot.target).toBe(document.getElementById('find'));

    // Step 2: the form submits and the trip page renders.
    press(h.machine.snapshot.target);
    await flush(3);
    showPage('/trips/NVA7K2');
    h.pageChanged();
    await flush();
    expect(h.machine.snapshot.stepIndex).toBe(2);
    expect(h.machine.snapshot.target).toBe(document.getElementById('change'));

    // Step 3: the last press ends the walk. Nothing is asked of the server.
    press(h.machine.snapshot.target);
    await flush();
    expect(h.machine.snapshot.state).toBe('DONE');

    expect(h.snapshots.every((snapshot) => snapshot.total === 3)).toBe(true);
    expect(h.snapshots.filter((s) => s.state === 'SPOTLIGHTING').map((s) => s.stepIndex)).toEqual([0, 1, 2]);
    expect(h.replan).not.toHaveBeenCalled();
  });

  it('binds by identity when a re-render hands the same control a different id', async () => {
    const h = harness();
    const scan = scanAffordances({ question: 'change my seat' });
    h.machine.start(scan, novaairPlan(scan));
    const hero = document.getElementById('hero') as HTMLElement;
    // A new link appears before the hero, so every positional id shifts by one.
    hero.parentElement?.insertAdjacentHTML('afterbegin', '<a href="/hotels">Hotels</a>');
    hero.replaceWith(hero.cloneNode(true));
    h.pageChanged();
    await flush();
    expect(h.machine.snapshot.stepIndex).toBe(0);
    expect(h.machine.snapshot.state).toBe('SPOTLIGHTING');
    expect(h.machine.snapshot.target).toBe(document.getElementById('hero'));
    expect(h.replan).not.toHaveBeenCalled();
  });

  it('looks once more after the page settles, then asks the server and says the route changed', async () => {
    const h = harness(async () => {
      const fresh = scanAffordances({ question: 'change my seat' });
      const change = fresh.page.affordances.find((a) => a.name === 'Change seats')!;
      return {
        ...fresh,
        routeChanged: true,
        steps: [{ target: change.id, caption: 'Open Change seats', advanceOn: 'navigation' }],
      };
    }, 40);
    const scan = scanAffordances({ question: 'change my seat' });
    h.machine.start(scan, novaairPlan(scan));

    press(h.machine.snapshot.target);
    await flush(3);
    // The site skipped straight to the trip page: the booking form the plan expected is not here.
    showPage('/trips/NVA7K2');
    const rescansBefore = h.rescan.mock.calls.length;
    h.pageChanged();
    await new Promise((done) => setTimeout(done, 120));
    await flush(20);

    expect(h.replan).toHaveBeenCalledTimes(1);
    expect(h.replan).toHaveBeenCalledWith(1);
    // One look on the page-changed signal, one after the settle, then the server.
    expect(h.rescan.mock.calls.length - rescansBefore).toBeGreaterThanOrEqual(2);
    expect(h.machine.snapshot.state).toBe('SPOTLIGHTING');
    expect(h.machine.snapshot.total).toBe(2);
    expect(h.machine.snapshot.message).toBe('The route changed: 1 step to go.');
    expect(h.machine.snapshot.target).toBe(document.getElementById('change'));
  });
});

describe('between steps', () => {
  it('takes the ring off a step the moment it succeeds, and shows nothing until the next binds', async () => {
    const h = harness(undefined, 40);
    const scan = scanAffordances({ question: 'change my seat' });
    h.machine.start(scan, novaairPlan(scan));
    press(h.machine.snapshot.target);
    expect(h.machine.snapshot.state).toBe('VERIFYING');
    expect(h.machine.snapshot.target).toBeNull();
    await flush(3);
    expect(h.machine.snapshot.state).toBe('SNAPSHOTTING');
    expect(h.machine.snapshot.target).toBeNull();
    // Every snapshot since the press has had nothing to draw.
    const since = h.snapshots.slice(h.snapshots.findIndex((s) => s.state === 'VERIFYING'));
    expect(since.every((s) => s.target === null)).toBe(true);
    showPage('/my-booking');
    h.pageChanged();
    await flush();
    expect(h.machine.snapshot.state).toBe('SPOTLIGHTING');
    expect(h.machine.snapshot.stepIndex).toBe(1);
  });

  it('does not bind the next step on the old page under a new address', async () => {
    const h = harness(undefined, 60);
    const scan = scanAffordances({ question: 'change my seat' });
    // The next step is a twin of a control the home page also has: the nav "My Booking".
    const plan = novaairPlan(scan);
    plan[1] = {
      target: null,
      caption: 'Open My Booking',
      advanceOn: 'navigation',
      control: { role: 'link', name: 'My Booking', landmark: 'sidebar', href: '/my-booking', route: '/my-booking' },
    };
    h.machine.start(scan, plan);
    press(h.machine.snapshot.target);
    await flush(3);
    // The host pushed the address first; the DOM is still the home page.
    history.replaceState(null, '', '/my-booking');
    h.pageChanged();
    await flush(3);
    expect(h.machine.snapshot.state).toBe('SNAPSHOTTING');
    expect(h.machine.snapshot.target).toBeNull();
    // Now the page renders, and the twin on it is the one that gets the ring.
    document.body.innerHTML = PAGES['/my-booking'] as string;
    h.pageChanged();
    await flush();
    expect(h.machine.snapshot.state).toBe('SPOTLIGHTING');
    expect(h.machine.snapshot.stepIndex).toBe(1);
    expect(h.machine.snapshot.target).toBe(document.querySelector('nav a'));
    expect(h.replan).not.toHaveBeenCalled();
  });
});
