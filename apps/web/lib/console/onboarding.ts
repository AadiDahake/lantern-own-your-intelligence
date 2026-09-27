/**
 * The four things a project needs before Lantern can do its whole job, read from live state.
 *
 * Nothing here is a stored flag except `onboarded_at`, which only records when the four first read
 * done. Undoing any of them (deleting the last source, unbinding the repository) shows up at once.
 */
import type { ConsoleCounts, WorkerStatus } from "@/lib/console/counts";
import type { ConsoleProject } from "@/lib/console/project";
import { serviceClient } from "@/lib/supabase";

export type OnboardingStep = {
  key: "knowledge" | "widget" | "repository" | "worker";
  title: string;
  /** What is still missing, or what was found. */
  detail: string;
  done: boolean;
  /** Where to go to finish it. */
  href: string;
  action: string;
};

export function onboardingSteps(
  project: ConsoleProject,
  counts: ConsoleCounts,
  worker: WorkerStatus,
): OnboardingStep[] {
  return [
    {
      key: "knowledge",
      title: "Add knowledge",
      detail:
        counts.documents > 0
          ? `${counts.documents} ${counts.documents === 1 ? "source" : "sources"}, ${counts.chunks} passages`
          : "The agent answers from what you upload. It has nothing yet.",
      done: counts.documents > 0,
      href: "/console/knowledge",
      action: "Add a source",
    },
    {
      key: "widget",
      // A conversation is the only proof the script really loaded on a real page.
      title: "Install the widget",
      detail:
        counts.conversations > 0
          ? `${counts.conversations} ${counts.conversations === 1 ? "conversation" : "conversations"} so far`
          : "Paste the snippet into your site, then ask the widget a question.",
      done: counts.conversations > 0,
      href: "#embed",
      action: "Copy the snippet",
    },
    {
      key: "repository",
      title: "Connect GitHub and choose a repository",
      detail: project.repoFullName
        ? `${project.repoFullName} on ${project.repoDefaultBranch ?? "main"}`
        : "Without one the agent cannot check the code or report a missing feature.",
      done: Boolean(project.repoFullName),
      href: "/console/repository",
      action: project.githubLogin ? "Choose a repository" : "Connect GitHub",
    },
    {
      key: "worker",
      title: "Worker online",
      detail: worker.online
        ? "Reporting in, ready to file issues and draft pull requests."
        : "Start the worker so reported features get built.",
      done: worker.online,
      href: "/console/activity",
      action: "Check the trace",
    },
  ];
}

/**
 * Stamps the moment the four steps first all read done.
 *
 * It is written once and never cleared, so it stays a record of when the project went live rather
 * than a second, competing source of truth for the checklist.
 */
export async function stampOnboarded(
  project: ConsoleProject,
  steps: OnboardingStep[],
): Promise<string | null> {
  if (project.onboardedAt) return project.onboardedAt;
  if (!steps.every((step) => step.done)) return null;

  const at = new Date().toISOString();
  await serviceClient()
    .from("project")
    .update({ onboarded_at: at })
    .eq("id", project.id)
    .is("onboarded_at", null);
  return at;
}
