# Guidance: how a question becomes a walk on the page

This document covers the guidance loop: what was observed when it went wrong, the design that
replaces it, and the measurements that show the design holds. Observed facts and hypotheses are
kept apart throughout.

## 1. What was observed

Setup: NovaAir in development mode with the widget embedded, Lantern in development mode, one
project with the NovaAir help center in its knowledge base (added through "Web page" on the
Knowledge page: one document, seven pages, 43 passages), no repository connected, a 1440 by 900
window. Times come from the `trace_event` rows of each conversation and from an observer script
that stamped every change of the spotlight in the page.

### Run 1: "Where do I change my seat?" from the home page

Observed:

- The turn made three model calls: understanding (1245 ms), the step plan (2761 ms) and, after
  the first click, a continuation (4438 ms).
- The documentation check hit at 0.77. Its best passage was page chrome from the crawled help
  index ("Skip to main content / Help center Seats"); the passage with the instructions ranked
  third.
- The answer arrived 4.6 s after the question. The widget announced **"Step 1 of 1"** with the
  caption "Open My Booking". The ring covered the "My Booking" link in the hero. That was the
  correct control.
- The stored plan had one step. The plan the model wrote was cut at the first control that was
  not on the page, by design (`turn.ts`, "reachable").
- On the click, the widget hid the spotlight for 4.56 s while it asked the server for the rest,
  then announced **"Step 2 of 2"**, caption "Open your booking details", with the ring on the
  "My Booking" pill in the top navigation. That link leads to the page the user was already on.
- The user filled the form and pressed "Find my booking" themselves. On the Manage Trip page the
  widget still said "Step 2 of 2" and still pointed at the navigation pill. "Change seats" was
  visible and was never pointed at.
- The user pressed "Change seats" themselves. On the seat map the widget still said "Step 2 of
  2". The walk never finished.

### Run 2: the same question from the Manage Trip page

Observed:

- Two model calls before the answer (understanding 1053 ms, plan 1293 ms); the answer arrived
  2.7 s after the question and the spotlight 2.9 s after the status line started.
- **"Step 1 of 1"**, caption "Select Change seats", ring on "Change seats". Correct.
- On the click the widget hid the spotlight and made a third model call (1986 ms) that answered
  "nothing left", then reopened the panel with the walk finished.

### Run 3: "Where do I add a checked bag?" from the Manage Trip page

The Bags tab is on that page and the baggage article is in the knowledge base. Observed:

- The documentation check missed: the best passage, "Checked bags ... Add bags in the Bags section
  of Manage Trip", scored 0.58 against a threshold of 0.70.
- The interface check missed: the "Bags" tab scored 0.33 against "add checked bag".
- The verdict model confirmed absence (1818 ms). The widget said "Add checked bag is not
  available here today". Four model calls, no spotlight.

### "Can you find us three seats together?" on the seat map (through the API)

Observed: the documentation check missed at 0.59 (best passage: "Traveling with children"), the
verdict was absent, and the answer read "Seat selection is not available here today", because
the understanding step had named the capability "Seat selection".

### The divergence

The proven path is a target on the current page: the plan is one step, the id is live, the
spotlight lands. The failing path is a target on another page. The plan is built from the
affordances of the current page only, so it stops at the first navigation and the announced count
is the count of controls on this page, not the count of the route. Every navigation then costs a
model call before the next step can be shown, and that call has to guess the next control from
the new page alone, which is where the ring landed on the wrong "My Booking".

### The smallest counterfactual

The same question was sent through the API from the home page with every control of the whole
route listed as page affordances, the later ones marked not on screen. The plan still came back
with one step: the prompt says to stop at the first control that opens the rest. So the short
count was not only an information gap; it was designed in, because an id on a later page could
not be known.

### Three wrong answers to one question, after the graph landed

