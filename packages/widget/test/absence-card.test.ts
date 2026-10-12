/**
 * The gap card with the optional request for a text, rendered into a real DOM.
 *
 * What matters here: with no offer of a text the card is as it was, no number leaves without the
 * box ticked, a number that cannot be dialled stops the report with words next to the field, and
 * the card says only what is still true after the report.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbsenceCard } from '../src/ui/AbsenceCard';
import { NOTICE_COPY, NOTICE_ERROR, NOTICE_FIELD_LABEL, NOTICE_HINT, NOTICE_LABEL } from '../src/ui/textNotice';

const REQUEST = { title: 'Seat a party together', description: 'd', area: 'seats', quote: 'q', rationale: 'r' };
type Props = Parameters<typeof AbsenceCard>[0];

let host: HTMLElement;
let reports: (string | undefined)[];

function show(over: Partial<Props> = {}): void {
  const props: Props = {
    text: 'There is no way to do that here today.',
    request: REQUEST,
    elapsedSeconds: 0,
    canRate: false,
    onReport: (phone) => {
      reports.push(phone);
    },
    onRate: () => undefined,
    ...over,
  };
  act(() => render(h(AbsenceCard, props), host));
}

const button = (): HTMLButtonElement => host.querySelector('button[type="submit"]') as HTMLButtonElement;
const box = (): HTMLInputElement | null => host.querySelector('input[type="checkbox"]');
const field = (): HTMLInputElement | null => host.querySelector('input[type="tel"]');
const form = (): HTMLFormElement => host.querySelector('form') as HTMLFormElement;
const byId = (id: string): Element | undefined => [...host.querySelectorAll('[id]')].find((node) => node.id === id);
/** What each text field on the card holds now. The markup never shows the live value of a field. */
const typedValues = (): string[] =>
  [...host.querySelectorAll('input')].filter((input) => input.type !== 'checkbox').map((input) => input.value);

function tick(): void {
  act(() => {
    box()?.click();
  });
}

