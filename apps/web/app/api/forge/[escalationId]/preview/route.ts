/**
 * The live preview URL of a run's winning candidate.
 *
 * Nothing stored is a URL. The candidate row holds the sandbox's handle (a devbox id and a tunnel
 * key, or a local port) and the URL is rebuilt and health-checked on every read, so a sandbox that
 * is gone answers `null` rather than a link that 502s.
 */
import { corsJson, preflight } from "@/lib/cors";
import { asErrorResponse, currentProject } from "@/lib/console/current";
import { buildStrategy } from "@/lib/forge/config";
import { loadCandidates } from "@/lib/forge/store";
import type { SandboxHandle } from "@/lib/forge/strategy";
import { serviceClient } from "@/lib/supabase";
import type { ForgeStrategyName } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ escalationId: string }> },
): Promise<Response> {
  const project = await currentProject().catch(asErrorResponse);
  if (project instanceof Response) return project;

  const { escalationId } = await context.params;
  const { data } = await serviceClient()
    .from("escalation")
    .select("id, winning_candidate_id")
    .eq("id", escalationId)
    .eq("project_id", project.id)
    .maybeSingle();
  if (!data) return corsJson({ error: "not found" }, { status: 404 });

  const candidates = await loadCandidates(escalationId).catch(() => []);
  const winner =
    candidates.find((candidate) => candidate.id === String(data.winning_candidate_id ?? "")) ??
    candidates.find((candidate) => candidate.status === "ready") ??
    null;
  if (!winner || winner.tornDownAt || winner.status === "torn_down") {
    return corsJson({ url: null, candidate: winner?.label ?? null });
  }

  const handle: SandboxHandle = {
    strategy: winner.strategy as SandboxHandle["strategy"],
    devboxId: winner.devboxId,
    tunnelKey: winner.tunnelKey,
    localPath: winner.localPath,
    previewPort: winner.previewPort,
  };
  try {
    const { strategy } = buildStrategy({ name: winner.strategy as ForgeStrategyName });
    const url = await strategy.previewUrl(handle, await strategy.previewPort());
    return corsJson({ url, candidate: winner.label });
  } catch {
    // The strategy that made this box is not configured here, so its preview cannot be reached.
    return corsJson({ url: null, candidate: winner.label });
  }
}