Setup: NovaAir in production, booking NVA7K2, passenger Musk, the seat map. The widget is the
real one on the real page; every request it makes to the deployed Lantern is served from a
Lantern running this repository instead (`npm run ask:live`). The project has its help center
imported and its product map explored, and, unlike every run above, a repository is bound to it
(`AadiDahake/novaair-own-your-intelligence`). The question: "I'm traveling with my two kids. Can
you find us three seats together?"

The product cannot do this. The answer it used to give was the absence answer with the offer to
report it. Three different wrong answers came back instead, and all three have the same trigger
and the same mask.

**The trigger.** A question for a capability the product does not have, asked on a page that is
full of controls sharing one word with it. The seat map is 169 controls, and "Seat 1C, available,
45 dollars" matches "finding seats together" on the word "seat".

**The mask.** Two crossed wires let that question reach the answer path.

- `searchControls` ranks a control by its name and by the title of the page it sits on. On the
  help article titled "How do I change my seat?" there is a link named "Find a flight". Its own
  name covers a third of "finding seats together"; the article's title lifted it to 0.53, the
  highest score in the whole product map.
- The capabilities check refused it correctly: a three-concept capability needs three quarters of
  its concepts on the control, and 0.33 is not that. But its `hit` is the two halves of the check
  combined, and the repository half was true, because six source file paths in the bound
  repository contain the word "seat". `routeProbes` then read the `hit` of one half beside the
  `score` of the other: `hit && 0.53 >= 0.5` is an answer.

With the turn on the answer path and no control in the product map that does the thing, the
resolution named no target, and the turn fell back on planning over the page in front of the
user. That is where the three symptoms come from: a model with a seat map in its prompt and no
instruction that the capability does not exist.

**Symptom 1: a plan over the seat buttons.** Observed four times out of six, from the seat map.

> "Three adjacent seats are available in row 2: 2A, 2B, and 2C. A child under 13 must sit next to
> an adult on the same booking."
> Steps: Select seat 2A, Select seat 2B, Select seat 2C. `plan: {source: "page", total: 3}`

The widget announced "Step 1 of 3" and spotlit seat 2A. Nothing in the product finds seats
together; the model read availability off the control names and wrote a click-through.

**Symptom 2: a claim with no steps.** Observed from the seat map with the grid scrolled out of
the viewport, so the seat buttons were marked "not on screen yet" in the prompt.

> "I could not find three adjacent available seats on the currently visible portion of the seat
> map."

No steps, no report offer, and a statement about the product that came from reading a page.

**Symptom 3: a dead end.** Observed from Manage Trip, where there are no seat controls at all.

> "I could not find instructions for finding or selecting three seats together. The documentation
> only says that a child under 13 must sit next to an adult on the same booking."

No steps. No feature request was drafted, because drafting one belongs to the absence path, so
the widget showed no "Report to developers" button. The demo beat was gone.

**What the three checks actually said**, on every one of those runs:

| check | hit | score | summary |
|---|---|---|---|
| documentation | no | 0.44 | the nearest passage does not say the product does this (read to decide) |
| this page | no | 0.33 | no control on this page does this |
| known product capabilities | **yes** | **0.53** | no control for this on the site, but the repository has code that mentions it (6 files) |

The two checks that looked at the product both said no. The third said no about the product and
yes about the code, and the number beside it belonged to a link to the flight search.

### Hypotheses, and what would falsify them

- Hypothesis: a plan built over the whole site, with controls identified by what the user sees
  and not by a positional id, announces the right count and needs no model call on navigation.
  Falsified if a walk over such a plan changes its count, or if the first step of a route the
  graph knows fails to bind to the live page.
- Hypothesis: the knowledge base was missing the answers because the crawl stored chrome and the
  threshold was set for near-title matches. Falsified if, with per-article documents and a tuned
  check, the how-to questions in the offline set still miss or the absence cases hit.

## 2. The design

### A site capability graph

