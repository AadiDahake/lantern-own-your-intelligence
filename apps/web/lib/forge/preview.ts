/**
 * The health check every preview URL passes before anyone hears about it.
 *
 * A tunnel to a server that bound `localhost`, or a `next start` that has not finished booting,
 * both look like a URL. Neither is a preview. Nothing is announced until it has answered.
 */

export type HealthCheckOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_INTERVAL_MS = 2_000;

/** True when `url` answers with any status below 500 within a short per-request timeout. */
export async function isServing(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: { "user-agent": "lantern-forge/health" },
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

/** Polls until `url` answers, or throws with the last failure once the timeout has passed. */
export async function waitForHttp(url: string, options: HealthCheckOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServing(url, fetchImpl)) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`The preview at ${url} did not answer within ${Math.round(timeoutMs / 1000)} s.`);
}

/** Runloop's tunnel URL for one port. The key is the only stored part; the URL is rebuilt. */
export function tunnelUrl(port: number, tunnelKey: string): string {
  return `https://${port}-${tunnelKey}.tunnel.runloop.ai`;
}
