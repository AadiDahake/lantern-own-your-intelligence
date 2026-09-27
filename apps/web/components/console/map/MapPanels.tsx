"use client";

import { useMemo, useState } from "react";
import { formatRelativeTime } from "@/lib/console/format";
import type { KnownRoute, StoredControl, StoredGraph } from "@/lib/graph/store";

/** How many controls a page shows before the rest fold behind a button. */
const CONTROLS_SHOWN = 8;

const SOURCE_TONE: Record<string, string> = {
  explorer: "is-good",
  widget: "is-run",
};

function SourceBadge({ source }: { source: string }) {
  return <span className={`outcome-badge ${SOURCE_TONE[source] ?? "is-muted"}`}>{source}</span>;
}

function Seen({ at }: { at: string }) {
  return (
    <span className="source-row__time" suppressHydrationWarning>
      {at ? formatRelativeTime(at) : ""}
    </span>
  );
}

/** A control, as a person would name it: its name, then where it sits and where it goes. */
function ControlLine({ control }: { control: StoredControl }) {
  return (
    <span className="record-card__meta">
      <span className="outcome-badge is-muted">{control.role}</span>
      <span>{control.name}</span>
      {control.landmark ? <span className="field-hint m-0">in {control.landmark}</span> : null}
      {control.href ? <span className="mono field-hint m-0">{control.href}</span> : null}
    </span>
  );
}

export function PagesPanel({ graph }: { graph: StoredGraph }) {
  const controlsByRoute = useMemo(() => countBy(graph.controls, (control) => control.route), [graph]);
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Pages</h2>
        <span className="count-pill">{graph.pages.length}</span>
      </div>
      <ul className="record-list">
        {graph.pages.map((page) => (
          <li key={page.route}>
            <article className="source-row">
              <div className="source-row__top">
                <p className="source-row__title mono">{page.route}</p>
                <SourceBadge source={page.source} />
                <Seen at={page.lastSeen} />
              </div>
              <div className="source-row__meta">
                <span>{page.title || "Untitled"}</span>
                <span>{count(controlsByRoute.get(page.route) ?? 0, "control")}</span>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ControlsPanel({ graph }: { graph: StoredGraph }) {
  const groups = useMemo(() => groupBy(graph.controls, (control) => control.route), [graph]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const toggle = (route: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(route)) next.delete(route);
      else next.add(route);
      return next;
    });
  };

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Controls</h2>
        <span className="count-pill">{graph.controls.length}</span>
      </div>
      <ul className="record-list">
        {[...groups.entries()].map(([route, controls]) => {
          const expanded = open.has(route);
          const shown = expanded ? controls : controls.slice(0, CONTROLS_SHOWN);
          const hidden = controls.length - shown.length;
          return (
            <li key={route}>
              <article className="source-row">
                <div className="source-row__top">
                  <p className="source-row__title mono">{route}</p>
                  <span className="count-pill">{controls.length}</span>
                </div>
                <ul className="record-list">
                  {shown.map((control) => (
                    <li key={control.id || control.key} className="record-card__line">
                      <ControlLine control={control} />
                      <Seen at={control.lastSeen} />
                    </li>
                  ))}
                </ul>
                {hidden > 0 || expanded ? (
                  <div className="source-row__actions">
                    <button type="button" className="row-action" onClick={() => toggle(route)}>
                      {expanded ? "Show fewer" : `Show ${hidden} more`}
                    </button>
                  </div>
                ) : null}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function TransitionsPanel({ graph }: { graph: StoredGraph }) {
  const nameOf = useMemo(() => nameIndex(graph), [graph]);
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Transitions</h2>
        <span className="count-pill">{graph.transitions.length}</span>
      </div>
      {graph.transitions.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">No moves recorded yet</p>
          <p className="empty-state__text">
            A transition appears when the explorer presses a control, or a visitor does with the
            widget on the page.
          </p>
        </div>
      ) : (
        <ul className="record-list">
          {graph.transitions.map((transition, index) => {
            const control = nameOf(transition.from, transition.key);
            const revealed = transition.reveals ? nameOf(transition.to, transition.reveals) : null;
            return (
              <li key={`${transition.from}|${transition.key}|${transition.to}|${transition.reveals ?? ""}|${index}`}>
                <article className="source-row">
                  <div className="source-row__top">
                    <p className="source-row__title">
                      <span className="mono">{transition.from}</span>
                      {" -> "}
                      {control}
                      {" -> "}
                      {transition.kind === "reveal" ? (
                        <>reveals {revealed ?? transition.reveals}</>
                      ) : (
                        <span className="mono">{transition.to}</span>
                      )}
                    </p>
                    <SourceBadge source={transition.source} />
                    <Seen at={transition.lastSeen} />
                  </div>
                  <div className="source-row__meta">
                    <span>{transition.kind}</span>
                    <span>seen {count(transition.seenCount, "time")}</span>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function KnownRoutesPanel({ graph, routes }: { graph: StoredGraph; routes: KnownRoute[] }) {
  const titles = useMemo(() => new Map(graph.pages.map((page) => [page.route, page.title])), [graph]);
  const nameOf = useMemo(() => nameIndex(graph), [graph]);
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Known routes</h2>
        {routes.length > 0 ? <span className="count-pill">{routes.length}</span> : null}
      </div>
      {routes.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">No known routes yet</p>
          <p className="empty-state__text">
            A route is remembered the first time a question resolves to a control. The same
            question then answers from the map with no model call.
          </p>
        </div>
      ) : (
        <ul className="record-list">
          {routes.map((route) => (
            <li key={route.id}>
              <article className="source-row">
                <div className="source-row__top">
                  <p className="source-row__title">{route.question}</p>
                  <span className="outcome-badge is-muted">{route.feature}</span>
                  <span className="source-row__time">
                    used {count(route.hitCount, "time")}
                  </span>
                </div>
                <p className="record-card__line">
                  <span className="record-card__label">Target</span>
                  {nameOf(route.target.route, route.target.key)} on{" "}
                  {titles.get(route.target.route) || route.target.route}
                </p>
                <p className="record-card__line">
                  <span className="record-card__label">Answer</span>
                  {route.answer}
                </p>
                {route.sources.length > 0 ? (
                  <p className="record-card__line">
                    <span className="record-card__label">Cites</span>
                    {route.sources.map((source) => source.title).join(", ")}
                  </p>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Looks a control's name up by page and key, falling back to the key when it is gone. */
function nameIndex(graph: StoredGraph): (route: string, key: string) => string {
  const index = new Map<string, string>();
  for (const control of graph.controls) index.set(`${control.route}\n${control.key}`, control.name);
  return (route, key) => index.get(`${route}\n${key}`) ?? key;
}

function countBy<T>(items: T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
  return counts;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}
