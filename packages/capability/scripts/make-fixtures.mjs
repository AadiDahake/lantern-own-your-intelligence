#!/usr/bin/env node
// Generates test/fixtures/sessions.json: seeded, so the same seed always gives the same file.
//
// Every row has the shape the PostHog mining query returns:
//   { session_id, distinct_id, opened_at, confirmed_at, duration_seconds, step_count, steps }
// with `steps` as the ordered [{ t, event, props }] list, following NovaAir's analytics contract.
//
// What is in the file:
//   63 successful family sessions, in three shapes plus variation, whose manual seat-map action
//      counts have a median of 14
//   15 sessions the reward model must set aside: 6 that only browsed, 6 that stopped part way,
//      3 parties of four that confirmed scattered seats
//    5 unrelated sessions: 3 that only read help articles, 2 that changed one seat
//
// Run: node scripts/make-fixtures.mjs   (from packages/capability)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const SEED = 20260829;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FLIGHTS = ["NA214", "NA318", "NA412", "NA507"];
const COLUMNS = ["A", "B", "C", "D", "E", "F"];
const EXIT_ROWS = [15, 16];
const PAID_ROWS = [1, 2, 3, 15, 16];
const BLOCKED = "20D";
const HELP = ["baggage-allowance", "check-in", "changes-and-refunds"];
const WINDOW_START = Date.UTC(2026, 5, 2, 8, 0, 0); // 2026-06-02
const WINDOW_DAYS = 86;