function type(value: string): void {
  act(() => {
    const input = field() as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function submit(): void {
  act(() => {
    form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  // The answer appears at once, as it does for a person who asked for reduced motion.
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  host = document.createElement('div');
  document.body.appendChild(host);
  reports = [];
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
});

describe('the gap card with no offer of a text', () => {
  it('shows the report button and the title, and no field that asks for a number', () => {
    show();
    expect(button().textContent).toBe('Report to developers');
    expect(host.textContent).toContain('Seat a party together');
    expect(box()).toBeNull();
    expect(field()).toBeNull();
    expect(host.textContent).not.toContain(NOTICE_LABEL);
  });

  it('reports with no number', () => {
    show();
    submit();
    expect(reports).toEqual([undefined]);
  });
});

describe('the gap card with the offer of a text', () => {
  it('asks one question, with the box not ticked and no number field yet', () => {
    show({ textNotice: true });
    expect(box()?.checked).toBe(false);
    expect(box()?.closest('label')?.textContent).toBe(NOTICE_LABEL);
    expect(field()).toBeNull();
    expect(host.textContent).not.toContain(NOTICE_HINT);
  });

  it('reports with no number when the box is not ticked', () => {
    show({ textNotice: true });
    submit();
    expect(reports).toEqual([undefined]);
  });

  it('shows the number field and what the person agrees to when the box is ticked', () => {
    show({ textNotice: true });
    tick();
    const input = field() as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe(NOTICE_FIELD_LABEL);
    expect(input.getAttribute('autocomplete')).toBe('tel');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    const hint = byId(String(input.getAttribute('aria-describedby')));
    expect(hint?.textContent).toBe(NOTICE_HINT);
  });

  it('sends the number as it is dialled', () => {
    show({ textNotice: true });
    tick();
    type('+1 (415) 555-0123');
    submit();
    expect(reports).toEqual(['+14155550123']);
  });

  it('stops the report and says why when the number cannot be dialled', () => {
    show({ textNotice: true });
    tick();
    type('415 555 0123');
    submit();

    expect(reports).toEqual([]);
    const input = field() as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(NOTICE_ERROR);
    expect(String(input.getAttribute('aria-describedby')).split(' ')).toContain(alert?.id);
    expect(document.activeElement).toBe(input);
  });

  it('stops the report when the box is ticked and the field is empty', () => {
    show({ textNotice: true });
    tick();
    submit();
    expect(reports).toEqual([]);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('takes the error away as soon as the person types again, and then reports', () => {
    show({ textNotice: true });
    tick();
    type('415');
    submit();
    type('+14155550123');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(field()?.getAttribute('aria-invalid')).toBe('false');
    submit();
    expect(reports).toEqual(['+14155550123']);
  });

  it('sends no number after the person takes the tick away', () => {
    show({ textNotice: true });
    tick();
    type('+14155550123');
    tick();
    expect(field()).toBeNull();
    submit();
    expect(reports).toEqual([undefined]);
  });

  it('does not report twice while a report is on its way', () => {
    show({ textNotice: true, reporting: true });
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe('Reporting');
    expect(box()?.disabled).toBe(true);
    submit();
    expect(reports).toEqual([]);
  });
});

describe('a report that failed', () => {
  it('says so and shows no field, so no number stays on the card', () => {
    show({ textNotice: true });
    tick();
    type('+1 415 555 0123');
    submit();
    show({ textNotice: true, blocked: 'failed' });

    expect(host.textContent).toContain('The report could not be sent.');
    expect(host.querySelector('form')).toBeNull();
    expect(typedValues()).toEqual([]);
  });

  it('shows no button when there is no repository to report to', () => {
    show({ request: undefined, blocked: 'no_repository', textNotice: true });
    expect(host.querySelector('form')).toBeNull();
    expect(host.textContent).toContain('has not connected a repository');
  });
});

describe('the card after the report', () => {
  const at = (status: NonNullable<Props['escalation']>['status']) => ({ escalation: { id: 'e1', status } });

  it.each(['subscribed', 'not_needed', 'unavailable'] as const)('says what became of the text: %s', (notice) => {
    show({ ...at('filed'), textNotice: true, notice });
    expect(host.textContent).toContain(NOTICE_COPY[notice]);
    expect(host.querySelector('form')).toBeNull();
    expect(field()).toBeNull();
  });

  it('says nothing about a text when none was asked for', () => {
    show({ ...at('filed'), textNotice: true });
    for (const line of Object.values(NOTICE_COPY)) expect(host.textContent).not.toContain(line);
  });

  it.each(['queued', 'filing', 'filed', 'updated', 'inspecting', 'drafting'] as const)(
    'keeps the promise of a text on the card while the report is %s',
    (status) => {
      show({ ...at(status), notice: 'subscribed' });
      expect(host.textContent).toContain(NOTICE_COPY.subscribed);
    },
  );

  it.each(['pr_open', 'awaiting_approval', 'approved', 'merging', 'deploying', 'shipped', 'rejected', 'failed'] as const)(
    'takes the promise of a text off the card when the report is %s, because it is not about what comes next',
    (status) => {
      show({ ...at(status), notice: 'subscribed' });
      expect(host.textContent).not.toContain(NOTICE_COPY.subscribed);
    },
  );

  it.each(['shipped', 'rejected', 'failed'] as const)('keeps the two other sentences when the report is %s', (status) => {
    show({ ...at(status), notice: 'not_needed' });
    expect(host.textContent).toContain(NOTICE_COPY.not_needed);
    show({ ...at(status), notice: 'unavailable' });
    expect(host.textContent).toContain(NOTICE_COPY.unavailable);
  });

  it('holds the number nowhere in the page: not in the markup and not in a field', () => {
    show({ textNotice: true });
    tick();
    type('+14155550123');
    expect(typedValues()).toEqual(['+14155550123']);
    submit();
    show({ ...at('filed'), textNotice: true, notice: 'subscribed' });
    expect(host.innerHTML).not.toContain('4155550123');
    expect(typedValues()).toEqual([]);
  });
});
