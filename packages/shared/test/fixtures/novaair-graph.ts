/**
 * NovaAir as the explorer records it: the pages on the seat-change route, the controls that
 * matter on each, the seat buttons and the help articles that share their words, and the
 * transitions between them. The "Seats" tab is a reveal: it does not
 * navigate, it shows the panel that holds "Change seats". Used by the planner tests and by the
 * widget's development API, so both plan over the same product.
 */
import { controlKey, type SiteControl, type SiteGraph, type SitePage, type SiteTransition } from "../../src/site";

const HOME = "/";
const MY_BOOKING = "/my-booking";
const TRIP = "/trips/:id";
const SEATS = "/trips/:id/seats";
const HELP = "/help";
const HELP_ARTICLE = "/help/how-do-i-change-my-seat";

const pages: SitePage[] = [
  { route: HOME, url: "http://localhost:4150/", title: "NovaAir" },
  { route: MY_BOOKING, url: "http://localhost:4150/my-booking", title: "My Booking | NovaAir" },
  { route: TRIP, url: "http://localhost:4150/trips/NVA7K2", title: "Manage Trip | NovaAir" },
  { route: SEATS, url: "http://localhost:4150/trips/NVA7K2/seats", title: "Choose Seats | NovaAir" },
  { route: HELP, url: "http://localhost:4150/help", title: "Help center | NovaAir" },
  { route: HELP_ARTICLE, url: "http://localhost:4150/help/how-do-i-change-my-seat", title: "How do I change my seat? | NovaAir" },
];

type Draft = Omit<SiteControl, "key">;

function control(draft: Draft): SiteControl {
  return { ...draft, key: controlKey(draft) };
}

const nav = (route: string): SiteControl[] => [
  control({ route, role: "link", name: "NovaAir home", landmark: "sidebar", href: HOME, visible: true }),
  control({ route, role: "link", name: "Flights", landmark: "sidebar", href: "/flights", visible: true }),
  control({ route, role: "link", name: "My Booking", landmark: "sidebar", href: MY_BOOKING, visible: true }),
];

export const CONTROLS = {
  homeMyBooking: control({ route: HOME, role: "link", name: "My Booking", landmark: "main", href: MY_BOOKING, visible: true }),
  homeFindFlight: control({ route: HOME, role: "link", name: "Find a flight", landmark: "main", href: "/flights", visible: true }),
  code: control({ route: MY_BOOKING, role: "textbox", name: "Confirmation code", landmark: "form", visible: true }),
  lastName: control({ route: MY_BOOKING, role: "textbox", name: "Last name", landmark: "form", visible: true }),
  findBooking: control({ route: MY_BOOKING, role: "button", name: "Find my booking", landmark: "form", visible: true }),
  breadcrumbTrip: control({ route: TRIP, role: "link", name: "Manage Trip", landmark: "sidebar", href: TRIP, visible: true }),
  seatsTab: control({ route: TRIP, role: "tab", name: "Seats", landmark: "main", visible: true }),
  bagsTab: control({ route: TRIP, role: "tab", name: "Bags", landmark: "main", visible: true }),
  checkinTab: control({ route: TRIP, role: "tab", name: "Check-in", landmark: "main", visible: true }),
  changeSeats: control({ route: TRIP, role: "link", name: "Change seats", landmark: "main", href: SEATS, visible: true }),
  baggageRules: control({ route: TRIP, role: "link", name: "Read the baggage rules", landmark: "main", href: "/help/baggage-allowance", visible: false }),
  helpChangeSeat: control({ route: TRIP, role: "link", name: "How do I change my seat?", landmark: "main", href: HELP_ARTICLE, visible: true }),
  seatBreadcrumb: control({ route: SEATS, role: "link", name: "Manage Trip", landmark: "sidebar", href: TRIP, visible: true }),
  confirmSeats: control({ route: SEATS, role: "button", name: "Confirm seats", landmark: "main", visible: true }),
  seat21A: control({ route: SEATS, role: "button", name: "Seat 21A, available, no extra cost", landmark: "main", visible: true }),
  // The seat map is a wall of these. A question about seats matches every one of them on one
  // word, which is what a capability question has to be kept away from.
  seat1C: control({ route: SEATS, role: "button", name: "Seat 1C, available, 45 dollars", landmark: "main", visible: true }),
  seat1D: control({ route: SEATS, role: "button", name: "Seat 1D, available, 45 dollars", landmark: "main", visible: true }),
  seat1E: control({ route: SEATS, role: "button", name: "Seat 1E, available, 45 dollars", landmark: "main", visible: true }),
  // A navigation link on a help article. Its own name says "flight"; the page it sits on is
  // titled "How do I change my seat?", which is where a page-title match comes from.
  articleFindFlight: control({ route: HELP_ARTICLE, role: "link", name: "Find a flight", landmark: "sidebar", href: "/flights", visible: true }),
  helpArticle: control({ route: HELP, role: "link", name: "How do I change my seat?", landmark: "main", href: HELP_ARTICLE, visible: true }),
};

const transitions: SiteTransition[] = [
  { from: HOME, key: CONTROLS.homeMyBooking.key, to: MY_BOOKING, kind: "navigation" },
  { from: HOME, key: nav(HOME)[2]!.key, to: MY_BOOKING, kind: "navigation" },
  { from: MY_BOOKING, key: CONTROLS.findBooking.key, to: TRIP, kind: "navigation" },
  { from: TRIP, key: CONTROLS.seatsTab.key, to: TRIP, kind: "reveal", reveals: CONTROLS.changeSeats.key },
  { from: TRIP, key: CONTROLS.bagsTab.key, to: TRIP, kind: "reveal", reveals: CONTROLS.baggageRules.key },
  { from: TRIP, key: CONTROLS.changeSeats.key, to: SEATS, kind: "navigation" },
  { from: TRIP, key: CONTROLS.helpChangeSeat.key, to: HELP_ARTICLE, kind: "navigation" },
  { from: SEATS, key: CONTROLS.seatBreadcrumb.key, to: TRIP, kind: "navigation" },
  { from: HELP, key: CONTROLS.helpArticle.key, to: HELP_ARTICLE, kind: "navigation" },
  ...[HOME, MY_BOOKING, TRIP, SEATS, HELP, HELP_ARTICLE].flatMap((route): SiteTransition[] => [
    { from: route, key: nav(route)[0]!.key, to: HOME, kind: "navigation" },
    { from: route, key: nav(route)[2]!.key, to: MY_BOOKING, kind: "navigation" },
  ]),
];

export const NOVAAIR_GRAPH: SiteGraph = {
  pages,
  controls: [
    ...[HOME, MY_BOOKING, TRIP, SEATS, HELP, HELP_ARTICLE].flatMap(nav),
    ...Object.values(CONTROLS),
  ],
  transitions,
};

export const ROUTES = { HOME, MY_BOOKING, TRIP, SEATS, HELP, HELP_ARTICLE };

/** The control the capability adds to the seat map once it is built. */
export const SEATS_TOGETHER = control({
  route: SEATS,
  role: "button",
  name: "Find seats together",
  landmark: "main",
  visible: true,
});

/**
 * The same product after the change ships: one new button on the seat map, and nothing else
 * different. The pair of graphs is what the absence answer and the answer that replaces it are
 * measured against.
 */
export const NOVAAIR_GRAPH_AFTER: SiteGraph = {
  ...NOVAAIR_GRAPH,
  controls: [...NOVAAIR_GRAPH.controls, SEATS_TOGETHER],
};
