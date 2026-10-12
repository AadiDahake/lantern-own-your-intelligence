/**
 * The gate between the agent search and a visitor, offline.
 *
 * An offer is a link to a service that nobody at the company has tried. So the cases here are
 * mostly the ones where the gate must say no. Many of them are pairs that an independent review
 * found a looser rule to accept, and several are listings that the public index really returned.
 */
import { describe, expect, it } from "vitest";
import { gate, queryFor, sameName, shownName, shownService } from "@/lib/alternatives/gate";
import { searchAgents, type AgentListing } from "@/lib/darwin";
import { SEATS_ANSWER } from "./fixtures/agent-search";

const CAPABILITY = "finding seats together";

function listing(overrides: Partial<AgentListing> = {}): AgentListing {
  return {
    rank: 1,
    agentId: "agent1",
    capabilityId: "cap1",
    name: "Find seats together",
    provider: "SeatFinder",
    description: "Seats a party side by side on one flight.",
    verified: true,
    startable: true,
    paid: false,
    readiness: "ready",
    url: "https://index.darwin.so/agent/agent1?capability=cap1",
    ...overrides,
  };
}

/** The listings the client reads from the real answer, through the client itself. */
async function realListings(): Promise<AgentListing[]> {
  const fetchImpl = (async () => new Response(JSON.stringify(SEATS_ANSWER), { status: 200 })) as unknown as typeof fetch;
  const found = await searchAgents({ apiKey: null, apiUrl: "https://search.test" }, CAPABILITY, { fetchImpl });
  if (!found.ok) throw new Error(found.reason);
  return found.listings;
}

describe("queryFor", () => {
  it.each([
    ["finding seats together", "finding seats together"],
    ["  finding   seats\n together ", "finding seats together"],
    ["Finding seats together.", "Finding seats together"],
    ["sending an SMS", "sending an SMS"],
    ["exporting a report as CSV", "exporting a report as CSV"],
    ["checking in online", "checking in online"],
    ["finding non-stop flights", "finding non-stop flights"],
    ["dark mode", "dark mode"],
  ])('sends the whole name for "%s"', (feature, query) => {
    expect(queryFor(feature)).toBe(query);
  });

  it.each([
    ["a booking code", "changing the seat on booking NVA7K2"],
    ["a code of small letters and digits", "changing the seat on booking nva7k2"],
    ["a number", "booking seat 12"],
    ["a phone number", "texting +14155550123 the boarding pass"],
    ["an email", "sending the receipt to ana@example.com"],
    ["an email with words for its marks", "sending the receipt to ana(at)example.com"],
    ["a link", "importing a trip from https://trips.example/t/9f"],
    ["a www address", "importing a trip from www.trips.example"],
    ["an address with no scheme", "importing issues from acme.atlassian.net"],
    ["an address with a path", "importing from trips.example/t/abcdef"],
    ["the name of a person", "sending a gift card to John Smith"],
    ["a place", "delivering to Baker Street London"],
    ["a brand", "exporting to Excel"],
    ["a code of capital letters", "changing the seat on booking XKJHQP"],
    ["a code of small letters with no vowel", "changing the seat on booking xkjhqp"],
    ["a word of mixed case", "syncing with GitHub"],
    ["a first word that is a name", "John wants seats together"],
    ["a place that has the form of a verb", "booking a train to Reading"],
    ["letters of a wide form", `sending a card to ${[0xff4a, 0xff4f, 0xff48, 0xff4e].map((code) => String.fromCharCode(code)).join("")}`],
    ["a letter with an accent", `booking a caf${String.fromCharCode(0x00e9)} table`],
    ["a digit inside a word", "enabling 2FA login"],
    ["a digit of a different script", `booking seat ${String.fromCharCode(0xff17)}${String.fromCharCode(0x0661)}`],
    ["a character that cannot be seen inside a word", `finding sea${String.fromCharCode(0x200b)}ts together`],
    ["a control character", `finding${String.fromCharCode(0x0007)}seats together`],
  ])("sends nothing for a name with %s, because a name with a word taken out says a different thing", (_label, feature) => {
    expect(queryFor(feature)).toBeNull();
  });

  it.each([
    ["an empty name", ""],
    ["one word", "seats"],
    ["one word and an article", "the seats"],
    ["more than eight words", "finding three seats together for a family of five"],
    ["more than 120 characters", Array.from({ length: 8 }, () => "extraordinarily").join(" ")],
  ])("sends nothing for %s", (_label, feature) => {
    expect(queryFor(feature)).toBeNull();
  });

  it("cannot know a name that is written in small letters, which is a known limit", () => {
    expect(queryFor("sending a gift card to john smith")).toBe("sending a gift card to john smith");
  });
});

