/**
 * Waits for the Vercel deployment that corresponds to a merge commit.
 *
 * The same watch the worker does after a merge, for the forge engine's approval path: find the
 * deployment whose `githubCommitSha` is the merge sha, poll until it is READY, and return its URL.
 */

const API = "https://api.vercel.com";
const DEFAULT_TIMEOUT_MS = 8 * 60_000;
const DEFAULT_POLL_MS = 10_000;
const REPORT_EVERY_MS = 30_000;

export class DeployError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployError";
  }
}

type Deployment = {
  uid?: string;
  url?: string;
  target?: string | null;
  readyState?: string;
  state?: string;
  meta?: Record<string, string | undefined>;
};

export type WaitForDeploymentOptions = {
  token: string;
  projectName: string;
  /** The stable address of the project's production deployments, returned for a production deployment. */
  productionUrl?: string | null;
  /** Called every 30 s while waiting, with what the deployment last said. */
  report?: (title: string, state: string) => void;
  timeoutMs?: number;
  pollMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

async function get<T>(
  fetchImpl: typeof fetch,
  token: string,
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const query = new URLSearchParams(params).toString();
  const response = await fetchImpl(`${API}${path}${query ? `?${query}` : ""}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new DeployError(`GET ${path} -> ${response.status}: ${(await response.text().catch(() => "")).slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

export function deploymentUrl(deployment: Deployment, productionUrl?: string | null): string {
  if (deployment.target === "production" && productionUrl) return productionUrl;
  const url = deployment.url ?? "";
  return url.startsWith("http") ? url : `https://${url}`;
}

/** Polls until a READY deployment for `mergeSha` exists; returns its https URL. */
export async function waitForDeployment(mergeSha: string, options: WaitForDeploymentOptions): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;

  const project = await get<{ id: string }>(fetchImpl, options.token, `/v9/projects/${options.projectName}`);
  const started = now();
  let lastReport = started;
  let lastState = "none yet";

  for (;;) {
    const page = await get<{ deployments?: Deployment[] }>(fetchImpl, options.token, "/v6/deployments", {
      projectId: project.id,
      limit: "10",
    });
    for (const deployment of page.deployments ?? []) {
      if ((deployment.meta?.githubCommitSha ?? "") !== mergeSha) continue;
      const state = deployment.readyState ?? deployment.state ?? "";
      lastState = state;
      if (state === "READY") return deploymentUrl(deployment, options.productionUrl);
      if (state === "ERROR" || state === "CANCELED") {
        throw new DeployError(`deployment ${deployment.uid ?? ""} ended in state ${state}`);
      }
    }
    const elapsed = now() - started;
    if (elapsed > timeoutMs) {
      throw new DeployError(
        `no READY deployment for ${mergeSha.slice(0, 7)} after ${Math.round(elapsed / 1000)} s (last state: ${lastState})`,
      );
    }
    if (options.report && now() - lastReport >= REPORT_EVERY_MS) {
      lastReport = now();
      options.report(
        `Waiting for the Vercel deployment of ${mergeSha.slice(0, 7)} (${Math.round(elapsed / 1000)} s elapsed)`,
        lastState,
      );
    }
    await sleep(pollMs);
  }
}