Lantern keeps a graph of the host product: pages (a route such as `/trips/:id/seats`, a title),
controls (identified by role, accessible name, landmark and link target, never a selector) and
transitions (this control on this page led to that page, or revealed that control on the same
page). It is the shape VACP formalises as a capability graph with an action catalog, and it is
filled the way OS-Genesis fills its trajectories: by interaction-driven discovery, recording
`<state before, action, state after>` triplets.

Two sources feed it, through `supabase/migrations/0015_site_graph.sql`:

- The explorer (`apps/web/lib/graph/explorer.ts`) runs where a browser can: the console's
  "Explore site" queues a job (`site_explore_job`), and the forge runner or `npm run explore`
  on a machine of the team's carries it while the console polls. It drives a headless browser
  with the same scanner code the widget uses (`packages/widget/src/scan/standalone.ts`, built to `scanner.js`). It reads
  every page from the site address, follows internal links, presses the controls that are not
  links on a fresh load of each page to see whether they navigate or reveal, and fills the forms
  it meets with values a small model suggests from the page's own text. Bounded: depth 3, 40
  pages, 25 presses per page, 4 forms, no control whose name reads as destructive, at most two of
  a series. On NovaAir it reads 15 pages and 494 controls and records 221 transitions and 58
  reveals in about 50 seconds; the booking form is filled from the hint on the page and leads to
  Manage Trip.
- The widget's live scans. Every question records the page it was asked on (`POST /api/chat`),
  and the widget reports the page after a navigation and the control the user pressed to get
  there (`POST /api/site/observe`). People exploring the product are the second explorer.

The console's "Product map" page lists pages, controls and transitions with last-seen times, the
known routes, and an "Explore site" action.

### The page in front of the visitor is always on the map

The map is what a route is planned over, so until a page is on it, a control the visitor can see
is a control the agent cannot point at. That is a race the visitor always loses three ways: the
scan is written at the start of a turn but the map is read beside it, the map is cached per
process for `CACHE_MS` (5 s, `apps/web/lib/graph/store.ts`), and a page whose origin is not the
project's site is never written at all. On the evening of 2026-08-30, on a preview deployment
carrying a new "Find three seats together" button, all three lined up: the interface check saw the
button, the candidates did not, and the page planner answered with three clicks on three seats.

So `mapWithCurrentPage` (`apps/web/lib/graph/live.ts`) merges the controls of the page the
question was asked on into the map the turn plans over - in memory, for that turn, keyed exactly
as the map keys them, with a `live:` id so a merged control is never mistaken for a stored row.
The route to one of them is the one step of pressing it, "from this page".

Nothing about that merge writes. What a scan may teach the map is still `belongsToSite` alone
(`apps/web/lib/graph/origin.ts`), and a route learned on a foreign origin is still not remembered.
The capabilities check keeps the stored map too: what it searched is a claim about the product,
not about the page the visitor happens to be on.

A `site_url` change is effective on the very next request. No project lookup is cached anywhere:
`/api/chat`, `/api/site/observe`, `/api/escalate`, `/api/transcribe`, `/api/speak` and
`/api/feedback` each read the row by embed key on every call. The only cache in this path is the
site graph's five seconds, and every write to the graph drops it. A page rejected as foreign after
the site was changed is an origin that really differs - a scheme, a port, or one of a preview's
several hostnames - and not a stale read.

### Deterministic route planning

A question resolves to one target control, and the plan is the shortest path to it
(`packages/shared/src/planner.ts`, breadth-first over navigation transitions, with a reveal step
inserted when a control is hidden behind a tab or a menu on the page as it is now). The model
never counts steps: the count is the length of the path.

Resolution (`apps/web/lib/agent/resolve.ts`): candidates come from a keyword search over the
map, which by then holds the current page's own controls; the route to
each candidate is computed first and shown to the model with the candidate; the model chooses the
target, writes the answer and writes one caption per step of the chosen route. Captions that do
not pass the plan checks are replaced by ones written from the control's role and name ("Open My
Booking", "Select the Seats tab"), which always pass.