describe("sameName", () => {
  it.each([
    ["finding seats together", "Find seats together"],
    ["finding seats together", "FIND SEATS TOGETHER"],
    ["finding seats together", "find_seats_together"],
    ["finding seats together", "findSeatsTogether"],
    ["finding seats together", "Find the seats together"],
    ["setting a price alert", "set_price_alert"],
    ["sending an SMS", "Send SMS"],
    ["applying promo codes", "Apply promo code"],
    ["canceling a booking", "Cancel booking"],
    ["cancelling a booking", "Cancel booking"],
    ["stopping a payment", "Stop payments"],
    ["changing a seat", "Change seat"],
    ["checking in online", "Check in online"],
    ["dark mode", "Dark mode"],
  ])('takes "%s" and "%s" as one name', (capability, name) => {
    expect(sameName(capability, name)).toBe(true);
  });

  // Each pair shares most of its words. A rule that lets one word differ, drops small words or
  // joins synonyms accepts it.
  it.each([
    ["importing customer contacts", "Export customer contacts"],
    ["freezing a debit card", "Unfreeze debit card"],
    ["opening a support ticket", "Close support ticket"],
    ["hiding my email address", "Find email address"],
    ["paying with a credit card", "Pay without credit card"],
    ["paying with a credit card", "Generate test credit card numbers"],
    ["paying with a credit card", "Credit card fraud detection"],
    ["paying with a credit card", "Get travel credit card links"],
    ["finding seats together", "Never find seats together"],
    ["finding seats together", "Find best seats"],
    ["finding seats together", "Find songs a group can sing together"],
    ["finding seats together", "Seats together"],
    ["finding seats together", "Find seats together for free"],
    ["finding seats together on a flight", "Find seats together"],
    ["canceling a flight booking", "Book a flight"],
    ["stopping recurring payments", "Set up recurring billing"],
    ["revoking an API key", "Create API key"],
    ["removing a payment method", "Add payment method"],
    ["disabling location tracking", "Location tracking"],
    ["setting a price alert", "price_alert"],
    ["setting a price alert", "create_price_alert"],
    ["setting a price alert", "Price alert cancellation"],
    ["setting a price alert", "Cancelling price alert"],
    ["setting a price alert", "Delete price alert"],
    ["setting a price alert", "Turn off price alert"],
    ["turning on notifications", "Turn off notifications"],
    ["turning off notifications", "Turn on notifications"],
    ["downloading a flight invoice", "Plan flights"],
    // The product's synonym groups join these words. This rule joins none.
    ["downloading a flight invoice", "Download a flight plan"],
    ["changing my username", "Change my profile"],
    ["switching to dark mode", "Switch to light mode"],
    ["tracking planes live", "Live invoice tracking"],
    ["switching to dark mode", "Light switch control"],
    ["enabling SSO login", "SSO logout"],
    ["linking a bank account", "Bank name lookup"],
    ["changing account name", "Change profile picture"],
    ["changing account name", "Change profile name"],
    ["checking in online", "Check if a website is online"],
    ["signing in with Google", "Sign Google Docs"],
    ["signing in with Google", "Sign out with Google"],
    ["meeting room booking", "Hotel room booking"],
    ["parking spot reservation", "Restaurant spot reservation"],
    ["recurring invoice creation", "Invoice creation"],
    ["sending an SMS", "Send Verify SMS"],
    ["sending an SMS", "Send a message"],
    ["checking the weather forecast", "Weather forecast"],
    ["exporting data to CSV", "Export data from CSV"],
    ["converting a file to PDF", "Convert PDF to a file"],
  ])('does not take "%s" and "%s" as one name', (capability, name) => {
    expect(sameName(capability, name)).toBe(false);
  });

  it("never takes a name of one word", () => {
    expect(sameName("refunds", "Refunds")).toBe(false);
    expect(sameName("the refunds", "Refunds")).toBe(false);
  });

  it("does not take a letter of a different script for the letter it looks like", () => {
    const cyrillicI = String.fromCharCode(0x0456);
    expect(sameName(CAPABILITY, `F${cyrillicI}nd seats together`)).toBe(false);
  });

  it("takes no listing of the real answer", async () => {
    const listings = await realListings();
    expect(listings.filter((entry) => sameName(CAPABILITY, entry.name))).toEqual([]);
  });
});

