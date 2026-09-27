import { beforeEach, describe, expect, it } from 'vitest';
import { scanAffordances } from '../src/scan/affordances';

const FIXTURE = `
  <nav aria-label="Main">
    <a href="/flights">Flights</a>
    <a href="/hotels">Hotels</a>
  </nav>
  <header>
    <button aria-label="Open the seat map" id="seat-map">Seats</button>
  </header>
  <main>
    <label for="code">Confirmation code</label>
    <input id="code" value="NV4K2Q" />
    <button id="change">Change seats</button>
    <button id="confirm">Confirm seats</button>
    <button id="ghost" style="display: none">Hidden action</button>
    <div aria-hidden="true"><button id="masked">Masked action</button></div>
    <input type="hidden" name="csrf" value="x" />
    <span id="not-interactive">Just text</span>
  </main>
`;

beforeEach(() => {
  document.body.innerHTML = FIXTURE;
});

describe('scanAffordances', () => {
  it('reports interactive elements only', () => {
    const { page } = scanAffordances({ question: 'change my seat' });
    const names = page.affordances.map((affordance) => affordance.name);
    expect(names).toContain('Confirm seats');
    expect(names).toContain('Open the seat map');
    expect(names).not.toContain('Just text');
    expect(page.affordances.some((affordance) => affordance.name === 'x')).toBe(false);
  });

  it('gives stable ids for an unchanged page', () => {
    const first = scanAffordances({ question: 'change my seat' });
    const second = scanAffordances({ question: 'change my seat' });
    expect(second.page.affordances).toEqual(first.page.affordances);
    for (const [id, element] of first.lookup) expect(second.lookup.get(id)).toBe(element);
  });

  it('excludes hidden elements from the visible set', () => {
    const { page } = scanAffordances({ question: 'change my seat' });
    const visible = page.affordances.filter((affordance) => affordance.visible).map((a) => a.name);
    expect(visible).toContain('Confirm seats');
    expect(visible).not.toContain('Hidden action');
    expect(visible).not.toContain('Masked action');
  });

  it('takes accessible names from aria-label and from label[for]', () => {
    const { page } = scanAffordances({ question: 'change my seat' });
    const byName = (name: string) => page.affordances.find((affordance) => affordance.name === name);
    expect(byName('Open the seat map')?.role).toBe('button');
    expect(byName('Confirmation code')?.role).toBe('textbox');
  });

  it('records the landmark and the link target', () => {
    const { page } = scanAffordances({ question: 'flights' });
    const flights = page.affordances.find((affordance) => affordance.name === 'Flights');
    expect(flights?.landmark).toBe('sidebar');
    expect(flights?.href).toBe('/flights');
  });

  it('keeps the question-relevant controls when the cap is small', () => {
    const { page } = scanAffordances({ question: 'change my seat', limit: 2 });
    expect(page.affordances.map((affordance) => affordance.name)).toContain('Change seats');
  });

  it('skips the host element of the widget', () => {
    const host = document.createElement('div');
    host.innerHTML = '<button>Open support</button>';
    document.body.appendChild(host);
    const { page } = scanAffordances({ question: 'support', exclude: host });
    expect(page.affordances.some((affordance) => affordance.name === 'Open support')).toBe(false);
  });
});

describe('stateOf', () => {
  it('reports a tab that is already showing its panel', () => {
    document.body.innerHTML = `
      <div role="dialog" aria-label="Manage trip">
        <button role="tab" aria-selected="true">Seats</button>
        <button role="tab" aria-selected="false">Baggage</button>
      </div>`;
    const { page } = scanAffordances({ question: 'seats' });
    const byName = (name: string) => page.affordances.find((affordance) => affordance.name === name);
    expect(byName('Seats')?.state).toBe('selected');
    expect(byName('Baggage')?.state).toBeUndefined();
  });

  it('reports a menu button that is already open', () => {
    document.body.innerHTML = '<button aria-expanded="true">My Booking</button>';
    const { page } = scanAffordances({ question: 'booking' });
    expect(page.affordances[0]?.state).toBe('expanded');
  });
});
