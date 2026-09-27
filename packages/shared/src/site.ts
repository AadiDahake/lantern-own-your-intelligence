/**
 * The site graph: what Lantern knows about the host product beyond the page in front of the
 * user. Pages are routes, controls are identified by what a person sees (role, accessible name,
 * landmark, link target) and never by a selector, and transitions record which control on which
 * page led to which page. The explorer and the widget's live scans both feed it; the planner
 * reads it.
 */
import type { Affordance } from "./types";

/** A control's stable identity. Every field is something the user can see or the link points at. */
export type ControlRef = {
  role: string;
  name: string;
  landmark?: string;
  /** For links: the route the link points at, already normalised by `routeOf`. */
  href?: string;
};

export type SitePage = {
  route: string;
  /** One concrete address the route was seen at. */
  url: string;
  title: string;
};

export type SiteControl = ControlRef & {
  key: string;
  route: string;
  /** Whether the control was on screen when the page was first read, before any click. */
  visible: boolean;
};

export type SiteTransition = {
  /** Route of the page the control was pressed on. */
  from: string;
  /** Key of the control that was pressed. */
  key: string;
  /** Route of the page the press led to. Equal to `from` for a reveal. */
  to: string;
  kind: "navigation" | "reveal";
  /** For a reveal: the key of the control that became visible on the same page. */
  reveals?: string;
};

export type SiteGraph = {
  pages: SitePage[];
  controls: SiteControl[];
  transitions: SiteTransition[];
};

/** A path segment that is an identifier rather than a name: it carries a digit, or it is long. */
function isDynamicSegment(segment: string): boolean {
  if (segment.length >= 24) return true;
  return /\d/.test(segment);
}

/**
 * The route of an address: its path with identifiers replaced by `:id`, so `/trips/NVA7K2/seats`
 * and `/trips/QX91LM/seats` are the same page of the product.
 */
export function routeOf(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url, "http://site.invalid").pathname;
  } catch {
    pathname = url.split(/[?#]/)[0] ?? "/";
  }
  const segments = pathname
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => (isDynamicSegment(decodeURIComponent(segment)) ? ":id" : segment));
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/**
 * Where a link goes, as a route: a same-site path, or origin plus route for another site. Links
 * that are not navigation (mail, phone, script, fragment) have no target.
 */
export function hrefRoute(href: string | undefined, pageUrl?: string): string | undefined {
  if (!href) return undefined;
  const raw = href.trim();
  if (raw === "" || /^(mailto:|tel:|javascript:|data:|#)/i.test(raw)) return undefined;
  try {
    const base = pageUrl ? new URL(pageUrl) : null;
    const url = new URL(raw, base ?? "http://site.invalid");
    const route = routeOf(url.toString());
    if (!base || url.origin === base.origin || url.origin === "http://site.invalid") return route;
    return `${url.origin}${route}`;
  } catch {
    return undefined;
  }
}

function normalName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The key a control is known by across scans and across pages: role, name, landmark and link
 * target. Two scans of the same page, or the explorer and the widget, agree on it because they
 * read the same things off the same DOM.
 */
export function controlKey(ref: ControlRef): string {
  return [ref.role.toLowerCase(), normalName(ref.name), ref.landmark ?? "", ref.href ?? ""].join("|");
}

/** The identity of a scanned affordance, with its link target normalised against the page. */
export function controlRefOf(affordance: Affordance, pageUrl?: string): ControlRef {
  const ref: ControlRef = { role: affordance.role, name: affordance.name };
  if (affordance.landmark) ref.landmark = affordance.landmark;
  const href = hrefRoute(affordance.href, pageUrl);
  if (href) ref.href = href;
  return ref;
}

/** Whether two identities name the same control. A missing landmark on either side still matches. */
export function sameControl(a: ControlRef, b: ControlRef): boolean {
  if (a.role.toLowerCase() !== b.role.toLowerCase()) return false;
  if (normalName(a.name) !== normalName(b.name)) return false;
  if (a.href && b.href && a.href !== b.href) return false;
  if (a.landmark && b.landmark && a.landmark !== b.landmark) return false;
  return true;
}

const MAX_CAPTION_NAME_WORDS = 8;

function shortName(name: string): string {
  const words = name.replace(/\s+/g, " ").trim().split(" ");
  return words.length <= MAX_CAPTION_NAME_WORDS
    ? words.join(" ")
    : `${words.slice(0, MAX_CAPTION_NAME_WORDS).join(" ")}...`;
}

/**
 * The instruction for one control, from its role and name alone. It is always exact, because it
 * names the control the user is looking at, and it costs nothing, so it is what a route shows
 * when the model has not written a better one.
 */
export function captionFor(ref: ControlRef): string {
  const name = shortName(ref.name) || "this control";
  switch (ref.role.toLowerCase()) {
    case "link":
      return `Open ${name}`;
    case "tab":
      return `Select the ${name} tab`;
    case "menuitem":
    case "menuitemcheckbox":
    case "option":
      return `Choose ${name}`;
    case "textbox":
    case "searchbox":
    case "spinbutton":
      return `Type in ${name}`;
    case "combobox":
      return `Choose from ${name}`;
    case "checkbox":
    case "switch":
    case "radio":
      return `Turn on ${name}`;
    case "button":
      return ref.landmark === "form" ? `Fill in the form, then select ${name}` : `Select ${name}`;
    default:
      return `Select ${name}`;
  }
}

/** How the widget knows a step is done, from what the control does. */
export function advanceOnFor(ref: ControlRef, navigates: boolean): "click" | "input" | "navigation" {
  const role = ref.role.toLowerCase();
  if (role === "textbox" || role === "searchbox" || role === "spinbutton" || role === "combobox") {
    return "input";
  }
  return navigates ? "navigation" : "click";
}
