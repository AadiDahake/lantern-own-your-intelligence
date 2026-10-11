/**
 * The agent search over a real connection, on this machine only.
 *
 * A mocked `fetch` cannot show what the real one does with a redirect, with a signal that fires
 * while the answer is on its way, or with a body that never ends. So these cases use the real
 * client against a small HTTP server on 127.0.0.1. Nothing here reaches the network.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { lookElsewhere } from "@/lib/alternatives/search";
import { searchAgents } from "@/lib/darwin";
import type { AgentSearchConfig } from "@/lib/env";
import { SEATS_ANSWER } from "./fixtures/agent-search";

type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };

type Fake = {
  config: AgentSearchConfig;
  seen: Seen[];
  /** Resolves when the client closes a connection before the server has answered on it. */
  dropped: Promise<void>;
  close(): Promise<void>;
};

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

/** Starts a server that hands each search request to `answer`. */
async function fake(answer: (response: ServerResponse, request: Seen) => void, apiKey: string | null = null): Promise<Fake> {
  const seen: Seen[] = [];
  let reportDropped: () => void = () => undefined;
  const dropped = new Promise<void>((resolve) => {
    reportDropped = resolve;
  });
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const entry = {
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      seen.push(entry);
      response.on("close", () => {
        if (!response.writableFinished) reportDropped();
      });
      answer(response, entry);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    config: { apiKey, apiUrl: `http://127.0.0.1:${port}` },
    seen,
    dropped,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const json = (response: ServerResponse, body: unknown, status = 200): void => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

/** The real answer, with its first listing changed into one that passes each rule of the gate. */
const WITH_ONE_READY = {
  ...SEATS_ANSWER,
  results: [
    { ...SEATS_ANSWER.results[0], name: "Find seats together", readiness: "ready", canStartThread: true },
    ...SEATS_ANSWER.results.slice(1),
  ],
};

/** Fails the test when a promise takes longer than it should. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms)),
  ]);
}

describe("searchAgents over a real connection", () => {
  it("sends one POST with the query and the key header, and reads the listings", async () => {
    const server = await fake((response) => json(response, SEATS_ANSWER), "test-key-not-real");
    const found = await searchAgents(server.config, "finding seats together");

    expect(found.ok && found.listings).toHaveLength(7);
    expect(server.seen).toHaveLength(1);
    expect(server.seen[0]).toMatchObject({ method: "POST", url: "/api/v2/search" });
    expect(JSON.parse(server.seen[0]?.body ?? "")).toEqual({ query: "finding seats together", numResults: 10 });
    expect(server.seen[0]?.headers["x-api-key"]).toBe("test-key-not-real");
    expect(server.seen[0]?.headers.authorization).toBeUndefined();
  });

  it("sends no key header in public mode", async () => {
    const server = await fake((response) => json(response, SEATS_ANSWER));
    await searchAgents(server.config, "finding seats together");
    expect(server.seen[0]?.headers["x-api-key"]).toBeUndefined();
  });

  it("does not follow a redirect, so the key goes to one address only", async () => {
    const server = await fake((response, request) => {
      if (request.url === "/api/v2/search") {
        response.writeHead(302, { location: "/somewhere-else" });
        response.end();
        return;
      }
      json(response, SEATS_ANSWER);
    }, "test-key-not-real");
    const found = await searchAgents(server.config, "finding seats together");

    expect(found).toMatchObject({ ok: false, reason: "http_302" });
    expect(server.seen.map((request) => request.url)).toEqual(["/api/v2/search"]);
  });

  it("reads a 503 with a body as a failure, and never as an empty result", async () => {
    const server = await fake((response) => json(response, { code: "SEARCH_UPSTREAM_UNAVAILABLE", message: "Search is temporarily unavailable." }, 503));
    expect(await searchAgents(server.config, "finding seats together")).toMatchObject({ ok: false, reason: "http_503" });
  });

  it("does not read the body of a refusal, and closes the connection", async () => {
    const server = await fake((response) => {
      response.writeHead(503, { "content-type": "application/json" });
      const block = "x".repeat(64_000);
      const timer = setInterval(() => response.write(block), 1);
      response.on("close", () => clearInterval(timer));
    });
    const found = await within(searchAgents(server.config, "finding seats together"), 3_000, "the refusal");
    expect(found).toMatchObject({ ok: false, reason: "http_503" });
    await within(server.dropped, 3_000, "the close of the connection");
  });

  it("stops reading an answer that does not end, at the cap", async () => {
    const server = await fake((response) => {
      response.writeHead(200, { "content-type": "application/json" });
      const block = "x".repeat(64_000);
      const timer = setInterval(() => response.write(block), 1);
      response.on("close", () => clearInterval(timer));
    });
    const found = await within(searchAgents(server.config, "finding seats together"), 5_000, "the capped read");
    expect(found).toMatchObject({ ok: false, reason: "answer_too_large" });
  });

  it("ends at its time limit when the server does not answer, and closes the connection", async () => {
    const server = await fake(() => undefined);
    const found = await within(searchAgents(server.config, "finding seats together", { timeoutMs: 150 }), 3_000, "the timeout");
    expect(found).toMatchObject({ ok: false, reason: "timeout" });
    await within(server.dropped, 3_000, "the close of the connection");
  });

  it("keeps its time limit when the caller gives a signal, also while the body is on its way", async () => {
    // The headers come at once and the body never ends. This is how a turn calls the client.
    const server = await fake((response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"results":[');
    });
    const found = await within(
      searchAgents(server.config, "finding seats together", { timeoutMs: 150, signal: new AbortController().signal }),
      3_000,
      "the timeout",
    );
    expect(found).toMatchObject({ ok: false, reason: "timeout" });
    await within(server.dropped, 3_000, "the close of the connection");
  });

  it("says unreachable for an address where nothing listens", async () => {
    const server = await fake((response) => json(response, SEATS_ANSWER));
    await server.close();
    servers.length = 0;
    expect(await searchAgents(server.config, "finding seats together")).toMatchObject({ ok: false, reason: "unreachable" });
  });
});

describe("the search of one turn over a real connection", () => {
  const on = (config: AgentSearchConfig) => ({ configured: true as const, config });

  it("offers the listing that passed the gate when the answer came before the turn was ready", async () => {
    const server = await fake((response) => json(response, WITH_ONE_READY));
    let answered: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      answered = resolve;
    });
    const looked = lookElsewhere("finding seats together", {
      configured: on(server.config),
      search: (...args) => {
        const pending = searchAgents(...args);
        void pending.then(answered);
        return pending;
      },
    });
    await within(done, 3_000, "the search");
    await new Promise((resolve) => setImmediate(resolve));

    const outcome = looked.take(true);
    expect(outcome).toMatchObject({ state: "done", counts: { found: 7, named: 1, startable: 1 } });
    expect(outcome?.state === "done" && outcome.offered).toEqual([
      {
        name: "Find seats together",
        provider: "FlightSeatMap",
        url: `https://index.darwin.so/agent/${SEATS_ANSWER.results[0]?.agent}?capability=${SEATS_ANSWER.results[0]?.capability}`,
      },
    ]);
  });

  it("does not wait for a slow index: the turn gets `late` at once, and the connection is closed", async () => {
    // The server answers after 5 seconds. The turn is ready after 50 ms.
    const server = await fake((response) => {
      const timer = setTimeout(() => json(response, WITH_ONE_READY), 5_000);
      response.on("close", () => clearTimeout(timer));
    });
    const looked = lookElsewhere("finding seats together", { configured: on(server.config) });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const before = performance.now();
    const outcome = looked.take(true);
    expect(performance.now() - before).toBeLessThan(50);
    expect(outcome).toMatchObject({ state: "late", query: "finding seats together" });
    await within(server.dropped, 3_000, "the close of the connection");
    expect(server.seen).toHaveLength(1);
  });

  it("closes the connection when the turn ends before it reads the search", async () => {
    const server = await fake(() => undefined);
    const looked = lookElsewhere("finding seats together", { configured: on(server.config) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(looked.abandon()).toMatchObject({ state: "abandoned", query: "finding seats together" });
    await within(server.dropped, 3_000, "the close of the connection");
  });

  it("closes the connection when the verdict did not confirm the absence", async () => {
    const server = await fake(() => undefined);
    const looked = lookElsewhere("finding seats together", { configured: on(server.config) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(looked.take(false)).toMatchObject({ state: "dropped" });
    await within(server.dropped, 3_000, "the close of the connection");
  });
});
