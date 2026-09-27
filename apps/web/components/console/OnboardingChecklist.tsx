import Link from "next/link";
import type { OnboardingStep } from "@/lib/console/onboarding";
import { formatDateTime } from "@/lib/console/format";

/** The four steps to a working project. Each unfinished one links to the page that finishes it. */
export function OnboardingChecklist({
  steps,
  completedAt,
}: {
  steps: OnboardingStep[];
  completedAt: string | null;
}) {
  const done = steps.filter((step) => step.done).length;

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Getting set up</h2>
        <span className="count-pill">
          {done} of {steps.length}
        </span>
      </div>
      {completedAt ? (
        <p className="field-hint mt-0 mb-4">
          Everything has been in place since {formatDateTime(completedAt)}.
        </p>
      ) : null}
      <ol className="checklist">
        {steps.map((step, index) => (
          <li key={step.key} className={`checklist__item${step.done ? " is-done" : ""}`}>
            <span className="checklist__mark" aria-hidden>
              {step.done ? <Tick /> : index + 1}
            </span>
            <span className="checklist__body">
              <span className="checklist__title">{step.title}</span>
              <span className="checklist__detail">{step.detail}</span>
            </span>
            {step.done ? (
              <span className="checklist__state">Done</span>
            ) : (
              <Link className="link-button checklist__state" href={step.href}>
                {step.action}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Tick() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M2 6.4 4.6 9 10 3.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
