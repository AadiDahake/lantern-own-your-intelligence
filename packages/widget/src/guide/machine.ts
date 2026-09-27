import { controlKey, controlRefOf, routeOf, sameControl } from '@lantern/shared';
import type { Step } from '../types';
import type { ScanResult } from '../scan/affordances';
import { isPointable } from './geometry';
import { domSettled } from './navigation';

export type GuideState = 'SPOTLIGHTING' | 'VERIFYING' | 'SNAPSHOTTING' | 'DONE' | 'FAILED';

export type GuideSnapshot = {
  state: GuideState;
  stepIndex: number;
  total: number;
  step: Step | null;
  target: Element | null;
  message: string | null;
};

/** What a re-plan hands back: the steps still left, bound to a fresh scan. */
export type Replanned = ScanResult & { steps: Step[]; routeChanged?: boolean };

export type GuideDeps = {
  /** A fresh scan of the host page. */
  rescan: () => ScanResult;
  /**
   * Asks the agent for the steps that are still outstanding, given the page as it looks now.
   * Only reached when the next control is really not on the page; a plan read off the site
   * graph never needs it on a walk that goes to plan.
   */
  replan: (continueFrom: number) => Promise<Replanned | null>;
  onChange: (snapshot: GuideSnapshot) => void;
  /** Navigation plus debounced mutations; the machine only needs "something moved". */
  watch?: (onPageChanged: () => void) => () => void;
  /** Resolves once the DOM has stopped changing after an action. */
  settle?: () => Promise<void>;
  doc?: Document;
  settleMs?: number;
  /** How long the next control may take to appear after a press, before the server is asked. */
  bindTimeoutMs?: number;
};

/** How many times a step may be re-planned before guidance gives up on it. */
const MAX_RECOVERIES = 3;

/**
 * How long the next page may take to render after a press that navigates. A client-side route
 * fetches its data first, and the control the next step needs is only there once it has.
 */
const NAVIGATION_BIND_MS = 8000;

/** After a press that stays on the page, the control it reveals is there within a moment. */
const CLICK_BIND_MS = 2500;

/**
 * Drives one guidance run. It never focuses anything: the user keeps control of
 * the host page and the machine only observes what they do.
 *
 * Every step carries the identity of its control (role, name, landmark, link target), and the
 * machine binds the step to the live DOM by that identity on every page it reaches. The total it
 * announces is the length of the plan it was handed, and nothing on a walk that goes to plan can
 * change it: the server is only asked again when a control is really not on the page.
 */
export class GuideMachine {
  private state: GuideState = 'DONE';
  private steps: Step[] = [];
  private index = 0;
  private scan: ScanResult | null = null;
  private lookup = new Map<string, Element>();
  private target: Element | null = null;
  private message: string | null = null;
  private unwatch: (() => void) | null = null;
  private replanning = false;
  /** Consecutive re-plans that have not moved the user on. */
  private recoveries = 0;
  /** Set while the machine waits for the page to show the next step's control. */
  private binding: { attempt: () => void } | null = null;
  /** The page as it was when the last step succeeded, so the next page is known to be new. */
  private left: { href: string; signature: string } | null = null;

  private readonly doc: Document;
  private readonly settleMs: number;
  private readonly bindTimeoutMs: number | null;

  constructor(private readonly deps: GuideDeps) {
    this.doc = deps.doc ?? document;
    this.settleMs = deps.settleMs ?? 300;
    this.bindTimeoutMs = deps.bindTimeoutMs ?? null;
  }

  get snapshot(): GuideSnapshot {
    return {
      state: this.state,
      stepIndex: this.index,
      total: this.steps.length,
      step: this.steps[this.index] ?? null,
      target: this.target,
      message: this.message,
    };
  }

