import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { currentProjectOrNull } from "@/lib/console/current";
import { formatDateTime, formatMedian, opportunityStatusLabel, opportunityStatusTone } from "@/lib/console/format";
import { loadOpportunities } from "@/lib/opportunity/read";

export const dynamic = "force-dynamic";

/**
 * Every gap with evidence behind it: how many sessions worked around it, what it cost them, and
 * how far the capability has come. The list is the four-stage story in one line per row.
 */
export default async function OpportunitiesPage() {
  const project = await currentProjectOrNull();
  if (!project) redirect("/signin");
  const opportunities = await loadOpportunities(project.id);

  return (
    <>
      <PageHeader
        eyebrow="Opportunities"
        title="What the product is missing"
        description="Gaps the agent confirmed, with the sessions where customers already worked around them, the capability compiled from those sessions, and the implementation built and verified in isolation."
      />

      {opportunities.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">No opportunities yet</p>
          <p className="empty-state__text">
            When the three checks confirm a feature is absent, Lantern asks PostHog whether other
            customers worked around it. The first one shows up here.
          </p>
        </div>
      ) : (
        <ul className="opp-list">
          {opportunities.map((opportunity) => (
            <li key={opportunity.groupId}>
              <Link href={`/console/opportunities/${opportunity.groupId}`} className="record-card">
                <div className="record-card__top">
                  <span className={`outcome-badge ${opportunityStatusTone(opportunity.status)}`}>
                    {opportunityStatusLabel(opportunity.status)}
                  </span>
                  {opportunity.intent ? <code className="mono">{opportunity.intent}</code> : null}
                  <span className="record-card__time">{formatDateTime(opportunity.updatedAt)}</span>
                </div>
                <p className="opp-list__title">{opportunity.title}</p>
                <div className="record-card__meta">
                  <span>
                    {opportunity.sessionCount === null
                      ? "sessions not counted yet"
                      : `${opportunity.sessionCount} session${opportunity.sessionCount === 1 ? "" : "s"}`}
                  </span>
                  <span>median {formatMedian(opportunity.medianInteractions)} interactions</span>
                  {opportunity.scenarioCount !== null ? <span>{opportunity.scenarioCount} scenarios</span> : null}
                  <span>
                    reported {opportunity.reportCount} time{opportunity.reportCount === 1 ? "" : "s"}
                  </span>
                  {opportunity.prUrl ? <span>pull request</span> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
