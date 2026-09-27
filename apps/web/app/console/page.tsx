import Link from "next/link";
import { redirect } from "next/navigation";
import { CopyButton } from "@/components/CopyButton";
import { PageHeader } from "@/components/PageHeader";
import { OnboardingChecklist } from "@/components/console/OnboardingChecklist";
import { SiteUrlField } from "@/components/console/SiteUrlField";
import { CONVERSATION_OUTCOMES, outcomeLabel, outcomeTone } from "@/lib/agent/outcome";
import { loadOutcomeCounts } from "@/lib/console/conversations";
import { loadCounts, loadEscalationStatusCounts, loadWorkerStatus } from "@/lib/console/counts";
import { currentProjectOrNull } from "@/lib/console/current";
import { escalationLabel, escalationTone, formatDateTime } from "@/lib/console/format";
import { onboardingSteps, stampOnboarded } from "@/lib/console/onboarding";
import { embedSnippet, projectDisplayName } from "@/lib/console/project";

export const dynamic = "force-dynamic";

export default async function ConsoleOverviewPage() {
  const project = await currentProjectOrNull();
  if (!project) redirect("/signin");

  const [counts, worker, outcomes, statuses] = await Promise.all([
    loadCounts(project.id),
    loadWorkerStatus(project.id),
    loadOutcomeCounts(project.id),
    loadEscalationStatusCounts(project.id),
  ]);
  const snippet = embedSnippet(project.embedKey);
  const steps = onboardingSteps(project, counts, worker);
  const completedAt = await stampOnboarded(project, steps);
  // A project that has done nothing yet gets onboarding, not a dashboard of zeroes.
  const hasActivity = outcomes.all > 0 || counts.escalations > 0;
  const hasAnything = hasActivity || counts.documents > 0;
  const openConversations =
    outcomes.all - CONVERSATION_OUTCOMES.reduce((total, outcome) => total + outcomes[outcome], 0);

  return (
    <>
      <PageHeader
        eyebrow="Console"
        title="Overview"
        description="The project this console manages, its embed snippet, and what the agent has been doing."
        actions={
          // A trace of nothing is not worth opening, so the button waits until there is one.
          hasActivity ? (
            <Link href="/console/activity" className="secondary-action">
              Open the live trace
            </Link>
          ) : null
        }
      />

      {hasAnything ? (
        <div className="stat-grid mb-6">
          <Stat value={counts.documents} label="Sources" />
          <Stat value={counts.chunks} label="Chunks" />
          <Stat value={outcomes.all} label="Conversations" />
          <Stat value={counts.escalations} label="Escalations" />
          <div
            className="stat stat--status"
            title={
              worker.online
                ? "The service that drafts the issue and the pull request is running."
                : worker.lastSeenAt
                  ? `The service that drafts the issue and the pull request last reported ${formatDateTime(worker.lastSeenAt)}.`
                  : "The service that drafts the issue and the pull request is not running."
            }
          >
            <span className={`stat__dot${worker.online ? "" : " is-off"}`} />
            <span>
              <span className="stat__num block text-[1.05rem]">
                {worker.online ? "Ready" : "Not running"}
              </span>
              <span className="stat__label">Automation</span>
            </span>
          </div>
        </div>
      ) : null}

      <div className="mb-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.85fr)]">
        <section className="panel">
          <div className="panel__head">
            <h2>Project</h2>
            <span className="count-pill">{project.slug}</span>
          </div>
          <dl className="grid gap-4">
            <Row label="Name">{projectDisplayName(project)}</Row>
            <Row label="Embed key">
              <code className="mono">{project.embedKey}</code>
            </Row>
            {/* The repository only exists as a line once one is actually bound. */}
            {project.repoFullName ? (
              <Row label="Repository">
                <span className="flex flex-wrap items-center gap-2">
                  <a
                    className="ext-link"
                    href={`https://github.com/${project.repoFullName}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {project.repoFullName}
                  </a>
                  <span className="outcome-badge is-muted">
                    {project.repoDefaultBranch ?? "main"}
                  </span>
                </span>
              </Row>
            ) : null}
          </dl>
          <SiteUrlField initialSiteUrl={project.siteUrl} />
        </section>

        <section className="panel" id="embed">
          <div className="panel__head">
            <h2>Embed snippet</h2>
            <CopyButton value={snippet} label="Copy" className="ghost-action" />
          </div>
          <p className="field-hint mt-0 mb-3">
            One script tag. The key names your project and nothing else, so it is safe in your page
            source.
          </p>
          <pre className="code-block">
            <code>{snippet}</code>
          </pre>
        </section>
      </div>

      <div className="mb-6">
        <OnboardingChecklist steps={steps} completedAt={completedAt} />
      </div>

      {hasActivity ? (
        <div className="mb-6 grid items-start gap-6 lg:grid-cols-2">
          {outcomes.all > 0 ? (
            <section className="panel">
              <div className="panel__head">
                <h2>Conversations</h2>
                <Link href="/console/conversations" className="link-button">
                  Read them
                </Link>
              </div>
              {/* Only the ways conversations actually ended, plus the ones still open. */}
              <dl className="grid gap-3">
                {CONVERSATION_OUTCOMES.filter((outcome) => outcomes[outcome] > 0).map((outcome) => (
                  <Tally
                    key={outcome}
                    label={outcomeLabel(outcome)}
                    value={outcomes[outcome]}
                    tone={outcomeTone(outcome)}
                  />
                ))}
                {openConversations > 0 ? (
                  <Tally label={outcomeLabel(null)} value={openConversations} tone={outcomeTone(null)} />
                ) : null}
              </dl>
            </section>
          ) : null}

          {statuses.length > 0 ? (
            <section className="panel">
              <div className="panel__head">
                <h2>Escalations</h2>
                <Link href="/console/activity" className="link-button">
                  Follow one
                </Link>
              </div>
              <dl className="grid gap-3">
                {statuses.map((entry) => (
                  <Tally
                    key={entry.status}
                    label={escalationLabel(entry.status)}
                    value={entry.count}
                    tone={escalationTone(entry.status)}
                  />
                ))}
              </dl>
            </section>
          ) : null}
        </div>
      ) : null}

      {/* Shortcuts only to pages that have something on them. On a new project the checklist is
          already the way in, so they would only repeat it. */}
      {hasAnything ? (
        <div className="shortcut-grid">
          <Shortcut
            href="/console/knowledge"
            title={counts.documents > 0 ? "Add another source" : "Add a source"}
            text="Upload the handbook, paste a page, or point at a URL. The agent answers from it."
          />
          {outcomes.all > 0 ? (
            <Shortcut
              href="/console/conversations"
              title="Read conversations"
              text="Every question, how it ended, and the steps the agent showed on the page."
            />
          ) : null}
          {hasActivity ? (
            <Shortcut
              href="/console/activity"
              title="Watch the live trace"
              text="Checks, verdicts, drafted issues and pull requests, as they happen."
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat">
      <span className="stat__num">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** One "label ..... count" line inside a panel. */
function Tally({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="m-0">
        <span className={`outcome-badge ${tone ?? "is-muted"}`}>{label}</span>
      </dt>
      <dd className="stat__num m-0">{value}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="field-label mb-0">{label}</dt>
      <dd className="m-0 text-[0.95rem]">{children}</dd>
    </div>
  );
}

function Shortcut({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <Link href={href} className="shortcut">
      <span className="shortcut__title">{title}</span>
      <span className="shortcut__text">{text}</span>
    </Link>
  );
}
