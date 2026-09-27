/**
 * What each kind of message looks like, in a visitor's own words.
 *
 * This is the specification of the classifier in `lib/agent/understand.ts`: four messages of each
 * class, none of them one of the examples the prompt itself carries, so the live suite measures
 * classification and not recall. The first one is the message that started the work: the agent
 * answered "Hello, can you hear me?" with an apology for a missing feature and an offer to report
 * it to the developers.
 */
import type { MessageIntent, PageContext } from "@lantern/shared";

export type IntentFixture = {
  message: string;
  intent: MessageIntent;
  /** Why it belongs to that class, in one line. */
  why: string;
};

export const INTENT_FIXTURES: IntentFixture[] = [
  {
    message: "Hello, can you hear me?",
    intent: "chat",
    why: "a greeting and a question about the assistant, not about the product",
  },
  { message: "Thanks, you have been really helpful.", intent: "chat", why: "thanks, nothing asked" },
  { message: "Are you a real person or a bot?", intent: "chat", why: "a question about the assistant" },
  { message: "Is JFK in Queens?", intent: "chat", why: "general knowledge, not about this product" },

  {
    message: "What is my confirmation code?",
    intent: "page",
    why: "the page in front of the visitor shows it",
  },
  { message: "When does my flight board?", intent: "page", why: "the trip on this page carries the time" },
  { message: "Who is sitting in 12A?", intent: "page", why: "the passenger list is on this page" },
  { message: "What does this page say my total is?", intent: "page", why: "names the page itself" },

  {
    message: "Where do I change my seat?",
    intent: "product",
    why: "where a control of the product is",
  },
  { message: "How do I add a checked bag to my booking?", intent: "product", why: "how to do something here" },
  { message: "Can I cancel this trip online?", intent: "product", why: "whether the product can do it" },
  {
    message: "Does NovaAir support seating a family together?",
    intent: "product",
    why: "whether the product has the capability",
  },

  {
    message: "What is a layover, and can I add one to this trip?",
    intent: "mixed",
    why: "general knowledge and a product capability in one message",
  },
  { message: "Is row 21 an exit row, and how do I move there?", intent: "mixed", why: "the page and the product" },
  {
    message: "What is the baggage allowance, and where do I pay for an extra bag?",
    intent: "mixed",
    why: "a rule and a control",
  },
  {
    message: "How early should I get to the airport, and can I check in here?",
    intent: "mixed",
    why: "travel advice and a product capability in one message",
  },
];

/**
 * The page the fixtures are asked on: NovaAir's Manage Trip, with the trip in its text.
 *
 * A `page` question is only a page question because the page answers it, so the classifier and
 * the live suite both need a page that really says these things.
 */
export const TRIP_PAGE: PageContext = {
  url: "http://localhost:4150/trips/NVA7K2",
  title: "Manage Trip | NovaAir",
  text: [
    "Manage Trip. Confirmation NVA7K2. NovaAir 412, San Francisco (SFO) to New York (JFK).",
    "Departs 22:40, boards 22:05 at gate D14, arrives 07:15.",
    "Passengers: Sam Altman, seat 12A. Elon Musk, age 9, seat 18C. Zuck, age 6, seat 24F.",
    "Fare total 1,284.00 USD. Checked bags: none.",
  ].join(" "),
  affordances: [
    { id: "a1", role: "link", name: "My Booking", landmark: "sidebar", href: "/my-booking", visible: true },
    { id: "a2", role: "tab", name: "Seats", landmark: "main", visible: true },
    { id: "a3", role: "tab", name: "Bags", landmark: "main", visible: true },
    { id: "a4", role: "link", name: "Change seats", landmark: "main", href: "/trips/NVA7K2/seats", visible: true },
  ],
};