  start(scan: ScanResult, steps: Step[]): void {
    this.stopListening();
    // A step planned against the page alone names its control by id only. Its identity is read
    // off the scan it was planned against now, so it survives every re-render like the rest.
    this.steps = steps.map((step) => withIdentity(step, scan));
    this.index = 0;
    this.message = null;
    this.recoveries = 0;
    this.adoptScan(scan);
    for (const type of ['pointerdown', 'click', 'keydown', 'input', 'change'] as const) {
      this.doc.addEventListener(type, this.onUserEvent, true);
    }
    if (this.deps.watch) this.unwatch = this.deps.watch(this.onPageChanged);
    this.enterSpotlight();
  }

  /** The Next button: advance whatever the step said it was waiting for. */
  next(): void {
    if (this.state !== 'SPOTLIGHTING' && this.state !== 'VERIFYING') return;
    void this.enterSnapshot();
  }

  /**
   * The view could not draw the current target. Treat it as gone rather than
   * leaving a caption pinned to a control nobody can see.
   *
   * Only while the machine is actually pointing at something: in every other
   * state it is already dealing with the change.
   */
  lost(): void {
    if (this.state !== 'SPOTLIGHTING') return;
    void this.recover();
  }

  stop(): void {
    this.stopListening();
    this.target = null;
    this.transition('DONE');
  }

  dispose(): void {
    this.stopListening();
  }

  private stopListening(): void {
    this.binding = null;
    for (const type of ['pointerdown', 'click', 'keydown', 'input', 'change'] as const) {
      this.doc.removeEventListener(type, this.onUserEvent, true);
    }
    this.unwatch?.();
    this.unwatch = null;
  }

  private adoptScan(scan: ScanResult): void {
    this.scan = scan;
    this.lookup = scan.lookup;
  }

  private transition(state: GuideState): void {
    this.state = state;
    this.deps.onChange(this.snapshot);
  }

  /**
   * The live element for a step, on the scan the machine holds now. Ids are positional, so a
   * re-render can hand the same id to a different control: identity decides, and the id the step
   * carries only breaks a tie between two controls that read the same. A step with no identity
   * at all has nothing but its id to go on.
   */
  private resolve(step: Step): Element | null {
    if (!this.scan) return null;
    const id = findByIdentity(this.scan, step, step.target);
    if (id) {
      step.target = id;
      return this.lookup.get(id) ?? null;
    }
    if (step.control) return null;
    const byId = step.target ? this.lookup.get(step.target) ?? null : null;
    return isPointable(byId) ? byId : null;
  }

  private enterSpotlight(note: string | null = null): void {
    this.binding = null;
    const step = this.steps[this.index];
    if (!step) {
      this.stopListening();
      this.target = null;
      this.transition('DONE');
      return;
    }
    const element = this.resolve(step);
    if (!isPointable(element)) {
      this.target = null;
      void this.recover();
      return;
    }
    this.target = element;
    this.message = note;
    this.recoveries = 0;
    this.transition('SPOTLIGHTING');
  }

  private readonly onUserEvent = (event: Event): void => {
    if (this.state !== 'SPOTLIGHTING' || !this.target) return;
    const step = this.steps[this.index];
    if (!step) return;
    if (!hits(event, this.target)) return;

    // A press is the user acting on the control. Menus and dialogs unmount their trigger on
    // pointerdown, and a navigation replaces the page, so the press is the one moment the
    // step can be seen to succeed; nothing later is waited for.
    if (event.type === 'pointerdown') {
      if (step.advanceOn !== 'click' && step.advanceOn !== 'navigation') return;
      this.enterVerifying();
      return;
    }

    if (!acceptsEvent(step.advanceOn, event.type)) return;
    if (event.type === 'keydown') {
      const key = (event as KeyboardEvent).key;
      if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return;
    }
    this.enterVerifying();
  };

  /**
   * The step succeeded. The ring comes off it at once: a caption left on a control the user has
   * already pressed is a lie, and across a navigation it would sit on the next page's twin of
   * that control. What the page looked like is kept, so the next page can be told from this one.
   */
  private enterVerifying(): void {
    this.left = { href: this.href(), signature: this.scan ? signatureOf(this.scan) : '' };
    this.target = null;
    this.transition('VERIFYING');
    void this.settle().then(() => {
      if (this.state !== 'VERIFYING') return;
      void this.enterSnapshot();
    });
  }

