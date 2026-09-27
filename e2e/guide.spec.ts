import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * "Where do I change my seat?" from the NovaAir home page.
 *
 * The widget announces three steps, every spotlight lands on the control it names, the count
 * never changes while the user walks the route, and the walk ends on the seat map. The time from
 * pressing Enter to the first spotlight is recorded so the numbers in the pull request come from
 * this run and not from a guess.
 */

const QUESTION = "Where do I change my seat?";
const ROUTE = [
  { name: "My Booking", role: "link" as const, page: "/" },
  { name: "Find my booking", role: "button" as const, page: "/my-booking" },
  { name: "Change seats", role: "link" as const, page: "/trips/NVA7K2" },
];

type Rect = { x: number; y: number; width: number; height: number };

/** The ring the spotlight draws, as the user sees it. */
async function ringRect(page: Page): Promise<Rect | null> {
  return page.evaluate(() => {
    const host = document.querySelector("lantern-widget");
    const root = host?.shadowRoot;
    const spot = root?.querySelector(".pl-spot");
    if (!spot || !(spot.matches(":popover-open") || spot.classList.contains("pl-spot--fallback"))) return null;
    const ring = root!.querySelector(".pl-spot__ring");
    if (!ring) return null;
    return {
      x: Number(ring.getAttribute("x")),
      y: Number(ring.getAttribute("y")),
      width: Number(ring.getAttribute("width")),
      height: Number(ring.getAttribute("height")),
    };
  });
}

async function counter(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector("lantern-widget")?.shadowRoot?.querySelector(".pl-spot__counter")?.textContent ?? "",
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Waits until the spotlight is drawn and returns its ring. */
async function waitForSpotlight(page: Page, timeout = 15_000): Promise<Rect> {
  await expect
    .poll(async () => ((await ringRect(page))?.width ?? 0) > 0, { timeout, message: "the spotlight never appeared" })
    .toBe(true);
  return (await ringRect(page)) as Rect;
}

/** The spotlit control on the current page, by the name and role the route expects. */
function control(page: Page, step: (typeof ROUTE)[number]): Locator {
  // NovaAir has "My Booking" twice on the home page; the spotlit one is whichever the ring covers.
  return page.getByRole(step.role, { name: step.name, exact: true });
}

async function spotlitControl(page: Page, step: (typeof ROUTE)[number], ring: Rect): Promise<Locator> {
  const candidates = control(page, step);
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const box = await candidates.nth(index).boundingBox();
    if (box && overlaps(ring, box)) return candidates.nth(index);
  }
  throw new Error(`no ${step.role} "${step.name}" under the ring ${JSON.stringify(ring)}`);
}

test.beforeAll(async ({ request }) => {
  // In mock mode NovaAir runs in development mode and compiles each route on first use, which can
  // take longer than a step's wait. One request to the booking lookup warms it before the walk.
  if (!process.env.NOVAAIR_BASE_URL) {
    await request.post("/api/reservations/lookup", { data: { code: "NVA7K2", lastName: "Dahake" } }).catch(() => undefined);
    await request.get("/trips/NVA7K2").catch(() => undefined);
    await request.get("/trips/NVA7K2/seats").catch(() => undefined);
  }
});

test("the widget walks a customer from Home to the seat map in three announced steps", async ({ page }) => {
  const stepsSeen: string[] = [];
  await page.goto("/");
  await page.getByRole("button", { name: "Open support" }).click();
  const composer = page.getByRole("textbox").last();
  await composer.fill(QUESTION);

  const asked = Date.now();
  await composer.press("Enter");

  const firstRing = await waitForSpotlight(page);
  const timeToFirstSpotlight = Date.now() - asked;

  // The count is announced once, on the first step, and it is the whole route.
  await expect.poll(() => counter(page)).toBe(`Step 1 of ${ROUTE.length}`);
  stepsSeen.push(await counter(page));

  let ring = firstRing;
  for (const [index, step] of ROUTE.entries()) {
    await expect(page).toHaveURL(new RegExp(`${step.page.replace(/\//g, "\\/")}$`));
    const target = await spotlitControl(page, step, ring);
    const box = (await target.boundingBox()) as Rect;
    expect(overlaps(ring, box), `step ${index + 1} ring ${JSON.stringify(ring)} vs ${step.name} ${JSON.stringify(box)}`).toBe(true);
    expect(await counter(page)).toBe(`Step ${index + 1} of ${ROUTE.length}`);

    if (step.name === "Find my booking") {
      await page.getByLabel("Confirmation code").fill("NVA7K2");
      await page.getByLabel("Last name").fill("Dahake");
    }
    await target.click();

    if (index < ROUTE.length - 1) {
      const next = ROUTE[index + 1]!;
      await expect(page).toHaveURL(new RegExp(`${next.page.replace(/\//g, "\\/")}$`), { timeout: 20_000 });
      ring = await waitForSpotlight(page, 20_000);
      stepsSeen.push(await counter(page));
    }
  }

  // The seat map is open, and the walk is over.
  await expect(page.getByRole("heading", { name: "Choose Seats", level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await ringRect(page)) === null, { timeout: 10_000 }).toBe(true);

  // The panel comes back with the answer, and the card says the same number the walk had.
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.querySelector("lantern-widget")?.shadowRoot?.querySelector(".pl-card__label")?.textContent ?? "",
        ),
      { timeout: 10_000 },
    )
    .toBe(`${ROUTE.length} steps`);

  expect(stepsSeen).toEqual(ROUTE.map((_, index) => `Step ${index + 1} of ${ROUTE.length}`));
  console.log(`time to first spotlight: ${timeToFirstSpotlight} ms`);
  test.info().annotations.push({ type: "time-to-first-spotlight-ms", description: String(timeToFirstSpotlight) });
});

test("a question asked before answers from the product map without a model", async ({ page }) => {
  // The first test taught the project this intent. The same question from the trip page should
  // spotlight at once; the budget below is the one the design commits to for a known route.
  await page.goto("/trips/NVA7K2");
  await page.getByRole("button", { name: "Open support" }).click();
  const composer = page.getByRole("textbox").last();
  await composer.fill(QUESTION);
  const asked = Date.now();
  await composer.press("Enter");
  const ring = await waitForSpotlight(page);
  const elapsed = Date.now() - asked;
  const target = await spotlitControl(page, ROUTE[2]!, ring);
  await expect(target).toBeVisible();
  expect(await counter(page)).toBe("Step 1 of 1");
  console.log(`time to first spotlight (known route): ${elapsed} ms`);
  test.info().annotations.push({ type: "time-to-first-spotlight-known-ms", description: String(elapsed) });
  if (process.env.NOVAAIR_BASE_URL) expect(elapsed).toBeLessThan(1500);
});

test("a greeting is answered without checks, and nothing is offered to report", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open support" }).click();
  const composer = page.getByRole("textbox").last();
  await composer.fill("Hello, can you hear me?");
  await composer.press("Enter");

  // Locators pierce the widget's shadow root, so the card is addressed from the page.
  await expect(page.getByRole("button", { name: "Copy" })).toBeVisible({ timeout: 30_000 });
  // No walk, and no button that turns a greeting into a feature request.
  await expect(page.getByRole("button", { name: "Report to developers" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show me" })).toHaveCount(0);
  const answer = await page.evaluate(
    () => document.querySelector("lantern-widget")?.shadowRoot?.querySelector(".pl-card p")?.textContent ?? "",
  );
  expect(answer).not.toMatch(/I am sorry|report this to the developers/i);
});