export function generate(seed = SEED) {
  const random = mulberry32(seed);
  const int = (min, max) => min + Math.floor(random() * (max - min + 1));
  const pick = (list) => list[int(0, list.length - 1)];
  const chance = (p) => random() < p;
  const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[int(0, 15)]).join("");
  const sessionId = () => `0199${hex(4)}-${hex(4)}-7${hex(3)}-8${hex(3)}-${hex(12)}`;
  const code = () => Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[int(0, 31)]).join("");
  const seatPrice = (row) => (PAID_ROWS.includes(row) ? 39 : 0);
  const seatState = (row, col) => {
    const seat = `${row}${col}`;
    if (seat === BLOCKED) return "blocked";
    if (EXIT_ROWS.includes(row)) return "restricted";
    return chance(0.6) ? "booked" : "available";
  };
  const randomSeat = () => `${int(4, 30)}${pick(COLUMNS)}`;
  const scattered = (n) => {
    const out = new Set();
    while (out.size < n) out.add(randomSeat());
    return [...out];
  };
  const startTime = () => WINDOW_START + int(0, WINDOW_DAYS * 24 * 60) * 60 * 1000 + int(0, 59) * 1000;

  /** A session under construction: a clock and an ordered step list. */
  function session() {
    const s = { id: sessionId(), user: `user_${hex(8)}`, t: startTime(), steps: [], opened: null, confirmed: null };
    s.emit = (event, props, seconds) => {
      s.t += Math.max(1, seconds) * 1000;
      const t = new Date(s.t).toISOString();
      s.steps.push({ t, event, props });
      if (event === "seat_map_opened" && !s.opened) s.opened = t;
      if (event === "seat_assignment_confirmed") s.confirmed = t;
    };
    s.row = () => {
      const first = s.steps[0]?.t ?? new Date(s.t).toISOString();
      const opened = s.opened ?? first;
      const duration = s.confirmed ? Math.round((Date.parse(s.confirmed) - Date.parse(opened)) / 1000) : 0;
      return {
        session_id: s.id,
        distinct_id: s.user,
        opened_at: opened,
        confirmed_at: s.confirmed,
        duration_seconds: duration,
        step_count: s.steps.length,
        steps: s.steps,
      };
    };
    return s;
  }

  /** A group of `size` seats side by side in one row, on one side of the aisle, in a free or paid row. */
  function targetGroup(size, paid) {
    const free = [];
    for (let r = 4; r <= 30; r++) if (!EXIT_ROWS.includes(r) && r !== 20) free.push(r);
    const row = paid ? pick([1, 2, 3]) : pick(free);
    const side = chance(0.5) ? ["A", "B", "C"] : ["D", "E", "F"];
    const start = size === 3 ? 0 : int(0, 3 - size);
    return { row, seats: side.slice(start, start + size).map((c) => `${row}${c}`) };
  }

  function open(s, flight, partySize, current, reservation) {
    s.emit("seat_map_opened", { reservation_code: reservation, flight_id: flight, party_size: partySize, current_seats: current, cabin: "economy" }, 0);
  }

  function hover(s, row, col, state) {
    s.emit("seat_hovered", { seat: `${row}${col}`, row, column: col, state }, int(1, 4));
  }

  function choose(s, index, type) {
    s.emit("passenger_selected", { passenger_index: index, passenger_type: type }, int(2, 6));
  }

  function select(s, seat, index) {
    const row = Number.parseInt(seat, 10);
    const col = seat.slice(-1);
    s.emit("seat_selected", { seat, row, column: col, passenger_index: index, state: "available", price: seatPrice(row), currency: "USD" }, int(3, 12));
  }

  function refuse(s, seat, reason) {
    s.emit("seat_selection_rejected", { seat, reason }, int(2, 5));
  }

  function confirm(s, seats, partySize, together, actionsSoFar, openedAt) {
    const cost = seats.reduce((sum, seat) => sum + seatPrice(Number.parseInt(seat, 10)), 0);
    const pause = int(4, 15);
    s.emit(
      "seat_assignment_confirmed",
      {
        seats,
        party_size: partySize,
        same_row: together,
        contiguous: together,
        additional_cost: cost,
        currency: "USD",
        interactions: actionsSoFar,
        elapsed_ms: s.t + pause * 1000 - openedAt,
      },
      pause,
    );
  }

  function scanRows(s, count, nearRow) {
    for (let i = 0; i < count; i++) {
      const row = Math.min(30, Math.max(1, nearRow + int(-3, 3)));
      const col = pick(COLUMNS);
      hover(s, row, col, seatState(row, col));
    }
  }

  const passengerType = (index) => (index === 0 ? "adult" : "child");

  /**
   * One successful family session with exactly `actions` manual seat-map actions.
   * shape: "A" clean scan then select; "B" refused rows then another row; "C" wandering with
   * re-selections. The count of manual actions is what the demo's median comes from.
   */
  function family(shape, partySize, actions, extras) {
    const s = session();
    const flight = pick(FLIGHTS);
    const current = scattered(partySize);
    const reservation = code();
    const group = targetGroup(partySize, extras.paid);
    if (extras.helpFirst) s.emit("help_article_viewed", { slug: "traveling-with-children" }, 0);

    // A second round (reopen, move everyone once more) costs 2 hovers plus a pick and a click per
    // passenger. It comes out of the session's action budget so the total stays exact.
    const secondRoundActions = extras.secondRound ? 2 + 2 * partySize : 0;
    const firstActions = actions - secondRoundActions;

    open(s, flight, partySize, current, reservation);
    const openedAt = s.t;
    let done = 0;
    const spare = firstActions - 2 * partySize;
    if (spare < 0) throw new Error(`session needs at least ${2 * partySize} actions, got ${firstActions}`);

    const refusals = shape === "A" ? (spare >= 3 && chance(0.3) ? 1 : 0) : shape === "B" ? Math.min(spare, int(2, 4)) : Math.min(spare, int(1, 3));
    const reselects = shape === "C" ? Math.min(Math.max(0, spare - refusals), int(1, 3)) : shape === "B" && spare - refusals > 3 && chance(0.4) ? 1 : 0;
    const hovers = spare - refusals - reselects;
    const refusalsFor = Array.from({ length: partySize }, () => 0);
    for (let i = 0; i < refusals; i++) refusalsFor[i % partySize] += 1;

    // Scanning happens before the first pick and between passengers.
    const before = shape === "A" ? Math.ceil(hovers * 0.7) : shape === "B" ? Math.ceil(hovers * 0.5) : Math.ceil(hovers * 0.4);
    scanRows(s, before, group.row - 2);
    done += before;
    let hoversLeft = hovers - before;

    const chosen = [];
    for (let index = 0; index < partySize; index++) {
      choose(s, index, passengerType(index));
      done += 1;
      if (hoversLeft > 0 && index < partySize - 1) {
        const n = Math.min(hoversLeft, int(1, 3));
        scanRows(s, n, group.row);
        hoversLeft -= n;
        done += n;
      }
      for (let r = 0; r < refusalsFor[index]; r++) {
        const reason = shape === "B" ? pick(["booked", "booked", "child_in_exit_row", "blocked"]) : pick(["booked", "blocked", "child_in_exit_row"]);
        const seat = reason === "blocked" ? BLOCKED : reason === "child_in_exit_row" ? `${pick(EXIT_ROWS)}${pick(COLUMNS)}` : randomSeat();
        refuse(s, seat, reason);
        done += 1;
      }
      if (index === 0) {
        for (let r = 0; r < reselects; r++) {
          select(s, randomSeat(), index);
          done += 1;
        }
      }
      select(s, group.seats[index], index);
      chosen.push(group.seats[index]);
      done += 1;
    }
    if (hoversLeft > 0) {
      scanRows(s, hoversLeft, group.row);
      done += hoversLeft;
    }
    if (done !== firstActions) throw new Error(`built ${done} actions, wanted ${firstActions}`);
    confirm(s, chosen, partySize, true, done, openedAt);

    if (extras.secondRound) {
      // Changed their mind: read about fees, reopened the map and moved everyone to another row.
      s.emit("help_article_viewed", { slug: "seat-selection-fees" }, int(20, 60));
      open(s, flight, partySize, chosen, reservation);
      const reopenedAt = s.t;
      const other = targetGroup(partySize, false);
      let round = 0;
      scanRows(s, 2, other.row);
      round += 2;
      for (let index = 0; index < partySize; index++) {
        choose(s, index, passengerType(index));
        select(s, other.seats[index], index);
        round += 2;
      }
      confirm(s, other.seats, partySize, true, round, reopenedAt);
    }
    if (extras.helpAfter) s.emit("help_article_viewed", { slug: pick(["seat-selection-fees", "check-in"]) }, int(5, 20));
    return s.row();
  }

  const rows = [];

  // 63 successful sessions. The manual action counts are laid out so the 32nd of 63 is 14.
  const below = [7, 8, 8, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11, 11, 12, 12, 12, 12, 12, 12, 13, 13, 13, 13, 13, 13, 13, 13];
  const above = [15, 15, 15, 15, 15, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 19, 19, 19, 20, 20, 21, 21, 22, 22, 23, 24, 25, 27];
  const counts = [...below, 14, 14, 14, 14, 14, ...above];
  if (counts.length !== 63) throw new Error(`expected 63 counts, got ${counts.length}`);
  for (let i = counts.length - 1; i > 0; i--) {
    const j = int(0, i);
    [counts[i], counts[j]] = [counts[j], counts[i]];
  }
  let secondRounds = 0;
  counts.forEach((actions, i) => {
    const partySize = actions <= 9 ? 2 : i % 6 === 0 ? 2 : 3;
    const shape = actions <= 12 ? "A" : actions <= 17 ? (chance(0.6) ? "B" : "A") : chance(0.5) ? "C" : "B";
    const extras = {
      paid: i % 8 === 3,
      helpFirst: chance(0.3),
      helpAfter: chance(0.12),
      secondRound: actions >= 22 && secondRounds++ < 3,
    };
    rows.push(family(shape, partySize, actions, extras));
  });

  // 6 that only browsed the seat map.
  for (let i = 0; i < 6; i++) {
    const s = session();
    const partySize = pick([2, 3, 3]);
    open(s, pick(FLIGHTS), partySize, scattered(partySize), code());
    scanRows(s, int(4, 9), int(8, 24));
    rows.push(s.row());
  }

  // 6 that stopped part way.
  for (let i = 0; i < 6; i++) {
    const s = session();
    const partySize = 3;
    open(s, pick(FLIGHTS), partySize, scattered(partySize), code());
    scanRows(s, int(2, 5), int(8, 24));
    const group = targetGroup(3, false);
    const moved = int(1, 2);
    for (let index = 0; index < moved; index++) {
      choose(s, index, passengerType(index));
      select(s, group.seats[index], index);
    }
    if (chance(0.5)) refuse(s, randomSeat(), "booked");
    rows.push(s.row());
  }

  // 3 parties of four that could not sit in one row and confirmed scattered seats.
  for (let i = 0; i < 3; i++) {
    const s = session();
    const partySize = 4;
    open(s, pick(FLIGHTS), partySize, scattered(partySize), code());
    const openedAt = s.t;
    const hovers = int(5, 9);
    scanRows(s, hovers, int(8, 24));
    let done = hovers;
    refuse(s, randomSeat(), "booked");
    done += 1;
    const seats = scattered(4);
    for (let index = 0; index < partySize; index++) {
      choose(s, index, passengerType(index));
      select(s, seats[index], index);
      done += 2;
    }
    confirm(s, seats, partySize, false, done, openedAt);
    rows.push(s.row());
  }

  // 3 that only read help articles.
  for (const n of [1, 2, 3]) {
    const s = session();
    for (let i = 0; i < n; i++) s.emit("help_article_viewed", { slug: HELP[i % HELP.length] }, i === 0 ? 0 : int(20, 90));
    rows.push(s.row());
  }

  // 2 that changed one seat: a party of one.
  for (const hovers of [0, 1]) {
    const s = session();
    const current = scattered(1);
    open(s, pick(FLIGHTS), 1, current, code());
    const openedAt = s.t;
    scanRows(s, hovers, 12);
    choose(s, 0, "adult");
    const seat = randomSeat();
    select(s, seat, 0);
    confirm(s, [seat], 1, true, hovers + 2, openedAt);
    rows.push(s.row());
  }

  return rows.sort((a, b) => a.opened_at.localeCompare(b.opened_at) || a.session_id.localeCompare(b.session_id));
}

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = join(here, "..", "test", "fixtures", "sessions.json");

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = generate();
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(rows, null, 2)}\n`);
  const successful = rows.filter((r) => r.steps.some((s) => s.event === "seat_assignment_confirmed" && s.props.same_row === true && s.props.party_size > 1));
  console.log(`wrote ${rows.length} sessions to ${FIXTURE_PATH} (${successful.length} successful family sessions)`);
}