describe("shownService", () => {
  it.each(["FlightSeatMap", "SIMcloud", "sms-verify", "mu", "MCPFax Public-Data Utility API", "AT&T", "Seat Sherpa", "Route 66 Travel"])(
    'can show "%s"',
    (provider) => {
      expect(shownService(provider)).toBe(true);
    },
  );

  it.each([
    ["nothing", ""],
    ["a link", "https://evil.example/pay"],
    ["an address", "Pay at evil.example"],
    ["a phone number", "Call 415 555 0100"],
    ["a sentence", "Call us now to confirm your booking today"],
    ["six short words", "One Two Three Four Five Six"],
    ["a very long name", "S".repeat(41)],
    ["one letter", "a"],
    ["digits only", "42"],
    ["a mark first", "-SeatFinder"],
    ["a filler that shows as nothing", String.fromCharCode(0x3164)],
    ["a blank pattern", String.fromCharCode(0x2800)],
    ["stacked marks", `Seat${String.fromCharCode(0x0301).repeat(40)}Finder`],
    ["a letter of a different script", `Fl${String.fromCharCode(0x0456)}ghtSeatMap`],
    ["a long dash", `ExMachina AI ${String.fromCharCode(0x2014)} rooms`],
    ["an emoji", `SeatFinder ${String.fromCodePoint(0x1f6eb)}`],
  ])("cannot show a service name that is %s", (_label, provider) => {
    expect(shownService(provider)).toBe(false);
  });

  it("cannot know that a service name copies the company's own, which is a known limit", () => {
    // The index's verification and the widget's words must keep the two apart.
    expect(shownService("NovaAir Official Support")).toBe(true);
  });
});

describe("shownName", () => {
  it.each(["Find seats together", "set_price_alert", "Send SMS", "Check-in (online)"])('can show "%s"', (name) => {
    expect(shownName(name)).toBe(true);
  });

  it.each([
    ["dots that read as an address", "Find.seats.together"],
    ["a link", "Find seats together at https://evil.example/pay"],
    ["a path with two slashes", "Find seats together //evil/pay"],
    ["a phone number", "Find seats together, call 415 555 0100"],
    ["a filler that shows as nothing", `Find${String.fromCharCode(0x3164)}seats together`],
    ["stacked marks", `Find seats${String.fromCharCode(0x0301).repeat(40)} together`],
  ])("cannot show a name with %s", (_label, name) => {
    expect(shownName(name)).toBe(false);
  });
});