The first step is bound to the live affordance id on the page the widget scanned; later steps
carry the control's identity and are bound by the widget when it gets there. `validatePlan` still
rejects any live id the widget did not send.

### Known routes without a model

A resolved (project, intent) pair is stored as a known route: the intent is the question's
concepts, sorted, so a rewording with the same words is an exact hit with no model and no
embedding; a new wording is matched by the embedding the documentation check needs anyway at
0.92 or above. On a hit the route is planned from the current page and the answer is streamed at
once. This is ToolCUA's move: a repeated procedure becomes one call, `navigate_to(change_seats)`.

An exact hit is served before the message is read, because the same concepts in a question that
already resolved to a control on this site is the same question. The read is in flight, as on
every turn, and its answer is simply not needed. The looser embedding match waits for the read,
so a message that turns out to be small talk can never be answered with somebody else's walk.

### Not every message is a question about the product

The message is classified before anything is searched (`apps/web/lib/agent/understand.ts`, and
the table in section 4 of `docs/contracts.md`). A greeting, a question about the assistant and a
piece of general knowledge are `chat` and are answered from the model in a sentence or two; a
question the page already answers is `page` and is answered from the page's own text and its
controls; only `product` and `mixed` run the three checks, the verdict and the absence path.
Before this, every message ran the absence pipeline, so "Hello, can you hear me?" came back as an
apology for a missing feature and an offer to report it to the developers.

Three rules keep it safe. A `chat` or `page` answer never names a control the scan did not send
and never claims the product does anything; a capability is only ever asserted from a probe hit;
and anything the classifier is unsure of is `mixed`, which still checks its evidence before it
speaks. The page's own words reach the server because the scan sends them: `visibleText` in
`packages/widget/src/scan/text.ts` collapses the rendered text of the host page, skips the
widget's own host and anything hidden, and bounds it at 2000 characters.

### Binding on navigation

The widget binds each step by stable identity, on every scan. After a navigation it rescans,
waits for the page to settle and rescans once more, and only then asks the server, which
recomputes the route over the graph from the new page with no model. When the count differs from
what was announced the answer says so ("The route changed: N steps to go."). After the last step
the walk is done; there is no call to ask whether anything is left.

### Highlighting that never lies

The spotlight draws the live rect, scrolls the control into view, follows resize and mutation,
dims the rest of the page and shows "Step N of M" with M fixed for the walk. A step succeeds on
pointerdown or on the navigation it causes. The geometry rules stand: no empty or off-screen rect
is ever drawn.

### A real knowledge base

"Import help center from the site" reads the help pages the explorer found (or a sitemap), keeps
the article element only, stores one document per article with its address, and chunks by
heading with the article's title carried into every section chunk. The documentation check ranks
passages by similarity damped by the share of the question's concepts the passage uses, counts a
sure hit above 0.62 and a sure miss below 0.40, and in between reads the passage with a small
model that answers whether the product does what was asked or the passage describes a manual
workaround. The answer cites the article.

### Only a control that says it does the thing

One rule decides every "is this the control for it" question, and every check imports it from the
same place (`coversCapability` in `@lantern/shared`): a label accounts for the capability when it
carries all of a one or two concept capability, or three quarters of a longer one. It reads the
control's own accessible name and nothing else. The page title still ranks a control, so "Seats"
on Manage Trip outranks "Seats" in a footer, but it can no longer lend a control a concept the
control has not got. The same rule runs over the file paths of the connected repository, because
one word of a capability in a path is one word, not an implementation of it.

A route is only ever planned to a control that passes it, or to a control that a documentation
passage names while that passage covers the question. Those are the two doors, and a seat button
opens neither. Nothing else is put in front of the model to choose from.

The rule holds the interface check to the same line: a name that accounts for the capability is a
hit however many other words it carries, so "Find three seats together" and "Find seats together"
say the same thing to it.