  private href(): string {
    return this.doc.defaultView?.location?.href ?? '';
  }

  private settle(): Promise<void> {
    if (this.deps.settle) return this.deps.settle();
    return domSettled(this.settleMs, 1500, this.doc.body);
  }

  /**
   * Moves on to the next step and binds it to the page as it is now. The plan is complete, so
   * running out of steps is the walk finishing: nothing is asked of the server on the way out.
   */
  private async enterSnapshot(): Promise<void> {
    const finished = this.steps[this.index];
    this.target = null;
    this.transition('SNAPSHOTTING');
    this.index += 1;
    if (this.index >= this.steps.length) {
      this.stopListening();
      this.transition('DONE');
      return;
    }
    const navigates = finished?.advanceOn === 'navigation';
    await this.bindNext(navigates ? NAVIGATION_BIND_MS : CLICK_BIND_MS, navigates);
  }

  /**
   * Whether the page is a new one since the last step. A host pushes its address before it
   * renders, so a scan taken right after the address changed still describes the page the user
   * left; it is only the next page once its controls differ too.
   */
  private arrived(scan: ScanResult): boolean {
    const left = this.left;
    if (!left) return true;
    if (this.href() === left.href) return false;
    return signatureOf(scan) !== left.signature;
  }

  /**
   * Binds the current step by identity, giving the page time to show its control: a navigation
   * renders over several frames and a revealed panel over a few. Each settle of the page is
   * another look. Only when the time is up and one last look finds nothing is the server asked.
   */
  private bindNext(timeoutMs: number, afterNavigation: boolean): Promise<void> {
    return new Promise((done) => {
      const limit = this.bindTimeoutMs ?? timeoutMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (timer) clearTimeout(timer);
        this.binding = null;
        done();
      };
      const tryBind = (): boolean => {
        const step = this.steps[this.index];
        if (!step) return true;
        const scan = this.deps.rescan();
        // After a press that navigates, the page the user left is not where the next control is,
        // whatever the address bar says: a control that reads the same on both pages must not be
        // bound on the old one.
        if (afterNavigation && !this.arrived(scan)) return false;
        this.adoptScan(scan);
        const element = this.resolve(step);
        if (!isPointable(element)) return false;
        this.enterSpotlight();
        return true;
      };
      if (tryBind()) {
        finish();
        return;
      }
      // The page-changed callback drives further looks until the time is up.
      this.binding = {
        attempt: () => {
          if (tryBind()) finish();
        },
      };
      timer = setTimeout(() => {
        if (this.binding === null) return;
        this.binding = null;
        // One last look after the page settles, then the server.
        void this.settle().then(() => {
          if (this.state !== 'SNAPSHOTTING') {
            done();
            return;
          }
          if (tryBind()) {
            done();
            return;
          }
          void this.recover().then(done, done);
        });
      }, limit);
    });
  }

  /**
   * The host re-rendered. While a step is being bound, that is another chance to find its
   * control. While a step is spotlit, the control may simply have come back as a new node, in
   * which case it is rebound; if it is really gone, guidance recovers.
   */
  private readonly onPageChanged = (): void => {
    if (this.state === 'DONE' || this.state === 'FAILED' || this.replanning) return;
    if (this.binding) {
      this.binding.attempt();
      return;
    }
    if (this.state !== 'SPOTLIGHTING') return;
    const step = this.steps[this.index];
    if (!step) return;
    if (isPointable(this.target)) return;
    this.adoptScan(this.deps.rescan());
    const element = this.resolve(step);
    if (isPointable(element)) {
      this.target = element;
      this.transition('SPOTLIGHTING');
      return;
    }
    void this.recover();
  };

  /**
   * The current step's control is not on the page. One more look after the page has settled,
   * then the server is asked for the steps that are left from here, and the widget says so
   * when that changes the route the user was shown.
   */
  private async recover(): Promise<void> {
    if (this.replanning) return;
    // A plan that keeps pointing at something unreachable would otherwise ask the
    // agent again forever, once per re-render.
    if (this.recoveries >= MAX_RECOVERIES) {
      this.message = 'That control is no longer on the page.';
      this.stopListening();
      this.target = null;
      this.transition('FAILED');
      return;
    }
    this.recoveries += 1;
    this.replanning = true;
    this.target = null;
    this.binding = null;
    this.transition('SNAPSHOTTING');
    try {
      await this.settle();
      const step = this.steps[this.index];
      this.adoptScan(this.deps.rescan());
      const element = step ? this.resolve(step) : null;
      if (isPointable(element)) {
        this.replanning = false;
        this.enterSpotlight();
        return;
      }

      const announced = this.steps.length;
      const replanned = await this.deps.replan(this.index);
      if (!replanned || replanned.steps.length === 0) {
        this.message = 'That control is no longer on the page.';
        this.stopListening();
        this.transition('FAILED');
        return;
      }
      this.steps = [...this.steps.slice(0, this.index), ...replanned.steps.map((next) => withIdentity(next, replanned))];
      this.adoptScan(replanned);
      this.replanning = false;
      const changed = replanned.routeChanged === true || this.steps.length !== announced;
      const left = this.steps.length - this.index;
      this.enterSpotlight(changed ? `The route changed: ${left} step${left === 1 ? '' : 's'} to go.` : null);
    } catch {
      this.message = 'Guidance stopped because the page changed.';
      this.stopListening();
      this.transition('FAILED');
    } finally {
      this.replanning = false;
    }
  }
}

