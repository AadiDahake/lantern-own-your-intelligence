#!/usr/bin/env node
/**
 * Route memory, end to end through the API: ask, complete the walk, ask again.
 *
 * The first answer is planned as usual. The walk is then reported completed to
 * `POST /api/guide/outcome`, as the widget does at its last step. The same question asked again is
 * answered from the remembered route: `plan.source` is `memory`, the step count is exact, and the
 * turn asks no model for the plan.
 *
 *   LANTERN_API=http://localhost:3000 LANTERN_KEY=<embed key> node integrations/memorable/demo.mjs
 *
 * The server needs `MEMORABLE_API_KEY` (or `LANTERN_ROUTE_MEMORY=local` before a Memorable login).
 */
const API = (process.env.LANTERN_API ?? "http://localhost:3000").replace(/\/$/, "");
const KEY = process.env.LANTERN_KEY;
const SITE = (process.env.NOVAAIR_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const QUESTION = process.argv[2] ?? "How do I change my seats?";
if (!KEY) {
  console.error("Set LANTERN_KEY to the project's embed key (npm run db:seed prints it).");
  process.exit(2);
}

// The NovaAir trip page as the widget scans it: the controls a visitor can see there.
const PAGE = {
  url: `${SITE}/trips/NVA7K2`,
  title: "Trip NVA7K2 | NovaAir",
  affordances: [
    { id: "a1", role: "link", name: "My Booking", landmark: "navigation", href: "/my-booking", visible: true },
    { id: "a2", role: "link", name: "Flights", landmark: "navigation", href: "/flights", visible: true },
    { id: "a3", role: "button", name: "Change seats", landmark: "main", visible: true },
    { id: "a4", role: "button", name: "Add bags", landmark: "main", visible: true },
    { id: "a5", role: "link", name: "Help", landmark: "navigation", href: "/help", visible: true },
  ],
};

async function ask(question) {
  const started = performance.now();
  const response = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: KEY, question, page: PAGE }),
  });
  if (!response.ok || !response.body) throw new Error(`POST /api/chat answered ${response.status}`);
  const text = await response.text();
  const events = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => {
      try {
        return JSON.parse(line.slice(5).trim());
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const answer = events.find((event) => event.type === "answer") ?? null;
  const conversation = events.filter((event) => event.type === "conversation").at(-1) ?? null;
  return { ms: Math.round(performance.now() - started), answer, conversation };
}

function show(label, result) {
  const { answer } = result;
  const plan = answer?.plan ? `${answer.plan.source}, ${answer.plan.total} step${answer.plan.total === 1 ? "" : "s"}` : "no plan";
  console.log(`\n${label}: ${result.ms} ms, plan ${plan}`);
  console.log(`  ${answer?.text ?? "(no answer)"}`);
  for (const [index, step] of (answer?.steps ?? []).entries()) console.log(`  ${index + 1}. ${step.caption}`);
}

console.log(`Question: "${QUESTION}"`);
const first = await ask(QUESTION);
show("First ask", first);
if (!first.answer?.steps?.length) {
  console.error("\nThe first answer has no steps to walk, so there is nothing to remember.");
  process.exit(1);
}

const outcome = await fetch(`${API}/api/guide/outcome`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    key: KEY,
    outcome: "completed",
    question: QUESTION,
    feature: null,
    answer: first.answer.text,
    steps: first.answer.steps,
    conversationId: first.conversation?.conversationId ?? null,
    messageId: first.conversation?.messageId ?? null,
  }),
}).then((r) => r.json());
console.log(`\nWalk completed: ${JSON.stringify(outcome)}`);

const second = await ask(QUESTION);
show("Second ask", second);
const fromMemory = second.answer?.plan?.source === "memory";
console.log(
  fromMemory
    ? `\nThe second answer came from the remembered route: ${second.ms} ms against ${first.ms} ms.`
    : "\nThe second answer did not come from route memory. Is MEMORABLE_API_KEY or LANTERN_ROUTE_MEMORY=local set on the server?",
);
process.exit(fromMemory ? 0 : 1);
