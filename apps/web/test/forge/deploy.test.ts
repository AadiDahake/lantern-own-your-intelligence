import { describe, expect, it } from "vitest";
import { deploymentUrl, waitForDeployment } from "@/lib/forge/deploy";

type Deployment = { uid: string; url: string; target?: string; readyState: string; meta: { githubCommitSha: string } };

function vercel(sequence: Deployment[][]): { fetchImpl: typeof fetch; requests: string[] } {
  const requests: string[] = [];
  let call = 0;
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/v9/projects/")) return new Response(JSON.stringify({ id: "prj_1" }));
    const page = sequence[Math.min(call, sequence.length - 1)] ?? [];
    call += 1;
    return new Response(JSON.stringify({ deployments: page }));
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const options = (fetchImpl: typeof fetch, extra: Partial<Parameters<typeof waitForDeployment>[1]> = {}) => ({
  token: "vercel-test",
  projectName: "novaair",
  fetchImpl,
  sleep: async () => undefined,
  pollMs: 0,
  ...extra,
});

describe("waitForDeployment", () => {
  it("waits for the deployment of the merge commit to be READY", async () => {
    const { fetchImpl, requests } = vercel([
      [{ uid: "d1", url: "host-abc.vercel.app", readyState: "BUILDING", meta: { githubCommitSha: "sha1" } }],
      [{ uid: "d1", url: "host-abc.vercel.app", readyState: "READY", meta: { githubCommitSha: "sha1" } }],
    ]);
    const url = await waitForDeployment("sha1", options(fetchImpl));
    expect(url).toBe("https://host-abc.vercel.app");
    expect(requests[0]).toContain("/v9/projects/novaair");
    expect(requests[1]).toContain("projectId=prj_1");
  });

  it("returns the configured production address for a production deployment", async () => {
    const { fetchImpl } = vercel([[{ uid: "d1", url: "x.vercel.app", target: "production", readyState: "READY", meta: { githubCommitSha: "sha1" } }]]);
    const productionUrl = "https://novaair.example.com";
    expect(await waitForDeployment("sha1", options(fetchImpl, { productionUrl }))).toBe(productionUrl);
  });

  it("ignores deployments of other commits", async () => {
    const { fetchImpl } = vercel([
      [{ uid: "d0", url: "old.vercel.app", readyState: "READY", meta: { githubCommitSha: "other" } }],
      [{ uid: "d1", url: "new.vercel.app", readyState: "READY", meta: { githubCommitSha: "sha1" } }],
    ]);
    expect(await waitForDeployment("sha1", options(fetchImpl))).toBe("https://new.vercel.app");
  });

  it("fails when the deployment errors", async () => {
    const { fetchImpl } = vercel([[{ uid: "d1", url: "x", readyState: "ERROR", meta: { githubCommitSha: "sha1" } }]]);
    await expect(waitForDeployment("sha1", options(fetchImpl))).rejects.toThrow(/ended in state ERROR/);
  });

  it("gives up after the timeout and names the last state", async () => {
    const { fetchImpl } = vercel([[{ uid: "d1", url: "x", readyState: "QUEUED", meta: { githubCommitSha: "sha1" } }]]);
    let now = 0;
    await expect(
      waitForDeployment("sha1", options(fetchImpl, { timeoutMs: 1000, now: () => (now += 600) })),
    ).rejects.toThrow(/no READY deployment for sha1 .*last state: QUEUED/);
  });

  it("reports progress every thirty seconds", async () => {
    const { fetchImpl } = vercel([
      [{ uid: "d1", url: "x", readyState: "BUILDING", meta: { githubCommitSha: "sha1" } }],
      [{ uid: "d1", url: "x", readyState: "BUILDING", meta: { githubCommitSha: "sha1" } }],
      [{ uid: "d1", url: "x.vercel.app", readyState: "READY", meta: { githubCommitSha: "sha1" } }],
    ]);
    const reports: string[] = [];
    let now = 0;
    await waitForDeployment("sha1", options(fetchImpl, { now: () => (now += 20_000), report: (title, state) => reports.push(`${title} ${state}`) }));
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[0]).toMatch(/Waiting for the Vercel deployment of sha1 \(\d+ s elapsed\) BUILDING/);
  });

  it("fails clearly when Vercel rejects the token", async () => {
    const fetchImpl = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;
    await expect(waitForDeployment("sha1", options(fetchImpl))).rejects.toThrow(/GET \/v9\/projects\/novaair -> 403/);
  });
});

describe("deploymentUrl", () => {
  it("prefixes https when Vercel returns a bare host, and keeps a preview on its own address", () => {
    expect(deploymentUrl({ url: "a.vercel.app" }, "https://novaair.example.com")).toBe("https://a.vercel.app");
    expect(deploymentUrl({ url: "https://a.vercel.app" }, "https://novaair.example.com")).toBe("https://a.vercel.app");
  });
});