It also decides two things about the page planner, the last resort that reads the raw element
list. It is not reached at all while a control the visitor can see does what was asked - that
control is the answer, in one step - and the walk it writes is kept only when the last step lands
on a control that passes one of the two doors (`planEndsOnCapability`). The steps before the last
open a tab or a dialog and are free; the last one is the answer. On a page where every control
shares a word with the question, a walk that ends anywhere else is not guidance, so the turn keeps
the words and drops the steps.

### Absence with evidence

The "Known product capabilities" check searches the graph before the repository: its evidence
says how many pages and controls were searched, and its summary names the control it found. A
control found elsewhere on the site routes the turn to `answer`; code alone stays a hedge. The
check scores only the control it would route to, so a score is always about a control the user
can be walked to, and the router can never read the score of one half of the check beside the
hit of the other.

When the three checks agree that nothing does this, the turn says so, drafts the feature request
and offers to report it. The page in front of the user is planned over only when the
documentation or a control on that page is what found the capability. When neither did, there is
nothing on the page to point at, and the turn says that and offers the report rather than asking
a model to find a way through the controls it can see.

## 3. Measurements

All against NovaAir in development mode on this machine, with Lantern in development mode, the
project's graph explored and its help center imported. Numbers come from `npm run e2e:guide`
(`e2e/guide.spec.ts`), from `trace_event` rows, from `npm run eval:docs`, and from posting to
`POST /api/chat` against the running stack.

### The walk

- From the home page, "Where do I change my seat?" announces **3 steps** (My Booking, Find my
  booking, Change seats). Every ring overlaps the control it names. The counter reads "Step 1 of
  3", "Step 2 of 3", "Step 3 of 3" and never changes; the walk ends on the seat map and the
  answer card reads "3 steps".
- Time from pressing Enter to the first spotlight, new route: 4.8 s and 6.2 s over two runs
  (target under 5 s; the second run was before the understanding call was moved beside the
  lookups and the resolution call trimmed, after which the server side of the turn took 3.1 to
  3.8 s). The turn makes two model calls, understanding and the resolution that chose the
  target and wrote the captions, plus one reading of the documentation passage when its score
  falls in the band that a number alone cannot decide.
- Time to the first spotlight, known route (the same question from the Manage Trip page): 943,
  987 and 1103 ms over three runs (target under 1.5 s), and 518 ms from the Manage Trip page of
  the deployed site. One row lookup and one graph read; the answer waits on no model. The reading
  of the message is started beside those lookups for the sake of the questions that miss, and on
  a hit it is never awaited or read.
- On navigation the widget bound the next step by identity from its own scan; no `continueFrom`
  request was made during the successful walk.

### Intent routing

Measured on 2026-08-29 against the running stack (Lantern in development mode on this machine,
a project with 15 pages, 501 controls and six help articles), by posting to `POST /api/chat` and
reading the stream.

- The 16 fixture messages in `apps/web/test/fixtures/intents.ts`, four of each class, are
  classified correctly by `MODELS.understand` in five consecutive runs of
  `apps/web/test/understand.live.test.ts`: 16 of 16 each time, 1.3 to 1.8 s for all sixteen in
  parallel. The suite skips itself without `OPENAI_API_KEY`, so CI stays offline.
- "Hello, can you hear me?" now answers "Hello! Yes, I can hear you. How can I help?" in 2.4 to
  4.5 s, with no probe, no verdict and no offer to report anything. Before, it ran the three
  checks and came back with an apology for a missing feature.
- "What time does my flight leave?" on Manage Trip answers "Your flight departs at 22:40." from
  the page's own text in 2.4 s. On a page that does not say, the answer says so and invites the
  question the product path answers, rather than ending in a dead end.
- "Where do I change my seat?" from the home page is unchanged: three probes, verdict `answer`,
  a three-step route over the product map, in 7.2 s server-side including the documentation
  search and the resolution.
