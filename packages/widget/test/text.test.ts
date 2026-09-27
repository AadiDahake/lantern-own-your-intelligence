import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PAGE_TEXT, visibleText } from '../src/scan/text';
import { scanAffordances } from '../src/scan/affordances';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('visibleText', () => {
  it('reads what the page shows, whitespace collapsed', () => {
    document.body.innerHTML = `
      <h1>Manage Trip</h1>
      <p>Confirmation   NVA7K2.
         Departs 22:40.</p>
    `;
    expect(visibleText(document.body)).toBe('Manage Trip Confirmation NVA7K2. Departs 22:40.');
  });

  it('skips what the visitor cannot see and what is not page text', () => {
    document.body.innerHTML = `
      <p>Gate D14</p>
      <p style="display: none">Cancelled</p>
      <p hidden>Refunded</p>
      <div aria-hidden="true">Decorative</div>
      <script>const seat = "12A";</script>
      <style>.a { color: red }</style>
    `;
    expect(visibleText(document.body)).toBe('Gate D14');
  });

  it('leaves the widget out of the page it is reading', () => {
    document.body.innerHTML = '<p>Fare total 1,284.00 USD</p><lantern-widget><p>How can we help?</p></lantern-widget>';
    const host = document.querySelector('lantern-widget');
    expect(visibleText(document.body, host)).toBe('Fare total 1,284.00 USD');
  });

  it('is bounded, so a long page cannot fill a prompt', () => {
    document.body.innerHTML = `<p>${'seat 12A '.repeat(1000)}</p>`;
    expect(visibleText(document.body)).toHaveLength(MAX_PAGE_TEXT);
  });
});

describe('scanAffordances', () => {
  it('sends the page text beside the controls', () => {
    document.body.innerHTML = '<h1>Choose Seats</h1><button>Confirm seats</button>';
    const { page } = scanAffordances({ question: 'which seats do we have' });
    expect(page.text).toBe('Choose Seats Confirm seats');
  });
});
