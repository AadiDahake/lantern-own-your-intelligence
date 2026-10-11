/**
 * A small in-memory stand-in for the PostgREST client, for code whose result depends on what the
 * rows are and not only on which filters it sent.
 *
 * It keeps rows in plain arrays and applies the filters the SMS code uses. It also has the two
 * unique rules of `gap_subscriber`, because the subscribe code depends on both. It proves the
 * logic. It cannot prove a column name or the filter syntax; the run against a real PostgREST
 * does that. Three more things are different from the real stack: it has no foreign key (a test
 * that deletes a gap deletes its rows itself), it never ends a query at its time limit (a test
 * uses `loseAnswerWhen` for a write that lands after the caller gave up), and `maybeSingle`
 * gives the first of many rows where PostgREST gives an error.
 */
export type Row = Record<string, unknown>;
export type FakeError = { message: string; code?: string };
type Answer = { data: unknown; error: FakeError | null; count?: number | null };
type Verb = "select" | "upsert" | "insert" | "update" | "delete";
export type Seen = { table: string; verb: Verb };

export const tables: Record<string, Row[]> = {};
/** Each query that ran, in order. */
export const seen: Seen[] = [];

type Fail = (query: Seen) => FakeError | null;

const hooks: { before: (query: Seen) => void; refuse: Fail; lose: Fail } = {
  before: () => undefined,
  refuse: () => null,
  lose: () => null,
};

export function resetDb(): void {
  for (const name of Object.keys(tables)) delete tables[name];
  seen.length = 0;
  hooks.before = () => undefined;
  hooks.refuse = () => null;
  hooks.lose = () => null;
  dbClock.now = () => Date.now();
  rpcRows.answer = null;
}

/** Runs before a query reads or writes: a test changes rows here to act as a second process. */
export function onQuery(before: (query: Seen) => void): void {
  hooks.before = before;
}

/** The query fails and does nothing: the database refused it, or it was never reached. */
export function failWhen(refuse: Fail): void {
  hooks.refuse = refuse;
}

/** The query does its work and then fails: a write that landed, and an answer that was lost. */
export function loseAnswerWhen(lose: Fail): void {
  hooks.lose = lose;
}

let nextId = 1;

/**
 * Orders two values the way Postgres orders a timestamp column: by the moment, not by the text.
 * The worker writes `+00:00` with microseconds and the web app writes `Z` with milliseconds.
 */
function before(left: unknown, right: string): boolean {
  if (typeof left !== "string") return false;
  const [a, b] = [Date.parse(left), Date.parse(right)];
  return Number.isNaN(a) || Number.isNaN(b) ? left < right : a < b;
}

/** `column.operator.value`, where the value can hold dots (a timestamp). */
function orTerm(term: string): (row: Row) => boolean {
  const [column = "", operator = "", ...rest] = term.split(".");
  const value = rest.join(".");
  if (operator === "is" && value === "null") return (row) => row[column] === null || row[column] === undefined;
  if (operator === "lt") return (row) => before(row[column], value);
  throw new Error(`fake-db: no support for the or() term ${term}`);
}

class FakeQuery implements PromiseLike<Answer> {
  private verb: Verb = "select";
  private payload: Row = {};
  private inserted: Row[] = [];
  private conflict: string[] = [];
  private returning = false;
  private head = false;
  private counted = false;
  private single = false;
  private max = Number.POSITIVE_INFINITY;
  private sort: { column: string; ascending: boolean } | null = null;
  private readonly filters: ((row: Row) => boolean)[] = [];