/** Whether the event was aimed at the target, across shadow boundaries. */
function hits(event: Event, target: Element): boolean {
  const path =
    typeof (event as Event & { composedPath?: () => EventTarget[] }).composedPath === 'function'
      ? event.composedPath()
      : [];
  if (path.includes(target)) return true;
  return event.target instanceof Node && target.contains(event.target);
}

function acceptsEvent(advanceOn: Step['advanceOn'], eventType: string): boolean {
  switch (advanceOn) {
    case 'click':
      return eventType === 'click' || eventType === 'keydown';
    case 'input':
      return eventType === 'input' || eventType === 'change';
    case 'navigation':
      return eventType === 'click' || eventType === 'keydown';
    case 'manual':
      return false;
  }
}

/** What a page reads as: its title and the identity of every control on it. */
function signatureOf(scan: ScanResult): string {
  const keys = scan.page.affordances.map((affordance) => controlKey(controlRefOf(affordance, scan.page.url)));
  return `${scan.page.title}\n${keys.sort().join('\n')}`;
}

/** The step with its control's identity filled in from the scan it was planned against. */
function withIdentity(step: Step, scan: ScanResult): Step {
  const copy: Step = { ...step };
  if (copy.control || !copy.target) return copy;
  const planned = scan.page.affordances.find((affordance) => affordance.id === copy.target);
  if (!planned) return copy;
  copy.control = { ...controlRefOf(planned, scan.page.url), route: routeOf(scan.page.url) };
  return copy;
}

/**
 * The id, on a fresh scan, of the control a step stands for. Identity is role, accessible name,
 * landmark and link target; an exact key wins, a match that only lacks a landmark is accepted.
 * Only a candidate the user can see and reach counts: a detached or collapsed node reports an
 * empty rect, and binding to one is what puts a caption in the top-left corner of the screen.
 */
export function findByIdentity(scan: ScanResult, step: Step, preferId: string | null = null): string | null {
  const wanted = step.control ?? null;
  if (!wanted || !wanted.name.trim()) return null;
  const wantedKey = controlKey(wanted);
  let exact: string | null = null;
  let loose: string | null = null;
  for (const affordance of scan.page.affordances) {
    const ref = controlRefOf(affordance, scan.page.url);
    if (!sameControl(ref, wanted)) continue;
    if (!isPointable(scan.lookup.get(affordance.id))) continue;
    if (controlKey(ref) === wantedKey) {
      if (affordance.id === preferId) return affordance.id;
      if (exact === null) exact = affordance.id;
    } else if (loose === null) {
      loose = affordance.id;
    }
  }
  return exact ?? loose;
}
