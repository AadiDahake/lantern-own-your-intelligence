import Link from "next/link";
import type { TraceEvent } from "@lantern/shared";
import { formatClock } from "@/lib/console/format";
import { ApprovalCard } from "./ApprovalCard";

type Detail = Record<string, unknown>;

function asDetail(value: unknown): Detail {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Detail) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * One row of the live trace, rendered by its `kind` and, for artefacts, by which artefact it is.
 * Anything without a shape of its own falls back to a key and value list, so a new event kind from
 * the worker still shows up rather than disappearing.
 */
export function TraceRow({
  event,
  escalationId,
  onDecision,
}: {
  event: TraceEvent;
  escalationId: string | null;
  onDecision: () => void;
}) {
  const detail = asDetail(event.detail);
  const artifact = str(detail.artifact);
  const tone =
    event.status === "failed"
      ? "is-failed"
      : event.status === "running"
        ? "is-running"
        : event.kind === "pause"
          ? "is-pause"
          : event.kind === "artifact"
            ? "is-artifact"
            : "";
  // The sandbox lane reads apart from the chat lane, so the two stories stay distinct.
  const lane = event.source === "forge" ? "is-forge" : "";

  return (
    <article className={`trace-row ${tone} ${lane}`.trim()}>
      <div className="trace-row__head">
        <span className="trace-row__kind">{artifact ?? event.kind}</span>
        <h3 className="trace-row__title">{event.title}</h3>
        <span className="trace-row__time">{formatClock(event.createdAt)}</span>
      </div>
      <Body
        kind={event.kind}
        artifact={artifact}
        detail={detail}
        escalationId={escalationId}
        onDecision={onDecision}
      />
    </article>
  );
}

function Body({
  kind,
  artifact,
  detail,
  escalationId,
  onDecision,
}: {
  kind: TraceEvent["kind"];
  artifact: string | null;
  detail: Detail;
  escalationId: string | null;
  onDecision: () => void;
}) {
  if (kind === "probe") return <ProbeBody detail={detail} />;
  if (kind === "verdict") return <VerdictBody detail={detail} />;
  if (kind === "model") return <ModelBody detail={detail} />;
  if (kind === "capability") return <CapabilityBody detail={detail} />;
  if (kind === "candidate") return <CandidateBody detail={detail} />;
  if (kind === "preview") return <PreviewBody detail={detail} />;
  if (kind === "tool") return <KeyValues detail={detail} keys={["tool", "transport", "args_summary", "result_summary"]} />;
  if (kind === "pause") {
    return (
      <ApprovalCard
        label={str(detail.label) ?? "Merge this pull request?"}
        escalationId={escalationId}
        onDecision={onDecision}
      />
    );
  }
  if (kind === "artifact") {
    if (artifact === "issue_draft") return <DraftBody detail={detail} />;
    if (artifact === "issue") return <LinkBody detail={detail} label="Open issue" />;
    if (artifact === "pr") return <LinkBody detail={detail} label="Open pull request" showBranch />;
    if (artifact === "diff") return <DiffBody detail={detail} />;
    if (artifact === "deployment") return <LinkBody detail={detail} label="Open the deployment" />;
    if (artifact === "capability_spec") return <SpecBody detail={detail} />;
    if (artifact === "file_change") return <FilesBody detail={detail} />;
    if (artifact === "replays") return <KeyValues detail={detail} keys={["linked", "checked", "failed"]} />;
    if (artifact === "outcome") {
      return (
        <KeyValues
          detail={detail}
          keys={["source", "eligible", "used", "succeeded", "median_actions_before", "median_actions_after", "support_change_pct"]}
        />
      );
    }
  }
  return <Fallback detail={detail} />;
}

const STAGE_LABEL: Record<string, string> = {
  workflows: "1 user workflows",
  intent: "2 inferred intent",
  capability: "3 semantic capability",
  verification: "4 verified implementation",
};

/** The keys of a compiler event worth a line each. Arrays are joined; objects are counted. */
const CAPABILITY_KEYS = [
  "sessions",
  "steps",
  "goals",
  "grades",
  "kept",
  "successful",
  "signature",
  "granularity_rationale",
  "rejected_too_low",
  "rejected_too_high",
  "coverage",
  "session_count",
  "median_manual_actions",
  "constraints",
  "actions",
  "scenarios",
  "reasons",
  "errors",
];

/** "seat_party_together: 7, change_one_seat: 1" - a list of objects counted by one of their keys. */
function countedBy(items: unknown[], key: string): string | null {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = (item as Record<string, unknown> | null)?.[key];
    if (typeof value !== "string" && typeof value !== "number") return null;
    counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, n]) => `${name}: ${n}`).join(", ");
}

function brief(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (Array.isArray(value)) {
    if (value.length === 0) return "-";
    if (value.every((item) => typeof item !== "object" || item === null)) return value.map(String).join(", ");
    // A batch of goals reads as one count per goal; a batch of grades as one count per grade.
    return (
      countedBy(value, "goal_name") ??
      (countedBy(value, "completion") ? `completion ${countedBy(value, "completion")}; coherence ${countedBy(value, "coherence")}` : null) ??
      `${value.length} entries`
    );
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.every(([, v]) => typeof v === "number")) return entries.map(([k, v]) => `${k}: ${String(v)}`).join(", ");
    return `${entries.length} entries`;
  }
  return String(value);
}