describe("gate", () => {
  it("offers a listing that is named for the capability, can start now, is free and is verified", () => {
    const result = gate([listing()], CAPABILITY);
    expect(result.offered).toEqual([
      { name: "Find seats together", provider: "SeatFinder", url: "https://index.darwin.so/agent/agent1?capability=cap1" },
    ]);
    expect(result.counts).toEqual({ found: 1, named: 1, startable: 1 });
    expect(result.near).toEqual([]);
  });

  it("offers two names and a link, and never a sentence of the listing", () => {
    const result = gate([listing({ description: "Seats a party. Pay at https://evil.example/pay or call 415 555 0100." })], CAPABILITY);
    expect(Object.keys(result.offered[0] ?? {})).toEqual(["name", "provider", "url"]);
    expect(JSON.stringify(result)).not.toContain("evil");
    expect(JSON.stringify(result)).not.toContain("415");
  });

  it("offers nothing from the real answer, and says how many listings it read", async () => {
    const result = gate(await realListings(), CAPABILITY);
    expect(result).toEqual({ offered: [], counts: { found: 7, named: 0, startable: 0 }, near: [] });
  });

  it.each([
    ["cannot start", { startable: false, readiness: "unavailable" }, "unavailable", 0],
    ["needs a sign-in first", { startable: false, readiness: "authentication_required" }, "authentication_required", 0],
    ["is ready by its word and cannot start a thread", { startable: false, readiness: "ready" }, "cannot start now", 0],
    ["needs a payment", { paid: true }, "needs a payment", 1],
    ["is not verified", { verified: false }, "not verified", 1],
  ] as [string, Partial<AgentListing>, string, number][])(
    "does not offer a listing that %s, and names it for the team",
    (_label, overrides, why, startable) => {
      const result = gate([listing(overrides)], CAPABILITY);
      expect(result.offered).toEqual([]);
      // "Can start" is the index's own word. The other rules do not change that count.
      expect(result.counts).toEqual({ found: 1, named: 1, startable });
      expect(result.near).toEqual([{ name: "Find seats together", provider: "SeatFinder", why }]);
    },
  );

  it.each([
    ["has no service name", ""],
    ["has a link for a service name", "https://evil.example/pay"],
    ["has a phone number for a service name", "Call 415 555 0100"],
  ])("does not offer a listing that %s, and does not repeat that text in the trace", (_label, provider) => {
    const result = gate([listing({ provider })], CAPABILITY);
    expect(result.offered).toEqual([]);
    expect(result.near).toEqual([{ name: "Find seats together", provider: "", why: "no service name that can be shown" }]);
  });

  it("does not offer a listing whose name cannot be shown, and does not repeat the name in the trace", () => {
    const result = gate([listing({ name: "Find.seats.together" })], CAPABILITY);
    expect(result.offered).toEqual([]);
    expect(result.near).toEqual([{ name: "", provider: "SeatFinder", why: "a name that cannot be shown" }]);
  });

  it("gives the first reason when a listing fails more than one rule", () => {
    const why = (overrides: Partial<AgentListing>) => gate([listing(overrides)], CAPABILITY).near[0]?.why;
    expect(why({ startable: false, readiness: "unavailable", paid: true, verified: false, provider: "" })).toBe("unavailable");
    expect(why({ paid: true, verified: false, provider: "" })).toBe("needs a payment");
    expect(why({ verified: false, provider: "" })).toBe("not verified");
    expect(why({ provider: "", name: "Find.seats.together" })).toBe("no service name that can be shown");
  });

  it("does not offer a listing that can start and is named for something else", () => {
    const result = gate([listing({ name: "Find best seats" })], CAPABILITY);
    expect(result).toEqual({ offered: [], counts: { found: 1, named: 0, startable: 0 }, near: [] });
  });

  it("offers one listing for one service, also when the index lists the service under two ids", () => {
    const twice = gate([listing({ capabilityId: "cap1" }), listing({ capabilityId: "cap2", name: "find_seats_together" })], CAPABILITY);
    expect(twice.offered.map((offer) => offer.name)).toEqual(["Find seats together"]);
    expect(twice.counts).toEqual({ found: 2, named: 2, startable: 2 });

    const twoIds = gate([listing({ agentId: "a" }), listing({ agentId: "b", provider: "SEATFINDER" })], CAPABILITY);
    expect(twoIds.offered).toHaveLength(1);
  });

  it("offers at most two services, in the order of the index", () => {
    const result = gate(
      ["a", "b", "c"].map((id, index) => listing({ agentId: id, provider: `Service ${id}`, rank: index + 1 })),
      CAPABILITY,
    );
    expect(result.offered.map((offer) => offer.provider)).toEqual(["Service a", "Service b"]);
    expect(result.counts.startable).toBe(3);
  });

  it("goes past a listing that cannot start to one that can", () => {
    const result = gate(
      [
        listing({ agentId: "a", provider: "First", startable: false, readiness: "unavailable" }),
        listing({ agentId: "b", provider: "Second" }),
      ],
      CAPABILITY,
    );
    expect(result.offered.map((offer) => offer.provider)).toEqual(["Second"]);
    expect(result.near).toEqual([{ name: "Find seats together", provider: "First", why: "unavailable" }]);
    expect(result.counts).toEqual({ found: 2, named: 2, startable: 1 });
  });

  it("names at most three listings that it did not offer", () => {
    const blocked = ["a", "b", "c", "d", "e"].map((id) => listing({ agentId: id, startable: false, readiness: "unavailable" }));
    expect(gate(blocked, CAPABILITY).near).toHaveLength(3);
  });

  it("offers nothing for an empty answer", () => {
    expect(gate([], CAPABILITY)).toEqual({ offered: [], counts: { found: 0, named: 0, startable: 0 }, near: [] });
  });
});