  constructor(private readonly table: string) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }): this {
    if (this.verb !== "select") this.returning = true;
    this.head = options?.head === true;
    this.counted = options?.count === "exact";
    return this;
  }
  upsert(row: Row, options: { onConflict: string; ignoreDuplicates: boolean }): this {
    if (!options.ignoreDuplicates) throw new Error("fake-db: upsert is supported only with ignoreDuplicates");
    this.verb = "upsert";
    this.payload = row;
    this.conflict = options.onConflict.split(",");
    return this;
  }
  update(patch: Row): this {
    this.verb = "update";
    this.payload = patch;
    return this;
  }
  delete(): this {
    this.verb = "delete";
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  match(values: Row): this {
    for (const [column, value] of Object.entries(values)) this.eq(column, value);
    return this;
  }
  is(column: string, value: null): this {
    if (value !== null) throw new Error("fake-db: is() is supported only with null");
    this.filters.push((row) => row[column] === null || row[column] === undefined);
    return this;
  }
  not(column: string, operator: string, value: null): this {
    if (operator !== "is" || value !== null) throw new Error("fake-db: not() is supported only with is null");
    this.filters.push((row) => row[column] !== null && row[column] !== undefined);
    return this;
  }
  lt(column: string, value: string): this {
    this.filters.push((row) => before(row[column], value));
    return this;
  }
  gte(column: string, value: string): this {
    this.filters.push((row) => typeof row[column] === "string" && !before(row[column], value));
    return this;
  }
  insert(rows: Row | Row[]): this {
    this.verb = "insert";
    this.inserted = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  or(terms: string): this {
    const any = terms.split(",").map(orTerm);
    this.filters.push((row) => any.some((term) => term(row)));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.sort = { column, ascending: options?.ascending !== false };
    return this;
  }
  limit(max: number): this {
    this.max = max;
    return this;
  }
  abortSignal(signal: unknown): this {
    if (!(signal instanceof AbortSignal)) throw new Error("fake-db: abortSignal needs a signal");
    return this;
  }
  maybeSingle(): this {
    this.single = true;
    return this;
  }

  private run(): Answer {
    const query: Seen = { table: this.table, verb: this.verb };
    seen.push(query);
    hooks.before(query);
    const refused = hooks.refuse(query);
    if (refused) return { data: null, error: refused };
    const rows = (tables[this.table] ??= []);
    const matches = (row: Row): boolean => this.filters.every((filter) => filter(row));
    let touched: Row[];

    if (this.verb === "upsert") {
      const same = rows.find((row) => this.conflict.every((column) => row[column] === this.payload[column]));
      if (same) touched = [];
      else {
        const message = this.payload.message_id;
        if (this.table === "gap_subscriber" && message != null && rows.some((row) => row.message_id === message)) {
          return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        }
        const row: Row = { id: `row-${nextId++}`, notified_at: null, created_at: new Date().toISOString(), ...this.payload };
        rows.push(row);
        touched = [row];
      }
    } else if (this.verb === "insert") {
      touched = this.inserted.map((row) => ({ id: nextId++, created_at: new Date().toISOString(), ...row }));
      rows.push(...touched);
    } else if (this.verb === "update") {
      touched = rows.filter(matches);
      for (const row of touched) Object.assign(row, this.payload);
    } else if (this.verb === "delete") {
      touched = rows.filter(matches);
      tables[this.table] = rows.filter((row) => !touched.includes(row));
    } else {
      touched = rows.filter(matches);
      const { sort } = this;
      if (sort) {
        touched = [...touched].sort((a, b) => {
          const [left, right] = [a[sort.column], b[sort.column]];
          const before = typeof left === "number" && typeof right === "number" ? left < right : String(left) < String(right);
          return (before ? -1 : 1) * (sort.ascending ? 1 : -1);
        });
      }
    }

    const lost = hooks.lose(query);
    if (lost) return { data: null, error: lost };
    if (this.verb === "select" && this.head) return { data: null, error: null, count: this.counted ? touched.length : null };
    if (this.verb !== "select" && !this.returning) return { data: null, error: null };
    const out = touched.slice(0, this.max).map((row) => ({ ...row }));
    if (this.single) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }

  then<A = Answer, B = never>(
    onfulfilled?: ((value: Answer) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return new Promise<Answer>((resolve) => resolve(this.run())).then(onfulfilled, onrejected);
  }
}

/** What the database's clock says. A test sets it to put a heartbeat in the past. */
export const dbClock = { now: (): number => Date.now() };

/** Rows that a function answers with in place of its own result, for a test of the caller alone. */
export const rpcRows: { answer: Row[] | null } = { answer: null };

/**
 * `runner_heartbeats` of migration 0020, in JavaScript: the newest 8 heartbeat rows of a project,
 * newest first, with the age of each one on the database's clock. The SQL itself runs only in
 * the check against a real database.
 */
function runnerHeartbeats(args: Row): Row[] {
  return (tables.trace_event ?? [])
    .filter((row) => row.project_id === args.p_project && row.title === "worker online")
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, 8)
    .map((row) => {
      const detail = row.detail as { engine?: unknown; sms?: unknown } | null;
      return {
        engine: typeof detail?.engine === "string" ? detail.engine : "",
        sms: detail?.sms === true,
        age_seconds: (dbClock.now() - Date.parse(String(row.created_at))) / 1000,
      };
    });
}

class FakeRpc implements PromiseLike<Answer> {
  constructor(
    private readonly name: string,
    private readonly args: Row,
  ) {}

  abortSignal(signal: unknown): this {
    if (!(signal instanceof AbortSignal)) throw new Error("fake-db: abortSignal needs a signal");
    return this;
  }

  then<A = Answer, B = never>(
    onfulfilled?: ((value: Answer) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return new Promise<Answer>((resolve) => {
      const query: Seen = { table: `rpc:${this.name}`, verb: "select" };
      seen.push(query);
      hooks.before(query);
      const refused = hooks.refuse(query);
      if (refused) return resolve({ data: null, error: refused });
      if (this.name !== "runner_heartbeats") return resolve({ data: null, error: { message: `no function ${this.name}`, code: "PGRST202" } });
      resolve({ data: rpcRows.answer ?? runnerHeartbeats(this.args), error: null });
    }).then(onfulfilled, onrejected);
  }
}

/** What `serviceClient()` returns in a test. */
export function fakeClient(): { from: (table: string) => FakeQuery; rpc: (name: string, args: Row) => FakeRpc } {
  return { from: (table: string) => new FakeQuery(table), rpc: (name: string, args: Row) => new FakeRpc(name, args) };
}