- The same question again, from the same page: 350, 550 and 830 ms, served from the product map
  before the read comes back.

### The explorer

One run over NovaAir: 15 pages, 494 controls, 221 transitions and 58 reveals in 49.8 s. The
booking form was filled from the hint on the page (the demonstration code and the last name) and
led to the Manage Trip page, which is the edge the three-step route needs.

### The documentation check

The offline set has seven questions the help center answers and five it does not, including
three wordings of seating a party together. Ranking by similarity alone put the right article
first for every question but could not separate the answered questions from the absent ones:
the weakest right answer scored 0.566 and the strongest absent case 0.655. With the combined
score the strongest absent case fell to 0.486 and the weakest right answer to 0.464, still not
separable by one line. With the reading in the band the set scores 12 of 12: every answered
question hits ("Where do I add a checked bag?" at 0.565, confirmed by reading) and every absent
case misses, including "I'm traveling with my two kids. Can you find us three seats together?"
(0.471, read, does not cover) and "seats together" (0.486, read, does not cover).

Live, on the seat map, "Can you find us three seats together?" gives: documentation does not
cover it, no control on this page, no control on the site ("searched 15 pages and 496
controls"), verdict absent, and the answer "there is no way of finding seats together here
today". On the Manage Trip page, "Where do I add a checked bag?" now hits the "Baggage
allowance" article, resolves to the Bags tab and spotlights it as "Step 1 of 1"; before, it was
answered as absent.

### The question the product cannot answer, and the day it can

Both runs are `npm run ask:live` against the live NovaAir: the real widget on the real page, with
every request it makes to the deployed Lantern served from this branch instead.

- The seat map of the deployed NovaAir, which has no such control. "I'm traveling with my two
  kids. Can you find us three seats together?" The documentation misses at 0.44 (in the band, and
  the reading says the passage does not cover it), no control on this page does it at 0.33, and
  the product map answers "no control for this on the site (searched 15 pages and 451 controls)
  and nothing in the repository implements it". Verdict absent. The answer: **"I am sorry, there
  is no way of finding seats together here today. I checked the documentation, this page, and 15
  pages with 451 controls of this product, and found nothing. I can report this to the developers
  so they can build it. Would you like me to?"** No steps, and the widget shows the "Report to
  developers" button beside the drafted request.
- The preview build that has the capability, same booking, same page. "Okay, how do I get seats
  together now?" The interface check hits at 1.00 on the accessible name "Find seats together",
  the capabilities check finds the same control, and the route from the page the user is on is one
  step. The answer: **"Finding seats together is available on the Choose Seats page. I'll show
  you how to use it."** The ring covers the button and the counter reads "Step 1 of 1".

The capability the understanding step names is not the same in the two questions ("finding seats
together" for one, and it may as easily be "getting seats together" for the other), and the
control is named for a third verb. That is why a capability of three concepts or more is allowed
one concept that does not match: the verb is the user's, not the product's. Two concepts still
have to match in full, or every seat button becomes a way of changing a seat.

### What changed in the counts

The walk in section 1 announced 1 of 1, then 2 of 2, and never finished. The same question now
announces 3 of 3 from the first message and finishes on the seat map. The counterfactual in
section 1 predicted this: the count was never a model's guess to fix, it was information the
model did not have and a prompt that told it to stop. Both are gone.

## 4. What it borrows

- OS-Genesis (arXiv:2412.19723): interaction-driven functional discovery, the `<s_pre, a, s_post>`
  triplet as the unit of exploration, and a model used only to invent text for input fields.
- VACP (arXiv:2603.29322): a capability graph, a state snapshot and an action catalog with stable
  ids, kept in step with the live application.
- CI4A (arXiv:2601.14790): a component as a semantic state view, an executable toolset and
  interaction metadata, at a granularity between DOM events and business logic.
- ToolCUA (arXiv:2605.12481): a repeated GUI procedure becomes one semantic tool at the right
  granularity, which is what a known route is.