/**
 * One line of the compiler's decision trail. `detail` is the CompilerEvent itself: its stage
 * names which of the four story stages the row belongs to, and its own detail carries the
 * evidence for that step.
 */
function CapabilityBody({ detail }: { detail: Detail }) {
  const stage = str(detail.stage);
  const inner = asDetail(detail.detail);
  const rows = CAPABILITY_KEYS.map((key) => [key, inner[key]] as const).filter(
    ([, value]) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0),
  );
  return (
    <>
      {stage ? <span className="trace-stage">{STAGE_LABEL[stage] ?? stage}</span> : null}
      {rows.length > 0 ? (
        <dl className="trace-kv">
          {rows.slice(0, 6).map(([key, value]) => (
            <div key={key}>
              <dt>{key.replace(/_/g, " ")}</dt>
              <dd>{brief(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  );
}

/** A candidate sandbox: which one, where it runs, and its score once the verifier reported. */
function CandidateBody({ detail }: { detail: Detail }) {
  const passed = num(detail.scenarios_passed);
  const total = num(detail.scenarios_total);
  const failing = Array.isArray(detail.failing) ? detail.failing.map(String) : [];
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {str(detail.candidate) ? <span className="outcome-badge is-muted">candidate {str(detail.candidate)}</span> : null}
        {str(detail.strategy) ? <span className="trace-row__aside is-plain">{str(detail.strategy)} sandbox</span> : null}
        {passed !== null && total !== null ? (
          <>
            <span className="trace-score">
              {passed}/{total} scenarios
            </span>
            <span className="trace-meter">
              <span className="trace-meter__fill" style={{ width: `${total > 0 ? Math.round((passed / total) * 100) : 0}%` }} />
            </span>
          </>
        ) : null}
        {num(detail.files_changed) !== null ? <span className="trace-row__aside">{num(detail.files_changed)} files changed</span> : null}
      </div>
      {failing.length > 0 ? (
        <ul className="trace-files">
          {failing.slice(0, 6).map((id) => (
            <li key={id}>
              <code>{id}</code>
              <span>did not pass</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** A live sandbox preview. The URL is announced only after it answered a health check. */
function PreviewBody({ detail }: { detail: Detail }) {
  const url = str(detail.url);
  return (
    <>
      {str(detail.candidate) ? <p className="trace-row__text">Candidate {str(detail.candidate)}, port {num(detail.port) ?? "-"}</p> : null}
      <div className="trace-links">
        {url ? (
          <a className="trace-link" href={url} target="_blank" rel="noreferrer">
            Open the preview
            <span aria-hidden>&rarr;</span>
          </a>
        ) : (
          <span className="trace-row__text">Building the preview.</span>
        )}
      </div>
    </>
  );
}

/** The compiled specification: a line of what it holds, and the way to the opportunity page. */
function SpecBody({ detail }: { detail: Detail }) {
  const opportunity = str(detail.opportunity_id);
  const actions = Array.isArray(detail.actions) ? detail.actions.map(String) : [];
  return (
    <>
      {str(detail.summary) ? <p className="trace-row__text">{str(detail.summary)}</p> : null}
      <dl className="trace-kv">
        {num(detail.session_count) !== null ? (
          <div>
            <dt>sessions</dt>
            <dd>{num(detail.session_count)}</dd>
          </div>
        ) : null}
        {num(detail.scenarios) !== null ? (
          <div>
            <dt>scenarios</dt>
            <dd>{num(detail.scenarios)}</dd>
          </div>
        ) : null}
        {actions.length > 0 ? (
          <div>
            <dt>actions</dt>
            <dd>{actions.join(", ")}</dd>
          </div>
        ) : null}
      </dl>
      {opportunity ? (
        <div className="trace-links">
          <Link className="trace-link" href={`/console/opportunities/${opportunity}`}>
            Open the opportunity
            <span aria-hidden>&rarr;</span>
          </Link>
        </div>
      ) : null}
    </>
  );
}

/** The files a persona changed, from Codex's own file_change items. */
function FilesBody({ detail }: { detail: Detail }) {
  const files = Array.isArray(detail.files) ? detail.files : [];
  if (files.length === 0) return null;
  return (
    <ul className="trace-files">
      {files.slice(0, 12).map((file, index) => {
        const row = asDetail(file);
        return (
          <li key={index}>
            <code>{str(row.path) ?? "file"}</code>
            {str(row.kind) ? <span>{str(row.kind)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function ProbeBody({ detail }: { detail: Detail }) {
  const score = num(detail.score);
  const hit = detail.hit === true;
  const summary = str(detail.summary);
  const evidence = Array.isArray(detail.evidence) ? detail.evidence : [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`outcome-badge ${hit ? "is-good" : "is-muted"}`}>
          {hit ? "found" : "nothing"}
        </span>
        {score !== null ? (
          <>
            <span className="trace-score">{score.toFixed(2)}</span>
            <span className="trace-meter">
              <span
                className="trace-meter__fill"
                style={{ width: `${Math.round(Math.min(Math.max(score, 0), 1) * 100)}%` }}
              />
            </span>
          </>
        ) : null}
        {num(detail.latencyMs) !== null ? (
          <span className="trace-row__aside">{num(detail.latencyMs)} ms</span>
        ) : null}
      </div>
      {summary ? <p className="trace-row__text">{summary}</p> : null}
      {evidence.length > 0 ? <Evidence items={evidence} /> : null}
    </>
  );
}

function Evidence({ items }: { items: unknown[] }) {
  return (
    <ul className="trace-files">
      {items.slice(0, 5).map((item, index) => {
        const row = asDetail(item);
        const title =
          str(row.documentTitle) ?? str(row.path) ?? str(row.name) ?? str(row.heading) ?? `Item ${index + 1}`;
        const note =
          str(row.snippet) ?? str(row.heading) ?? (num(row.matches) !== null ? `${num(row.matches)} matches` : null);
        const score = num(row.similarity) ?? num(row.score);
        return (
          <li key={index}>
            <code>{title}</code>
            {note ? <span>{note}</span> : null}
            {score !== null ? <span>score {score.toFixed(2)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function VerdictBody({ detail }: { detail: Detail }) {
  const outcome = str(detail.outcome);
  const confidence = num(detail.confidence);
  const reasoning = str(detail.reasoning);
  const feature = str(detail.feature);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {outcome ? (
          <span className={`outcome-badge ${outcome === "answer" ? "is-good" : outcome === "absent" ? "is-bad" : "is-wait"}`}>
            {outcome}
          </span>
        ) : null}
        {feature ? <span className="trace-row__aside is-plain">{feature}</span> : null}
        {confidence !== null ? (
          <span className="trace-score">confidence {confidence.toFixed(2)}</span>
        ) : null}
      </div>
      {reasoning ? <p className="trace-row__text">{reasoning}</p> : null}
    </>
  );
}

function ModelBody({ detail }: { detail: Detail }) {
  const files = Array.isArray(detail.files) ? detail.files : [];
  return (
    <>
      <KeyValues detail={detail} keys={["model", "purpose", "input_summary", "output_summary"]} />
      {files.length > 0 ? (
        <ul className="trace-files">
          {files.map((file, index) => {
            const row = asDetail(file);
            return (
              <li key={index}>
                <code>{str(row.path) ?? "file"}</code>
                {str(row.reason) ? <span>{str(row.reason)}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

function DraftBody({ detail }: { detail: Detail }) {
  return (
    <div className="trace-doc">
      <h4>{str(detail.title) ?? "Draft issue"}</h4>
      {str(detail.body) ? <p>{str(detail.body)}</p> : null}
    </div>
  );
}

function LinkBody({
  detail,
  label,
  showBranch = false,
}: {
  detail: Detail;
  label: string;
  showBranch?: boolean;
}) {
  const url = str(detail.url);
  const number = num(detail.number);
  const branch = str(detail.branch);

  return (
    <>
      {showBranch && branch ? (
        <p className="trace-row__text">
          Branch <code className="mono">{branch}</code>
        </p>
      ) : null}
      <div className="trace-links">
        {url ? (
          <a className="trace-link" href={url} target="_blank" rel="noreferrer">
            {label}
            {number !== null ? ` #${number}` : ""}
            <span aria-hidden>&rarr;</span>
          </a>
        ) : (
          <span className="trace-row__text">No link was recorded.</span>
        )}
      </div>
    </>
  );
}

function DiffBody({ detail }: { detail: Detail }) {
  const files = Array.isArray(detail.files) ? detail.files : [];
  if (files.length === 0) return <Fallback detail={detail} />;

  return (
    <div className="grid gap-3">
      {files.map((file, index) => {
        const row = asDetail(file);
        const patch = str(row.patch) ?? "";
        return (
          <div className="trace-diff" key={index}>
            <div className="trace-diff__path">{str(row.path) ?? "file"}</div>
            <pre className="trace-diff__body">
              {patch.split("\n").map((line, lineIndex) => (
                <span key={lineIndex} className={`trace-diff__line ${diffTone(line)}`}>
                  {line === "" ? " " : line}
                </span>
              ))}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function diffTone(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) return "is-meta";
  if (line.startsWith("+")) return "is-add";
  if (line.startsWith("-")) return "is-del";
  return "";
}

function KeyValues({ detail, keys }: { detail: Detail; keys: string[] }) {
  const rows = keys
    .map((key) => [key, detail[key]] as const)
    .filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (rows.length === 0) return null;

  return (
    <dl className="trace-kv">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{key.replace(/_/g, " ")}</dt>
          <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Fallback({ detail }: { detail: Detail }) {
  const entries = Object.entries(detail).filter(([key]) => key !== "artifact");
  if (entries.length === 0) return null;
  return (
    <dl className="trace-kv">
      {entries.slice(0, 8).map(([key, value]) => (
        <div key={key}>
          <dt>{key.replace(/_/g, " ")}</dt>
          <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
